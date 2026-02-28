#ifndef ORDER_BOOK_HPP
#define ORDER_BOOK_HPP

#include <map>
#include <memory>
#include <mutex>
#include <atomic>
#include <thread>
#include <unordered_map>
#include <vector>
#include <chrono>
#include "PriceLevel.hpp"
#include "Trade.hpp"
#include "Logger.hpp"

// Orders expire if still pending (NEW or PARTIAL) after this many seconds.
static constexpr int ORDER_EXPIRY_SECONDS = 5;

class OrderBook {
public:
    explicit OrderBook(Logger* logger = nullptr)
        : logger_(logger)
        , totalVolume_(0), buyVolume_(0), sellVolume_(0), tradeCount_(0)
        , expiryRunning_(true)
    {
        // Background thread: expire orders that remain pending for > ORDER_EXPIRY_SECONDS.
        expiryThread_ = std::thread([this]() {
            while (expiryRunning_.load()) {
                std::this_thread::sleep_for(std::chrono::seconds(1));
                expirePendingOrders();
            }
        });
    }

    ~OrderBook() {
        expiryRunning_.store(false);
        if (expiryThread_.joinable())
            expiryThread_.join();
    }

    const std::map<double, std::shared_ptr<PriceLevel>, std::greater<double>>& getBuyLevels() const {
        return reinterpret_cast<const std::map<double, std::shared_ptr<PriceLevel>, std::greater<double>>&>(buyLevels_);
    }
    const std::map<double, std::shared_ptr<PriceLevel>>& getSellLevels() const {
        return sellLevels_;
    }

    void addOrder(std::shared_ptr<Order> order) {
        if (order->getSide() == OrderSide::BUY) {
            matchOrder(order, sellLevels_, buyLevels_);
        } else {
            matchOrder(order, buyLevels_, sellLevels_);
        }
    }

    void cancelOrder(const std::string& orderId) {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = orderMap_.find(orderId);
        if (it == orderMap_.end()) return;
        auto order = it->second;
        if (!order) { orderMap_.erase(it); return; }
        if (order->getStatus() == OrderStatus::CANCELLED ||
            order->getStatus() == OrderStatus::FILLED   ||
            order->getStatus() == OrderStatus::EXPIRED) return;
        removeOrderFromBook(order);
        order->cancel();
    }

    std::vector<Trade> getRecentTrades() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return recentTrades_;
    }

    double getBestBidPrice() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return buyLevels_.empty() ? 0.0 : buyLevels_.rbegin()->first;
    }

    double getBestAskPrice() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return sellLevels_.empty() ? 0.0 : sellLevels_.begin()->first;
    }

    // Volume statistics (lock-free atomics)
    size_t getTotalVolume()     const { return totalVolume_.load(); }
    size_t getTotalBuyVolume()  const { return buyVolume_.load();   }
    size_t getTotalSellVolume() const { return sellVolume_.load();  }
    size_t getTotalTradeCount() const { return tradeCount_.load();  }

private:
    void matchOrder(std::shared_ptr<Order> incomingOrder,
                    std::map<double, std::shared_ptr<PriceLevel>>& oppositeSide,
                    std::map<double, std::shared_ptr<PriceLevel>>& sameSide) {
        std::lock_guard<std::mutex> lock(mutex_);

        bool isFullyMatched = false;
        while (!oppositeSide.empty() && !isFullyMatched) {
            auto bestPrice = (incomingOrder->getSide() == OrderSide::BUY) ?
                             oppositeSide.begin()->first : oppositeSide.rbegin()->first;

            if ((incomingOrder->getSide() == OrderSide::BUY  && bestPrice > incomingOrder->getPrice()) ||
                (incomingOrder->getSide() == OrderSide::SELL && bestPrice < incomingOrder->getPrice()))
                break;

            auto priceLevel = (incomingOrder->getSide() == OrderSide::BUY) ?
                              oppositeSide.begin()->second : oppositeSide.rbegin()->second;

            while (!priceLevel->isEmpty() && incomingOrder->getRemainingQuantity() > 0) {
                auto restingOrder = priceLevel->getFirstOrder();
                if (!restingOrder) break; // defensive: price level should not yield null while !isEmpty()
                auto matchQty = std::min(incomingOrder->getRemainingQuantity(),
                                         restingOrder->getRemainingQuantity());
                executeTrade(incomingOrder, restingOrder, matchQty, bestPrice);
                if (restingOrder->getRemainingQuantity() == 0) removeOrderFromBook(restingOrder);
                if (incomingOrder->getRemainingQuantity() == 0) { isFullyMatched = true; break; }
            }

            if (priceLevel->isEmpty()) oppositeSide.erase(bestPrice);
        }

        if (!isFullyMatched && incomingOrder->getTimeInForce() != TimeInForce::IOC)
            addToBook(incomingOrder, sameSide);
    }

    void addToBook(std::shared_ptr<Order> order,
                   std::map<double, std::shared_ptr<PriceLevel>>& side) {
        auto price = order->getPrice();
        auto& priceLevel = side[price];
        if (!priceLevel) priceLevel = std::make_shared<PriceLevel>(price);
        priceLevel->addOrder(order);
        orderMap_[order->getOrderId()] = order;
    }

    void removeOrderFromBook(std::shared_ptr<Order> order) {
        auto price = order->getPrice();
        auto& side = (order->getSide() == OrderSide::BUY) ? buyLevels_ : sellLevels_;
        auto it = side.find(price);
        if (it != side.end()) {
            it->second->removeOrder(order->getOrderId());
            if (it->second->isEmpty()) side.erase(it);
        }
        orderMap_.erase(order->getOrderId());
    }

    void executeTrade(std::shared_ptr<Order> incomingOrder,
                      std::shared_ptr<Order> restingOrder,
                      size_t quantity, double price) {
        // ── Determine buyer / seller and aggressor side ───────────────────────
        // The INCOMING order is always the aggressor (it crossed the spread).
        const bool incomingIsBuy = (incomingOrder->getSide() == OrderSide::BUY);
        const std::string& buyerUserId  = incomingIsBuy
                                              ? incomingOrder->getTraderId()
                                              : restingOrder->getTraderId();
        const std::string& sellerUserId = incomingIsBuy
                                              ? restingOrder->getTraderId()
                                              : incomingOrder->getTraderId();
        const std::string& buyOrderId   = incomingIsBuy
                                              ? incomingOrder->getOrderId()
                                              : restingOrder->getOrderId();
        const std::string& sellOrderId  = incomingIsBuy
                                              ? restingOrder->getOrderId()
                                              : incomingOrder->getOrderId();

        // ── Build enriched Trade record FIRST — its tradeId is stamped into ──
        //    both Order objects so that ALL subsequent logOrder() calls for the
        //    incoming and resting orders carry real IDs (trade_id, buyer_user_id,
        //    seller_user_id) instead of "NA", for every status event row written
        //    to QuestDB (PARTIAL, FILLED, CANCELLED-after-partial, EXPIRED-after-partial).
        Trade trade(buyOrderId, sellOrderId,
                    price, quantity, std::chrono::system_clock::now(),
                    buyerUserId, sellerUserId,
                    incomingOrder->getSide(),          // aggressor_side
                    incomingOrder->getInstrumentId()); // instrument_id

        // ── Fill both sides, embedding Trade context into each Order ──────────
        // Any logOrder() call on these orders (now or later, e.g. expiry/cancel)
        // will write the real trade_id, buyer_user_id, seller_user_id.
        incomingOrder->fillWithTradeContext(quantity, trade.getTradeId(), buyerUserId, sellerUserId);
        restingOrder->fillWithTradeContext(quantity, trade.getTradeId(), buyerUserId, sellerUserId);

        recentTrades_.push_back(trade);
        if (recentTrades_.size() > 100) recentTrades_.erase(recentTrades_.begin());

        // Update volume counters
        totalVolume_ += quantity;
        tradeCount_  += 1;
        if (incomingIsBuy) buyVolume_  += quantity;
        else               sellVolume_ += quantity;

        if (logger_) {
            // Log the resting order's updated status (PARTIAL or FILLED).
            // The incoming order is logged by the caller after addOrder() returns.
            // Both now have trade context embedded so logOrder() produces full rows.
            logger_->logOrder(*restingOrder);

            // Log the matched TRADE_MATCH row — primary row for ML graph analysis.
            logger_->logTrade(trade);
        }
    }

    // ── Expiry: scan all pending orders and expire those older than ORDER_EXPIRY_SECONDS ──
    void expirePendingOrders() {
        auto now = std::chrono::system_clock::now();
        std::vector<std::shared_ptr<Order>> toExpire;

        {
            std::lock_guard<std::mutex> lock(mutex_);
            for (auto& kv : orderMap_) {
                auto& order = kv.second;
                if (!order) continue;
                auto status = order->getStatus();
                if (status != OrderStatus::NEW && status != OrderStatus::PARTIALLY_FILLED)
                    continue;
                auto ageSec = std::chrono::duration_cast<std::chrono::seconds>(
                    now - order->getTimestamp()).count();
                if (ageSec >= ORDER_EXPIRY_SECONDS)
                    toExpire.push_back(order);
            }
            // Remove expired orders from price levels and orderMap_
            for (auto& order : toExpire) {
                removeOrderFromBook(order);
                order->expire();
            }
        }

        // Log EXPIRED status to QuestDB outside the book mutex
        if (logger_) {
            for (auto& order : toExpire) {
                logger_->logOrder(*order);
            }
        }
    }

    std::map<double, std::shared_ptr<PriceLevel>> buyLevels_;
    std::map<double, std::shared_ptr<PriceLevel>> sellLevels_;
    std::unordered_map<std::string, std::shared_ptr<Order>> orderMap_;
    mutable std::mutex mutex_;
    std::vector<Trade> recentTrades_;
    Logger* logger_;

    std::atomic<size_t> totalVolume_;
    std::atomic<size_t> buyVolume_;
    std::atomic<size_t> sellVolume_;
    std::atomic<size_t> tradeCount_;

    // Expiry thread members
    std::atomic<bool>   expiryRunning_;
    std::thread         expiryThread_;
};

#endif // ORDER_BOOK_HPP
