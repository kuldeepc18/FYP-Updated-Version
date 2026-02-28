#ifndef ORDER_HPP
#define ORDER_HPP

#include <string>
#include <chrono>
#include <random>
#include <cstdint>
#include <cstdio>
#include <ctime>
#include "Instrument.hpp"

enum class OrderType {
    LIMIT,
    MARKET
};

enum class OrderSide {
    BUY,
    SELL
};

enum class TimeInForce {
    GTC,    // Good Till Cancelled
    IOC,    // Immediate or Cancel
    FOK,    // Fill or Kill
    DAY     // Day Order
};

enum class OrderStatus {
    NEW,
    PARTIALLY_FILLED,
    FILLED,
    CANCELLED,
    EXPIRED
};

class Order {
public:
    Order(OrderType type, OrderSide side, double price, size_t quantity,
          TimeInForce tif, const std::string& traderId, int instrumentId,
          bool isShortSell = false)
        : orderId_(generateOrderId(instrumentId, traderId))
        , type_(type)
        , side_(side)
        , price_(price)
        , quantity_(quantity)
        , remainingQuantity_(quantity)
        , timeInForce_(tif)
        , traderId_(traderId)
        , instrumentId_(instrumentId)
        , status_(OrderStatus::NEW)
        , submitTimestamp_(std::chrono::system_clock::now())
        , cancelTimestamp_()           // zero-initialised (epoch)
        , isShortSell_(isShortSell)
        , marketPhase_(computeMarketPhase(submitTimestamp_))
        , deviceIdHash_(computeDeviceIdHash(traderId))
    {}

    // ── Existing getters ──────────────────────────────────────────────────────
    const std::string& getOrderId()       const { return orderId_; }
    OrderType          getType()          const { return type_; }
    OrderSide          getSide()          const { return side_; }
    double             getPrice()         const { return price_; }
    size_t             getQuantity()      const { return quantity_; }
    size_t             getRemainingQuantity() const { return remainingQuantity_; }
    TimeInForce        getTimeInForce()   const { return timeInForce_; }
    const std::string& getTraderId()      const { return traderId_; }
    OrderStatus        getStatus()        const { return status_; }
    int                getInstrumentId()  const { return instrumentId_; }

    // Legacy alias — keep existing callers happy
    const std::chrono::system_clock::time_point& getTimestamp() const {
        return submitTimestamp_;
    }

    // ── New getters ───────────────────────────────────────────────────────────
    const std::chrono::system_clock::time_point& getSubmitTimestamp() const {
        return submitTimestamp_;
    }
    const std::chrono::system_clock::time_point& getCancelTimestamp() const {
        return cancelTimestamp_;
    }
    bool               isShortSell()      const { return isShortSell_; }
    const std::string& getMarketPhase()   const { return marketPhase_; }
    const std::string& getDeviceIdHash()  const { return deviceIdHash_; }

    // ── Setter (allows callers to flag a sell as a short-sell explicitly) ─────
    void setIsShortSell(bool v) { isShortSell_ = v; }

    // ── Public utility: deterministic FNV-1a device fingerprint ──────────────
    // Exposed as public static so Logger can compute a hash for the aggressor
    // user on TRADE_MATCH rows without needing an Order object.
    static std::string computeDeviceIdHash(const std::string& traderId) {
        uint32_t hash = 2166136261u; // FNV-1a offset basis
        for (unsigned char c : traderId) {
            hash ^= c;
            hash *= 16777619u; // FNV prime
        }
        char buf[9];
        std::snprintf(buf, sizeof(buf), "%08X", hash);
        return std::string(buf);
    }

    // ── Trade-context getters (populated by fillWithTradeContext) ─────────────
    // These let Logger::logOrder() write the real trade_id, buyer_user_id and
    // seller_user_id into every order-event row — even for non-TRADE_MATCH rows.
    // Before a match occurs the values are "NA" (same as before this change).
    const std::string& getMatchedTradeId()       const { return matchedTradeId_;        }
    const std::string& getCounterpartyBuyerUid() const { return counterpartyBuyerUid_;  }
    const std::string& getCounterpartySellerUid()const { return counterpartySellerUid_; }

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    void fill(size_t quantity) {
        remainingQuantity_ -= quantity;
        status_ = (remainingQuantity_ == 0) ? OrderStatus::FILLED
                                            : OrderStatus::PARTIALLY_FILLED;
    }

    // Called by OrderBook::executeTrade() — embeds full trade context into the
    // Order so that any subsequent logOrder() call carries the real IDs instead
    // of "NA".  Both the incoming order and the resting order receive the same
    // trade_id, buyer_user_id, seller_user_id for the matched execution.
    void fillWithTradeContext(size_t quantity,
                              const std::string& tradeId,
                              const std::string& buyerUid,
                              const std::string& sellerUid) {
        matchedTradeId_       = tradeId;
        counterpartyBuyerUid_ = buyerUid;
        counterpartySellerUid_= sellerUid;
        fill(quantity);
    }

    void cancel() {
        if (status_ != OrderStatus::CANCELLED &&
            status_ != OrderStatus::FILLED    &&
            status_ != OrderStatus::EXPIRED) {
            status_          = OrderStatus::CANCELLED;
            cancelTimestamp_ = std::chrono::system_clock::now(); // stamp cancel time
        }
    }

    void expire() {
        status_ = OrderStatus::EXPIRED;
    }

private:
    // ── Helpers ───────────────────────────────────────────────────────────────

    // Generates orderId as instrumentId-random10DigitNumber-traderId
    static std::string generateOrderId(int instrumentId, const std::string& traderId) {
        static std::random_device rd;
        static std::mt19937 gen(rd());
        static std::uniform_int_distribution<long long> dis(1000000000LL, 9999999999LL);
        return std::to_string(instrumentId) + "-" + std::to_string(dis(gen)) + "-" + traderId;
    }

    // ── Market-phase classification ───────────────────────────────────────────
    // Indian market schedule (IST = UTC + 5h 30m):
    //   Pre-Open  : 09:00 – 09:15
    //   Open      : 09:15 – 15:30
    //   Closed    : all other times
    static std::string computeMarketPhase(
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
        int istMin = (utcMin + 330) % (24 * 60); // IST = UTC + 5h 30m
        if (istMin >= 540 && istMin < 555) return "PRE_OPEN"; // 09:00–09:15
        if (istMin >= 555 && istMin < 930) return "OPEN";     // 09:15–15:30
        return "CLOSED";
    }

    // ── Members ───────────────────────────────────────────────────────────────
    std::string                          orderId_;
    OrderType                            type_;
    OrderSide                            side_;
    double                               price_;
    size_t                               quantity_;
    int                                  instrumentId_;
    size_t                               remainingQuantity_;
    TimeInForce                          timeInForce_;
    std::string                          traderId_;
    OrderStatus                          status_;

    // ── New timestamp fields ──────────────────────────────────────────────────
    std::chrono::system_clock::time_point submitTimestamp_;  // when order was placed
    std::chrono::system_clock::time_point cancelTimestamp_;  // epoch-zero until cancelled

    // ── New enrichment fields ─────────────────────────────────────────────────
    bool        isShortSell_;   // true if this is a naked/covered short sale
    std::string marketPhase_;   // PRE_OPEN | OPEN | CLOSED  (computed at placement)
    std::string deviceIdHash_;  // 8-char hex FNV-1a fingerprint of traderId

    // ── Trade-context fields (set by fillWithTradeContext, default "NA") ──────
    // Populated the moment this order participates in a match so that
    // Logger::logOrder() can write real IDs instead of "NA" for every status
    // event (PARTIAL, FILLED, and also CANCELLED/EXPIRED after partial fills).
    std::string matchedTradeId_        = "NA";
    std::string counterpartyBuyerUid_  = "NA";
    std::string counterpartySellerUid_ = "NA";
};

#endif // ORDER_HPP