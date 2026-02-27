#ifndef LOGGER_HPP
#define LOGGER_HPP

#include <mutex>
#include <string>
#include <sstream>
#include <chrono>
#include <cstdio>
#include "Order.hpp"

// ─── Platform-specific socket headers ────────────────────────────────────────
#ifdef _WIN32
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <winsock2.h>
#  include <ws2tcpip.h>
#  ifdef _MSC_VER
#    pragma comment(lib, "ws2_32.lib")  // MSVC auto-links; MinGW needs -lws2_32 on CLI
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
 * Logger – streams order logs directly to QuestDB via the InfluxDB Line Protocol
 * (ILP) over TCP on port 9009.  No local file is written.
 *
 * Table: trade_logs
 *   timestamp       TIMESTAMP  (designated, partition key)
 *   order_id        SYMBOL
 *   instrument_id   SYMBOL     numeric instrument ID (1–15), extracted from order_id
 *   order_type      SYMBOL     LIMIT | MARKET
 *   side            SYMBOL     BUY | SELL
 *   price           DOUBLE
 *   quantity        LONG       original order quantity
 *   status          SYMBOL     NEW | PARTIAL | FILLED | CANCELLED | EXPIRED
 *   filled_quantity LONG       quantity - remaining_quantity
 *   user_id         SYMBOL     matches users.id (10001, 10002, ...)
 *
 * One row is written per logOrder() call.
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

    // Disable copy
    Logger(const Logger&) = delete;
    Logger& operator=(const Logger&) = delete;

    // ── Public logging interface ──────────────────────────────────────────────

    /**
     * Log one order row to QuestDB trade_logs.
     * Called for every order placed by mock traders and real users,
     * and again when an order is cancelled (status = CANCELLED).
     *
     * Columns written:
     *   timestamp, order_id, order_type, side, price,
     *   quantity, status, filled_quantity, user_id
     */
    void logOrder(const Order& order) {
        const std::string ordType   = (order.getType() == OrderType::LIMIT) ? "LIMIT" : "MARKET";
        const std::string side      = (order.getSide() == OrderSide::BUY)   ? "BUY"   : "SELL";
        const std::string status    = statusStr(order.getStatus());
        const long long   qty       = static_cast<long long>(order.getQuantity());
        const long long   filledQty = static_cast<long long>(
                                          order.getQuantity() - order.getRemainingQuantity());
        const long long   ts        = toNanos(order.getTimestamp());
        const std::string orderId   = sanitizeTag(order.getOrderId());
        const std::string userId    = sanitizeTag(order.getTraderId());
        // Extract instrument_id directly from the order (avoids string-splitting)
        const std::string instrId   = std::to_string(order.getInstrumentId());

        // ── Build QuestDB ILP line ────────────────────────────────────────────
        // Tags (SYMBOL columns): order_id, instrument_id, order_type, side, status, user_id
        // Fields (numeric): price, quantity, filled_quantity
        std::ostringstream ilp;
        ilp << "trade_logs"
            << ",order_id="      << orderId
            << ",instrument_id=" << instrId
            << ",order_type="    << ordType
            << ",side="          << side
            << ",status="        << status
            << ",user_id="       << userId
            << " "
            << "price="            << std::fixed << order.getPrice()
            << ",quantity="        << qty       << "i"
            << ",filled_quantity=" << filledQty << "i"
            << " " << ts << "\n";

        // Lock ONLY for the fast TCP write — never hold the mutex during any
        // network round-trip. With 10 000 mock traders all calling logOrder()
        // concurrently, keeping the critical section tiny is essential so that
        // every order reaches QuestDB without queuing delay.
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
        // inet_pton works on Linux natively and on Windows via ws2tcpip.h (MinGW/MSVC)
        if (::inet_pton(AF_INET, questdbHost_.c_str(), &addr.sin_addr) != 1) {
            close_sock(sock_);
            sock_ = INVALID_SOCK;
            return false;
        }
        if (::connect(sock_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
            close_sock(sock_);
            sock_ = INVALID_SOCK;
            return false;
        }
        return true;
    }

    /** Send ILP line to QuestDB. Reconnects once on transient failures. */
    void sendILP(const std::string& ilpLine) {
        if (sock_ == INVALID_SOCK) connectToQuestDB();
        if (sock_ == INVALID_SOCK) return;  // QuestDB down – silently skip

#ifdef _WIN32
        int sent = ::send(sock_, ilpLine.c_str(), static_cast<int>(ilpLine.size()), 0);
#else
        ssize_t sent = ::send(sock_, ilpLine.c_str(), ilpLine.size(), 0);
#endif
        if (sent <= 0) {
            close_sock(sock_);
            sock_ = INVALID_SOCK;
            if (connectToQuestDB())
                ::send(sock_, ilpLine.c_str(), ilpLine.size(), 0);
        }
    }

    /** Replace ILP tag-special characters (space, comma, equals) with underscore. */
    static std::string sanitizeTag(const std::string& val) {
        std::string out = val;
        for (char& c : out) {
            if (c == ' ' || c == ',' || c == '=') c = '_';
        }
        return out;
    }

    /** Convert a system_clock time_point to nanoseconds since Unix epoch. */
    static long long toNanos(const std::chrono::system_clock::time_point& tp) {
        return std::chrono::duration_cast<std::chrono::nanoseconds>(
            tp.time_since_epoch()).count();
    }

    static std::string statusStr(OrderStatus s) {
        switch (s) {
            case OrderStatus::NEW:              return "NEW";
            case OrderStatus::PARTIALLY_FILLED: return "PARTIAL";
            case OrderStatus::FILLED:           return "FILLED";
            case OrderStatus::CANCELLED:        return "CANCELLED";
            case OrderStatus::EXPIRED:          return "EXPIRED";
        }
        return "UNKNOWN";
    }

    // sendHttpQuery is available for one-off administrative SQL calls
    // (not on the hot order-logging path — use ILP for trade_logs).
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