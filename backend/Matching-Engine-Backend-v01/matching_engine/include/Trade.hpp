#ifndef TRADE_HPP
#define TRADE_HPP

#include <string>
#include <chrono>
#include <random>
#include <sstream>
#include "Order.hpp"  // for OrderSide

// ─────────────────────────────────────────────────────────────────────────────
//  Trade — represents a single matched execution between two orders.
//
//  New fields vs the original:
//    trade_id        — globally unique trade identifier (TRD-<instrId>-<random10>)
//    buyer_user_id   — traderId of the order that was on the BUY side
//    seller_user_id  — traderId of the order that was on the SELL side
//    aggressor_side  — side of the INCOMING (price-taking) order that triggered
//                      the match.  BUY = a buy order hit resting sell liquidity;
//                      SELL = a sell order hit resting buy liquidity.
//    instrument_id   — instrument on which the trade was executed
//
//  All five fields appear in `trade_logs` TRADE_MATCH rows so the ML model can
//  build the buyer-seller graph needed for circular/wash-trade detection.
// ─────────────────────────────────────────────────────────────────────────────
class Trade {
public:
    Trade(const std::string& buyOrderId,
          const std::string& sellOrderId,
          double             price,
          size_t             quantity,
          std::chrono::system_clock::time_point timestamp,
          const std::string& buyerUserId,
          const std::string& sellerUserId,
          OrderSide          aggressorSide,
          int                instrumentId)
        : buyOrderId_(buyOrderId)
        , sellOrderId_(sellOrderId)
        , price_(price)
        , quantity_(quantity)
        , timestamp_(timestamp)
        , tradeId_(generateTradeId(instrumentId))
        , buyerUserId_(buyerUserId)
        , sellerUserId_(sellerUserId)
        , aggressorSide_(aggressorSide)
        , instrumentId_(instrumentId)
    {}

    // ── Original getters (kept for backward compat) ───────────────────────────
    const std::string& getBuyOrderId()  const { return buyOrderId_;  }
    const std::string& getSellOrderId() const { return sellOrderId_; }
    double             getPrice()       const { return price_;       }
    size_t             getQuantity()    const { return quantity_;     }
    const std::chrono::system_clock::time_point& getTimestamp() const {
        return timestamp_;
    }

    // ── New getters ───────────────────────────────────────────────────────────
    const std::string& getTradeId()       const { return tradeId_;       }
    const std::string& getBuyerUserId()   const { return buyerUserId_;   }
    const std::string& getSellerUserId()  const { return sellerUserId_;  }
    OrderSide          getAggressorSide() const { return aggressorSide_; }
    int                getInstrumentId()  const { return instrumentId_;  }

private:
    // Trade ID format: TRD-<instrumentId>-<10-digit random>
    static std::string generateTradeId(int instrumentId) {
        static std::random_device rd;
        static std::mt19937 gen(rd());
        static std::uniform_int_distribution<long long> dis(1000000000LL, 9999999999LL);
        std::ostringstream oss;
        oss << "TRD-" << instrumentId << "-" << dis(gen);
        return oss.str();
    }

    // ── Original members ──────────────────────────────────────────────────────
    std::string                           buyOrderId_;
    std::string                           sellOrderId_;
    double                                price_;
    size_t                                quantity_;
    std::chrono::system_clock::time_point timestamp_;

    // ── New members ───────────────────────────────────────────────────────────
    std::string tradeId_;       // unique trade identifier
    std::string buyerUserId_;   // traderId of the buy-side participant
    std::string sellerUserId_;  // traderId of the sell-side participant
    OrderSide   aggressorSide_; // which side was the incoming (price-taking) order
    int         instrumentId_;  // instrument on which the trade was executed
};

#endif // TRADE_HPP