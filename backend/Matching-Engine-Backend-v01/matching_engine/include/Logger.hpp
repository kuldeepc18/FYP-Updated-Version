#ifndef LOGGER_HPP
#define LOGGER_HPP

#include <mutex>
#include <string>
#include <sstream>
#include <chrono>
#include <cstdio>
#include <ctime>
#include "Order.hpp"
#include "Trade.hpp"

// ─── Platform-specific socket headers ────────────────────────────────────────
#ifdef _WIN32
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <winsock2.h>
#  include <ws2tcpip.h>
#  ifdef _MSC_VER
#    pragma comment(lib, "ws2_32.lib")
#  endif
   typedef SOCKET socket_t;
#  define INVALID_SOCK INVALID_SOCKET
   inline void close_sock(SOCKET s) { closesocket(s); }
#else
#  include <sys/socket.h>
#  include <netinet/in.h>
#  include <arpa/inet.h>
#  include <unistd.h>
   typedef int socket_t;
#  define INVALID_SOCK (-1)
   inline void close_sock(int s) { ::close(s); }
#endif
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Logger – streams all order and trade events to QuestDB via InfluxDB Line
 * Protocol (ILP) over TCP on port 9009.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  QuestDB table: trade_logs
 *  (QuestDB auto-creates / auto-extends the schema on first ILP delivery)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  SYMBOL (indexed tag) columns — appear before the space in ILP lines:
 *  ─────────────────────────────────────────────────────────────────────────
 *  order_id              SYMBOL   unique order identifier
 *                                 (format: instrId-random10-traderId)
 *                                 "NA" for TRADE_MATCH rows
 *  instrument_id         SYMBOL   numeric instrument ID (1–15)
 *  order_type            SYMBOL   LIMIT | MARKET | MATCH
 *  side                  SYMBOL   BUY | SELL
 *  order_status_event    SYMBOL   ORDER_NEW | ORDER_PARTIAL | ORDER_FILLED |
 *                                 ORDER_CANCELLED | ORDER_EXPIRED |
 *                                 TRADE_MATCH
 *  user_id               SYMBOL   traderId of the submitting user
 *                                 (matches users.id for real users,
 *                                  0-9999 for mock traders)
 *                                 "NA" for TRADE_MATCH rows
 *  trade_id              SYMBOL   unique trade ID (TRD-instrId-random10)
 *                                 "NA" for non-match order events
 *  buyer_user_id         SYMBOL   traderId of the buy-side participant
 *                                 "NA" for non-match order events
 *  seller_user_id        SYMBOL   traderId of the sell-side participant
 *                                 "NA" for non-match order events
 *  aggressor_side        SYMBOL   BUY | SELL — which side was the incoming
 *                                 (price-taking) order that triggered the match
 *                                 "NA" for non-match order events
 *  market_phase          SYMBOL   PRE_OPEN | OPEN | CLOSED (IST schedule)
 *  device_id_hash        SYMBOL   8-char hex FNV-1a fingerprint of traderId;
 *                                 simulates device fingerprinting for ML
 *                                 "NA" for TRADE_MATCH rows
 *
 *  FIELD (typed value) columns — appear after the space in ILP lines:
 *  ─────────────────────────────────────────────────────────────────────────
 *  price                 DOUBLE   limit price (or 0.0 for MARKET orders)
 *  quantity              LONG     original order quantity
 *  filled_quantity       LONG     shares filled so far
 *  remaining_quantity    LONG     shares still pending (quantity - filled)
 *  is_short_sell         BOOLEAN  true if this is a short-sell order
 *  order_submit_timestamp  LONG   µs since Unix epoch when order was placed
 *  order_cancel_timestamp  LONG   µs since Unix epoch when order was cancelled
 *                                 (0 = not cancelled)
 *  match_engine_timestamp  LONG   µs since Unix epoch when this log row was
 *                                 written by the matching engine
 *
 *  DESIGNATED TIMESTAMP (ILP trailing nanos):
 *    order events → order submit timestamp (nanos)
 *    TRADE_MATCH  → trade execution timestamp (nanos)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ⚠️  If you already have a trade_logs table in QuestDB with the old schema,
 *      run:  DROP TABLE trade_logs;
 *      before starting the engine so QuestDB recreates it with all new columns.
 */
class Logger {
public:
    explicit Logger(const std::string& questdbHost = "127.0.0.1",
                    int               questdbPort  = 9009)
        : questdbHost_(questdbHost)
        , questdbPort_(questdbPort)
        , sock_(INVALID_SOCK)
    {
#ifdef _WIN32
        WSADATA wsaData;
        WSAStartup(MAKEWORD(2, 2), &wsaData);
#endif
        if (!connectToQuestDB()) {
            std::fprintf(stderr,
                "\n[Logger] WARNING: Cannot connect to QuestDB at %s:%d\n"
                "         Trade data will NOT be stored until QuestDB is reachable.\n"
                "         Start QuestDB first, then run the matching engine.\n\n",
                questdbHost_.c_str(), questdbPort_);
        } else {
            std::fprintf(stderr,
                "[Logger] Connected to QuestDB at %s:%d — trade_logs table ready.\n",
                questdbHost_.c_str(), questdbPort_);
        }
    }

    ~Logger() {
        if (sock_ != INVALID_SOCK) close_sock(sock_);
#ifdef _WIN32
        WSACleanup();
#endif
    }

    Logger(const Logger&)            = delete;
    Logger& operator=(const Logger&) = delete;

    // ══════════════════════════════════════════════════════════════════════════
    //  logOrder()
    //  ─────────────────────────────────────────────────────────────────────────
    //  Writes one order-event row to trade_logs.  Called for every lifecycle
    //  transition of every order (NEW, PARTIAL, FILLED, CANCELLED, EXPIRED)
    //  by MockTrader threads, CircularRingCoordinator threads, and main.cpp
    //  for real-user orders.
    //
    //  Trade-specific columns (trade_id, buyer_user_id, seller_user_id,
    //  aggressor_side) are set to "NA" — they are only meaningful in
    //  TRADE_MATCH rows written by logTrade().
    // ══════════════════════════════════════════════════════════════════════════
    void logOrder(const Order& order) {
        const std::string ordType   = (order.getType() == OrderType::LIMIT) ? "LIMIT" : "MARKET";
        const std::string side      = (order.getSide() == OrderSide::BUY)   ? "BUY"   : "SELL";
        const std::string statusEvt = orderStatusEventStr(order.getStatus());
        const std::string instrId   = std::to_string(order.getInstrumentId());
        const std::string orderId   = sanitizeTag(order.getOrderId());
        const std::string userId    = sanitizeTag(order.getTraderId());
        const std::string phase     = sanitizeTag(order.getMarketPhase());
        const std::string devHash   = sanitizeTag(order.getDeviceIdHash());

        const long long qty          = static_cast<long long>(order.getQuantity());
        const long long filledQty    = static_cast<long long>(
                                           order.getQuantity() - order.getRemainingQuantity());
        const long long remainingQty = static_cast<long long>(order.getRemainingQuantity());
        const bool      shortSell    = order.isShortSell();

        // All timestamps in microseconds (as requested) — ILP designated
        // timestamp at the end uses nanoseconds (QuestDB native precision).
        const long long submitMicros  = toMicros(order.getSubmitTimestamp());
        const long long cancelMicros  = isCancelledOrExpiredWithStamp(order)
                                            ? toMicros(order.getCancelTimestamp()) : 0LL;
        const long long matchMicros   = toMicros(std::chrono::system_clock::now());
        const long long tsNanos       = toNanos(order.getSubmitTimestamp());

        // ── ILP line ──────────────────────────────────────────────────────────
        // Tags  : all SYMBOL columns  (comma-separated before the space)
        // Fields: all typed columns   (comma-separated after the space)
        std::ostringstream ilp;
        ilp << "trade_logs"
            // ── tag section ────────────────────────────────────────────────
            << ",order_id="           << orderId
            << ",instrument_id="      << instrId
            << ",order_type="         << ordType
            << ",side="               << side
            << ",order_status_event=" << statusEvt
            << ",user_id="            << userId
            // trade_id / buyer_user_id / seller_user_id are "NA" for orders
            // that were never matched; for matched orders (PARTIAL / FILLED /
            // CANCELLED-after-partial / EXPIRED-after-partial) they carry the
            // real IDs embedded by OrderBook::executeTrade() via fillWithTradeContext().
            << ",trade_id="           << sanitizeTag(order.getMatchedTradeId())
            << ",buyer_user_id="      << sanitizeTag(order.getCounterpartyBuyerUid())
            << ",seller_user_id="     << sanitizeTag(order.getCounterpartySellerUid())
            << ",aggressor_side=NA"              // NA for non-match order events
            << ",market_phase="       << phase
            << ",device_id_hash="     << devHash
            // ── field section ──────────────────────────────────────────────
            << " "
            << "price="                     << std::fixed << order.getPrice()
            << ",quantity="                 << qty          << "i"
            << ",filled_quantity="          << filledQty    << "i"
            << ",remaining_quantity="       << remainingQty << "i"
            << ",is_short_sell="            << (shortSell ? "true" : "false")
            << ",order_submit_timestamp="   << submitMicros << "i"
            << ",order_cancel_timestamp="   << cancelMicros << "i"
            << ",match_engine_timestamp="   << matchMicros  << "i"
            // ── designated timestamp (nanos) ───────────────────────────────
            << " " << tsNanos << "\n";

        std::lock_guard<std::mutex> lock(mutex_);
        sendILP(ilp.str());
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  logTrade()
    //  ─────────────────────────────────────────────────────────────────────────
    //  Writes one TRADE_MATCH row to trade_logs for every executed match.
    //  Called by OrderBook::executeTrade() immediately after both matched orders
    //  are filled.
    //
    //  This row is the primary source for:
    //    ✦ Buyer-seller graph construction (circular-trade detection)
    //    ✦ Self-trade ratio computation (wash-trade detection)
    //    ✦ Aggressor-side imbalance features
    //    ✦ Volume-concentration analysis in a closed group
    //
    //  Tags set to "NA" for order-specific columns (order_id, user_id,
    //  device_id_hash) because the match involves TWO orders / users.
    // ══════════════════════════════════════════════════════════════════════════
    void logTrade(const Trade& trade) {
        const std::string instrId      = std::to_string(trade.getInstrumentId());
        const std::string tradeId      = sanitizeTag(trade.getTradeId());
        const std::string buyOrderId   = sanitizeTag(trade.getBuyOrderId());
        const std::string buyerUid     = sanitizeTag(trade.getBuyerUserId());
        const std::string sellerUid    = sanitizeTag(trade.getSellerUserId());
        const std::string aggrSide     = (trade.getAggressorSide() == OrderSide::BUY)
                                             ? "BUY" : "SELL";
        const std::string phase        = sanitizeTag(marketPhaseFromTp(trade.getTimestamp()));

        // device_id_hash is mandatory on every row — for TRADE_MATCH rows we
        // use the aggressor's user ID (the party that crossed the spread and
        // triggered the match), exactly as we would use their device fingerprint
        // in a production surveillance system.
        const std::string& aggrUserId  = (trade.getAggressorSide() == OrderSide::BUY)
                                             ? trade.getBuyerUserId()
                                             : trade.getSellerUserId();
        const std::string devHash      = sanitizeTag(Order::computeDeviceIdHash(aggrUserId));

        const long long   qty          = static_cast<long long>(trade.getQuantity());
        const long long   matchMicros  = toMicros(std::chrono::system_clock::now());
        const long long   submitMicros = toMicros(trade.getTimestamp());
        const long long   tsNanos      = toNanos(trade.getTimestamp());

        std::ostringstream ilp;
        ilp << "trade_logs"
            // ── tag section ────────────────────────────────────────────────
            << ",order_id="           << buyOrderId
            << ",instrument_id="      << instrId
            << ",order_type=MATCH"
            << ",side="               << aggrSide
            << ",order_status_event=TRADE_MATCH"
            << ",user_id="            << buyerUid
            << ",trade_id="           << tradeId
            << ",buyer_user_id="      << buyerUid
            << ",seller_user_id="     << sellerUid
            << ",aggressor_side="     << aggrSide
            << ",market_phase="       << phase
            << ",device_id_hash="     << devHash  // aggressor's fingerprint — always present
            // ── field section ──────────────────────────────────────────────
            << " "
            << "price="                     << std::fixed << trade.getPrice()
            << ",quantity="                 << qty         << "i"
            << ",filled_quantity="          << qty         << "i"
            << ",remaining_quantity=0i"
            << ",is_short_sell=false"
            << ",order_submit_timestamp="   << submitMicros << "i"
            << ",order_cancel_timestamp=0i"
            << ",match_engine_timestamp="   << matchMicros  << "i"
            // ── designated timestamp (nanos) ───────────────────────────────
            << " " << tsNanos << "\n";

        std::lock_guard<std::mutex> lock(mutex_);
        sendILP(ilp.str());
    }

private:
    // ── Internal helpers ──────────────────────────────────────────────────────

    bool connectToQuestDB() {
        if (sock_ != INVALID_SOCK) { close_sock(sock_); sock_ = INVALID_SOCK; }
        sock_ = ::socket(AF_INET, SOCK_STREAM, 0);
        if (sock_ == INVALID_SOCK) return false;
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port   = htons(static_cast<uint16_t>(questdbPort_));
        if (::inet_pton(AF_INET, questdbHost_.c_str(), &addr.sin_addr) != 1) {
            close_sock(sock_); sock_ = INVALID_SOCK; return false;
        }
        if (::connect(sock_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
            close_sock(sock_); sock_ = INVALID_SOCK; return false;
        }
        return true;
    }

    void sendILP(const std::string& ilpLine) {
        if (sock_ == INVALID_SOCK) connectToQuestDB();
        if (sock_ == INVALID_SOCK) return;
#ifdef _WIN32
        int sent = ::send(sock_, ilpLine.c_str(), static_cast<int>(ilpLine.size()), 0);
#else
        ssize_t sent = ::send(sock_, ilpLine.c_str(), ilpLine.size(), 0);
#endif
        if (sent <= 0) {
            close_sock(sock_); sock_ = INVALID_SOCK;
            if (connectToQuestDB())
                ::send(sock_, ilpLine.c_str(), ilpLine.size(), 0);
        }
    }

    // ── order_status_event tag values ─────────────────────────────────────────
    static std::string orderStatusEventStr(OrderStatus s) {
        switch (s) {
            case OrderStatus::NEW:              return "ORDER_NEW";
            case OrderStatus::PARTIALLY_FILLED: return "ORDER_PARTIAL";
            case OrderStatus::FILLED:           return "ORDER_FILLED";
            case OrderStatus::CANCELLED:        return "ORDER_CANCELLED";
            case OrderStatus::EXPIRED:          return "ORDER_EXPIRED";
        }
        return "ORDER_UNKNOWN";
    }

    // ── Timestamp converters ──────────────────────────────────────────────────
    static long long toNanos(const std::chrono::system_clock::time_point& tp) {
        return std::chrono::duration_cast<std::chrono::nanoseconds>(
            tp.time_since_epoch()).count();
    }
    // Microseconds (as required by match_engine_timestamp / order_*_timestamp)
    static long long toMicros(const std::chrono::system_clock::time_point& tp) {
        return std::chrono::duration_cast<std::chrono::microseconds>(
            tp.time_since_epoch()).count();
    }

    // Returns true only for CANCELLED orders that have a valid cancel stamp.
    static bool isCancelledOrExpiredWithStamp(const Order& order) {
        return order.getStatus() == OrderStatus::CANCELLED &&
               order.getCancelTimestamp().time_since_epoch().count() != 0;
    }

    // ── Market-phase classification (mirrors Order::computeMarketPhase) ───────
    // IST = UTC + 5 h 30 m.  Pre-Open: 09:00–09:15.  Open: 09:15–15:30.
    static std::string marketPhaseFromTp(
        const std::chrono::system_clock::time_point& tp)
    {
        std::time_t tt = std::chrono::system_clock::to_time_t(tp);
        struct tm tmUtc{};
#ifdef _WIN32
        gmtime_s(&tmUtc, &tt);
#else
        gmtime_r(&tt, &tmUtc);
#endif
        int utcMin = tmUtc.tm_hour * 60 + tmUtc.tm_min;
        int istMin = (utcMin + 330) % (24 * 60);
        if (istMin >= 540 && istMin < 555) return "PRE_OPEN";
        if (istMin >= 555 && istMin < 930) return "OPEN";
        return "CLOSED";
    }

    // Replace ILP tag-special characters (space, comma, equals) with underscore.
    static std::string sanitizeTag(const std::string& val) {
        std::string out = val;
        for (char& c : out) {
            if (c == ' ' || c == ',' || c == '=') c = '_';
        }
        return out;
    }

    // sendHttpQuery — for one-off administrative SQL (not on hot path).
    void sendHttpQuery(const std::string& sql) {
        std::string encoded;
        encoded.reserve(sql.size() * 3);
        for (unsigned char c : sql) {
            if      (c == ' ')  encoded += "%20";
            else if (c == '\'') encoded += "%27";
            else if (c == '=')  encoded += "%3D";
            else if (c == '+')  encoded += "%2B";
            else if (c == '&')  encoded += "%26";
            else                encoded += static_cast<char>(c);
        }
        const std::string req =
            "GET /exec?query=" + encoded + " HTTP/1.0\r\n"
            "Host: 127.0.0.1\r\n"
            "Connection: close\r\n\r\n";
        socket_t s = ::socket(AF_INET, SOCK_STREAM, 0);
        if (s == INVALID_SOCK) return;
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port   = htons(9000);
        ::inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
        if (::connect(s, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == 0) {
#ifdef _WIN32
            ::send(s, req.c_str(), static_cast<int>(req.size()), 0);
#else
            ::send(s, req.c_str(), req.size(), 0);
#endif
            char buf[512];
            while (::recv(s, buf, sizeof(buf), 0) > 0) {}
        }
        close_sock(s);
    }

    // ── Members ───────────────────────────────────────────────────────────────
    std::string questdbHost_;
    int         questdbPort_;
    socket_t    sock_;
    std::mutex  mutex_;
};

#endif // LOGGER_HPP