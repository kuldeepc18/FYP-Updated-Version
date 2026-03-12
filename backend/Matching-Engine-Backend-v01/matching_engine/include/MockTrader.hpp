#ifndef MOCK_TRADER_HPP
#define MOCK_TRADER_HPP

#include <random>
#include <thread>
#include <chrono>
#include <cmath>
#include <vector>
#include <mutex>
#include <condition_variable>
#include "OrderBook.hpp"
#include "Instrument.hpp"
#include "Logger.hpp"

// ═══════════════════════════════════════════════════════════════════════════════
//  MANIPULATION #1 — WASH TRADING  (trader ID 2500)
//  ─────────────────────────────────────────────────────────────────────────────
//  WASH_TRADER_ACTIVE   master on/off switch.
//    true  → trader #2500 fires back-to-back BUY+SELL pairs at the same price
//            and quantity, creating fake volume with no real position change.
//    false → trader #2500 reverts to a normal retail trader identical to the
//            other 9 996 retail participants. Flip this once the ML dataset is
//            complete and the manipulator signal is no longer needed.
//
//  WASH_TRADER_USER_ID  the trader ID stamped as the wash-trade manipulator.
//    QuestDB trade_logs will carry user_id = "2500" on both the BUY leg and
//    the SELL leg of every pair, giving the ML model a clean, labelable signal.
// ═══════════════════════════════════════════════════════════════════════════════
static constexpr bool   WASH_TRADER_ACTIVE   = false;  // ← false → all traders are retail
static constexpr int    WASH_TRADER_USER_ID  = 2500;

// ── Wash-trade burst parameters ───────────────────────────────────────────────
//  WASH_QUANTITY     shares placed on each BUY leg AND each SELL leg.
//  WASH_INTERVAL_MS  ms between the BUY leg and its mirrored SELL leg.
//  WASH_BURST_PAIRS  BUY+SELL pairs per burst (creates the repetitive pattern).
//  WASH_PAUSE_MS     idle gap between bursts (creates a periodic time signature).
// ─────────────────────────────────────────────────────────────────────────────
static constexpr size_t WASH_QUANTITY      = 10000; // shares per leg
static constexpr int    WASH_INTERVAL_MS   = 300;   // ms between BUY leg and SELL leg
static constexpr int    WASH_BURST_PAIRS   = 5;     // back-to-back pairs per burst
static constexpr int    WASH_PAUSE_MS      = 4000;  // ms idle between bursts

// ═══════════════════════════════════════════════════════════════════════════════
//  MANIPULATION #2 — CIRCULAR TRADING  (traders 2500 → 2600 → 2700 → 2800)
//  ─────────────────────────────────────────────────────────────────────────────
//  CIRCULAR_TRADING_ACTIVE  master on/off switch.
//    true  → a dedicated coordinator thread-group fires a perpetual directed
//            ring of trades:  2500 → 2600 → 2700 → 2800 → 2500, inflating
//            volume among a tiny closed group with minimal outside participation.
//    false → the ring coordinator never starts; all 4 IDs behave like normal
//            retail traders on their assigned instruments.
//            Flip this to false once the circular-trade ML labels are captured.
//
//  The ring runs on instrument 1 (RELIANCE INDUSTRIES) regardless of which
//  instrument each MockTrader thread happens to be assigned, because all four
//  ring IDs must share the SAME order book to cross matching orders.
//
//  Full one-rotation cycle (8 sequential order placements):
//    Step 0 : user 2500  BUY  CIRCULAR_QUANTITY @ ringPrice  → sits in book
//    Step 1 : user 2600  SELL CIRCULAR_QUANTITY @ ringPrice  → matches 2500 BUY  ★
//    Step 2 : user 2600  BUY  CIRCULAR_QUANTITY @ ringPrice  → sits in book
//    Step 3 : user 2700  SELL CIRCULAR_QUANTITY @ ringPrice  → matches 2600 BUY  ★
//    Step 4 : user 2700  BUY  CIRCULAR_QUANTITY @ ringPrice  → sits in book
//    Step 5 : user 2800  SELL CIRCULAR_QUANTITY @ ringPrice  → matches 2700 BUY  ★
//    Step 6 : user 2800  BUY  CIRCULAR_QUANTITY @ ringPrice  → sits in book
//    Step 7 : user 2500  SELL CIRCULAR_QUANTITY @ ringPrice  → matches 2800 BUY  ★
//    → pause CIRCULAR_PAUSE_MS → repeat
//
//  ML-detectable red flags in QuestDB trade_logs:
//    ✦ Directed-cycle graph 2500→2600→2700→2800→2500 visible via network analysis
//    ✦ High trade volume concentrated in a tiny 4-member closed group
//    ✦ Near-zero net position change for any ring member across a full rotation
//    ✦ Minimal outside-participant involvement in ring trades
//    ✦ Identical, large quantity on every ring order (CIRCULAR_QUANTITY = 5 000)
//    ✦ Periodic timing signature (~CIRCULAR_STEP_MS × 8 per cycle)
//    ✦ Sudden, sustained volume spike on instrument 1 (RELIANCE)
// ═══════════════════════════════════════════════════════════════════════════════
static constexpr bool   CIRCULAR_TRADING_ACTIVE = false; // ← false → ring disabled, all traders are retail
static constexpr size_t CIRCULAR_QUANTITY        = 5000;  // shares per ring order
static constexpr int    CIRCULAR_STEP_MS         = 500;   // ms between ring steps
static constexpr int    CIRCULAR_PAUSE_MS        = 3000;  // ms pause between full rotations
static constexpr double CIRCULAR_PRICE_JITTER    = 0.002; // ±0.2 % price noise per rotation

// Ring member IDs — defines the directed cycle 2500 → 2600 → 2700 → 2800 → 2500
static const int CIRCULAR_RING_IDS[4] = {2500, 2600, 2700, 2800};

// ═══════════════════════════════════════════════════════════════════════════════
//  MANIPULATION #3 — SPOOFING  (traders 1..15, one per instrument)
//  ─────────────────────────────────────────────────────────────────────────────
//  SPOOFING_ACTIVE   master on/off switch.
//    true  → traders with IDs 1–15 (one per instrument) each run a spoofing
//            cycle: place a very large fake LIMIT order (buy or sell), let it
//            sit visible in the order book, then cancel it with a high and
//            variable probability (>60 %).  Immediately after, they place a
//            real LIMIT-IOC order in the opposite direction to profit from the
//            artificial price movement they created.
//    false → all 15 traders revert to their archetype (SPOOFING enum value is
//            treated as NOISE by the dispatch switch).
//
//  SPOOF_MIN_USER_ID / SPOOF_MAX_USER_ID
//    Range of mock-trader integer IDs that are designated as spoof manipulators.
//    MockTrader::mockTraderCount starts at 1, so the first 15 traders created —
//    one per instrument — receive IDs 1..15 and are marked isSpoofTrader_=true.
//
//  QuestDB trade_logs will carry:
//    trader_type        = MANIPULATOR  for any order row from traders 1..15
//    buyer_trader_type  = MANIPULATOR  on any TRADE_MATCH row where buyer  ∈ {1..15}
//    seller_trader_type = MANIPULATOR  on any TRADE_MATCH row where seller ∈ {1..15}
// ═══════════════════════════════════════════════════════════════════════════════
static constexpr bool   SPOOFING_ACTIVE          = true;
static constexpr int    SPOOF_MIN_USER_ID         = 1;       // first manipulator ID
static constexpr int    SPOOF_MAX_USER_ID         = 15;      // last  manipulator ID

// ── Spoof order (the large fake leg) ─────────────────────────────────────────
static constexpr size_t SPOOF_LARGE_QTY_MIN       = 50000;   // min fake-order quantity
static constexpr size_t SPOOF_LARGE_QTY_MAX       = 150000;  // max fake-order quantity

// ── Real opposite trade (the actual profit-taking leg) ────────────────────────
static constexpr size_t SPOOF_REAL_QTY_MIN        = 5000;    // min real-trade quantity
static constexpr size_t SPOOF_REAL_QTY_MAX        = 30000;   // max real-trade quantity

// ── Timing parameters ─────────────────────────────────────────────────────────
static constexpr int    SPOOF_CANCEL_WAIT_MIN_MS  = 300;     // how long the fake order shows
static constexpr int    SPOOF_CANCEL_WAIT_MAX_MS  = 1200;
static constexpr double SPOOF_CANCEL_RATE_MIN     = 0.65;    // variable cancel rate, >60 %
static constexpr double SPOOF_CANCEL_RATE_MAX     = 0.92;
static constexpr int    SPOOF_PAUSE_MIN_MS        = 120;     // pause between spoof cycles (reduced for higher frequency)
static constexpr int    SPOOF_PAUSE_MAX_MS        = 450;      // reduced to generate 45k-50k manipulative trades

// ─────────────────────────────────────────────────────────────────────────────
//  CircularRingCoordinator
//  ─────────────────────────────────────────────────────────────────────────────
//  Singleton that manages 4 dedicated threads — one per ring member ID.
//  Each thread waits on a condition variable until the shared step counter
//  reaches its turn in the 8-step cycle, places a LIMIT order, sleeps
//  CIRCULAR_STEP_MS, then signals the next thread.
//
//  TradingApplication::start() calls:
//    CircularRingCoordinator::instance().init(orderBooks_[1], &logger_, 1);
//    CircularRingCoordinator::instance().start();
//  TradingApplication cleanup calls:
//    CircularRingCoordinator::instance().stop();
// ─────────────────────────────────────────────────────────────────────────────
class CircularRingCoordinator {
public:
    static CircularRingCoordinator& instance() {
        static CircularRingCoordinator inst;
        return inst;
    }

    // Must be called BEFORE start(). Supplies the shared orderbook and logger.
    void init(std::shared_ptr<OrderBook> ob, Logger* log, int instrId) {
        std::lock_guard<std::mutex> lk(mtx_);
        orderBook_ = ob;
        logger_    = log;
        instrId_   = instrId;
    }

    void start() {
        if (!CIRCULAR_TRADING_ACTIVE) return;
        {
            std::lock_guard<std::mutex> lk(mtx_);
            if (!orderBook_) return; // init() was not called
            running_   = true;
            step_      = 0;
            ringPrice_ = 0.0;
        }
        // Spawn one thread per ring member — they self-coordinate via step_ + cv_
        for (int i = 0; i < 4; ++i)
            threads_.emplace_back(&CircularRingCoordinator::ringMemberLoop, this, i);
    }

    void stop() {
        {
            std::lock_guard<std::mutex> lk(mtx_);
            running_ = false;
        }
        cv_.notify_all();
        for (auto& t : threads_)
            if (t.joinable()) t.join();
        threads_.clear();
    }

private:
    // ── 8-step cycle table ────────────────────────────────────────────────────
    // memberIdx : index into CIRCULAR_RING_IDS[] (0=2500, 1=2600, 2=2700, 3=2800)
    // side      : which side this step places
    // setPrice  : true → anchors a fresh ringPrice from current market + jitter
    //             false → inherits ringPrice from the preceding BUY step so that
    //                     the SELL matches the partner BUY at exactly the same price
    struct StepSpec { int memberIdx; OrderSide side; bool setPrice; };
    static const StepSpec CYCLE[8];

    // ── Per-member thread body ────────────────────────────────────────────────
    void ringMemberLoop(int memberIdx) {
        std::mt19937 eng(std::random_device{}());
        std::uniform_real_distribution<double> jitter(
            1.0 - CIRCULAR_PRICE_JITTER, 1.0 + CIRCULAR_PRICE_JITTER);
        const std::string traderId = std::to_string(CIRCULAR_RING_IDS[memberIdx]);

        while (true) {
            // ── Block until it's this member's turn in the 8-step cycle ──────
            double    price = 0.0;
            OrderSide side  = OrderSide::BUY;
            {
                std::unique_lock<std::mutex> lk(mtx_);
                cv_.wait(lk, [&] {
                    return !running_ || CYCLE[step_ % 8].memberIdx == memberIdx;
                });
                if (!running_) break;

                const StepSpec& spec = CYCLE[step_ % 8];
                side = spec.side;

                if (spec.setPrice) {
                    // BUY step — anchor a fresh ring price from the live LTP
                    double mkt = InstrumentManager::getInstance().getLTP(instrId_);
                    price      = std::round(mkt * jitter(eng) * 100.0) / 100.0;
                    ringPrice_ = price; // stored so the next SELL step can reuse it
                } else {
                    // SELL step — inherit the price from the immediately preceding
                    // BUY step.  Matching price on both legs is a core red flag.
                    price = ringPrice_;
                }
                ++step_; // advance the shared step counter (still under the lock)
            }

            // ── Place the circular ring order (outside the lock) ──────────────
            if (orderBook_) {
                auto order = std::make_shared<Order>(
                    OrderType::LIMIT,
                    side,
                    price,
                    CIRCULAR_QUANTITY,
                    TimeInForce::GTC,
                    traderId,   // user_id = "2500" / "2600" / "2700" / "2800"
                    instrId_);
                orderBook_->addOrder(order);
                if (logger_) logger_->logOrder(*order);
            }

            // ── Pause BEFORE waking the next ring member ──────────────────────
            // The sleep happens BEFORE cv_.notify_all() so the next thread waits
            // the full CIRCULAR_STEP_MS between consecutive order placements —
            // even when two consecutive steps belong to the same member (e.g.
            // 2600 SELL at step 1 followed by 2600 BUY at step 2).
            bool rotationComplete;
            {
                std::lock_guard<std::mutex> lk(mtx_);
                rotationComplete = (step_ % 8 == 0);
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(
                rotationComplete ? CIRCULAR_PAUSE_MS : CIRCULAR_STEP_MS));

            // ── Signal all ring member threads — the next one whose predicate
            //    is true will unblock; the others go right back to sleep ───────
            cv_.notify_all();
        }
    }

    // ── Private constructor / copy-delete (singleton) ─────────────────────────
    CircularRingCoordinator()  = default;
    ~CircularRingCoordinator() { stop(); }
    CircularRingCoordinator(const CircularRingCoordinator&) = delete;
    CircularRingCoordinator& operator=(const CircularRingCoordinator&) = delete;

    // ── Members ───────────────────────────────────────────────────────────────
    std::shared_ptr<OrderBook>  orderBook_;
    Logger*                     logger_    = nullptr;
    int                         instrId_   = 1;
    bool                        running_   = false;
    int                         step_      = 0;    // 0-7, shared step counter
    double                      ringPrice_ = 0.0;  // price anchored by BUY steps
    std::mutex                  mtx_;
    std::condition_variable     cv_;
    std::vector<std::thread>    threads_;
};

// Out-of-class definition of the static CYCLE table
// (required in C++17 for non-inline static data members)
inline const CircularRingCoordinator::StepSpec CircularRingCoordinator::CYCLE[8] = {
    {0, OrderSide::BUY,  true },  // step 0 : 2500 BUY  — anchors ringPrice
    {1, OrderSide::SELL, false},  // step 1 : 2600 SELL — matches 2500's BUY  ★
    {1, OrderSide::BUY,  true },  // step 2 : 2600 BUY  — anchors new ringPrice
    {2, OrderSide::SELL, false},  // step 3 : 2700 SELL — matches 2600's BUY  ★
    {2, OrderSide::BUY,  true },  // step 4 : 2700 BUY  — anchors new ringPrice
    {3, OrderSide::SELL, false},  // step 5 : 2800 SELL — matches 2700's BUY  ★
    {3, OrderSide::BUY,  true },  // step 6 : 2800 BUY  — anchors new ringPrice
    {0, OrderSide::SELL, false},  // step 7 : 2500 SELL — matches 2800's BUY  ★
};


class MockTrader {
public:
    // ── Trader archetypes ─────────────────────────────────────────────────────
    // Assignment per instrument (200 traders total):
    //   1 SPOOFING  manipulator (ID 1..15, one per instrument) — runs first
    //   i <  10 → MARKET_MAKER   (10,  5%) — continuous two-sided quotes
    //   i <  59 → MOMENTUM       (49, ~25%) — trend-following, LTP history driven
    //   i <  79 → MEAN_REVERSION (20, 10%) — buys dips, sells rallies
    //   i < 199 → NOISE          (120,~60%) — OU-biased random retail orders
    // 15 instruments × 200 traders = 3 000 total mock traders.
    enum class Archetype { NOISE, MOMENTUM, MEAN_REVERSION, MARKET_MAKER, SPOOFING };

    static int mockTraderCount;

    MockTrader(std::shared_ptr<OrderBook> orderBook, int instrumentId,
               Logger* logger = nullptr, Archetype archetype = Archetype::NOISE)
        : orderBook_(orderBook)
        , instrumentId_(instrumentId)
        , running_(false)
        , archetype_(archetype)
        , engine_(std::random_device{}())
        , washPriceJitter_(0.999, 1.001) // ±0.1 % price noise (wash trader)
        , logger_(logger)
    {
        if (mockTraderCount >= 10000)
            throw std::runtime_error("Max 10 000 mock traders allowed");

        int myId  = mockTraderCount++;
        traderId_ = std::to_string(myId);

        // Designate trader #2500 as the wash-trade manipulator.
        // Flip WASH_TRADER_ACTIVE to false to revert #2500 to its assigned archetype.
        isWashTrader_ = (WASH_TRADER_ACTIVE && myId == WASH_TRADER_USER_ID);

        // Designate traders #1..#15 as spoofing manipulators (one per instrument).
        // mockTraderCount starts at 1, so these are the first 15 traders created.
        // Flip SPOOFING_ACTIVE to false to revert them to their assigned archetype.
        isSpoofTrader_ = (SPOOFING_ACTIVE &&
                          myId >= SPOOF_MIN_USER_ID &&
                          myId <= SPOOF_MAX_USER_ID);
    }

    void start() {
        running_ = true;
        thread_ = std::thread(&MockTrader::run, this);
    }

    void stop() {
        running_ = false;
        if (thread_.joinable())
            thread_.join();
    }

private:
    Logger* logger_;

    // ──────────────────────────────────────────────────────────────────────────
    //  NOISE TRADER  (120 per instrument, 60%)
    //
    //  Enhanced retail trader that:
    //    • Uses true LTP (not stale mid-price) as the reference price
    //    • Uses OU priceTrend to bias buy/sell probability
    //    • Reduced spread ±2% (was ±5%) so more orders actually match
    //    • 25% chance of MARKET order (IOC); 75% LIMIT (GTC)
    //
    //  Buy probability = clamp(0.5 + priceTrend × 0.5, 0.1, 0.9)
    //    priceTrend = +0.20 → buyProb = 0.60 (60% buyers)
    //    priceTrend = −0.20 → buyProb = 0.40 (40% buyers)
    // ──────────────────────────────────────────────────────────────────────────
    void runNoise() {
        std::uniform_int_distribution<int>     sleepDist(100, 2000);
        std::uniform_real_distribution<double>  spreadDist(0.98, 1.02); // ±2%
        std::uniform_int_distribution<size_t>   qtyDist(1, 100);
        std::uniform_real_distribution<double>  uni(0.0, 1.0);
        std::uniform_int_distribution<int>      typeDist(0, 3); // 0 → MARKET (25%)

        while (running_) {
            // ── 52% chance to cancel one resting GTC order before placing a
            //    new one — realistic market cancellation rate per financial market data
            maybeCancelGTCOrder(0.52);

            std::this_thread::sleep_for(std::chrono::milliseconds(sleepDist(engine_)));

            double ltp    = InstrumentManager::getInstance().getLTP(instrumentId_);
            double trend  = InstrumentManager::getInstance().getPriceTrend(instrumentId_);
            // Clamp buy probability to [0.1, 0.9]
            double buyProb = std::max(0.1, std::min(0.9, 0.5 + trend * 0.5));

            OrderSide side      = (uni(engine_) < buyProb) ? OrderSide::BUY : OrderSide::SELL;
            bool      isMarket  = (typeDist(engine_) == 0);
            OrderType orderType = isMarket ? OrderType::MARKET : OrderType::LIMIT;

            double      price;
            TimeInForce tif;
            if (isMarket) {
                // MARKET orders: slight buffer toward the direction, IOC so
                // unmatched portion is dropped immediately (not added to book).
                price = (side == OrderSide::BUY) ? ltp * 1.002 : ltp * 0.998;
                tif   = TimeInForce::IOC;
            } else {
                price = ltp * spreadDist(engine_);
                tif   = TimeInForce::GTC;
            }

            auto qty   = qtyDist(engine_);
            auto order = std::make_shared<Order>(
                orderType, side, price, qty, tif, traderId_, instrumentId_);
            orderBook_->addOrder(order);
            if (logger_) logger_->logOrder(*order);
            // Track GTC LIMIT orders so they are eligible for future cancellation.
            // IOC / MARKET orders dispose of themselves and are not tracked.
            if (!isMarket) trackGTCOrder(order);
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  MOMENTUM TRADER  (50 per instrument, 25%)
    //
    //  Reads the last 5 LTP values and chases short-term price direction:
    //    shortReturn = (hist[4] − hist[0]) / hist[0]
    //    > +0.002 → 70% BUY,  price = ltp × 1.003 (direction-chasing)
    //    < −0.002 → 30% BUY,  price = ltp × 0.997
    //    else     → falls back to OU priceTrend bias
    //
    //  Acts as a positive-feedback amplifier: rising LTP creates more buy orders
    //  → more matches → LTP rises further → more momentum buying.
    //  The OU mean-reversion in priceTrend eventually terminates the trend.
    // ──────────────────────────────────────────────────────────────────────────
    void runMomentum() {
        std::uniform_int_distribution<int>     sleepDist(200, 1500);
        std::uniform_int_distribution<size_t>  qtyDist(5, 50);
        std::uniform_real_distribution<double> uni(0.0, 1.0);

        while (running_) {
            // ── 48% chance to cancel a pending order that may now be against
            //    the updated trend direction — realistic cancellation rate per market data
            maybeCancelGTCOrder(0.48);

            std::this_thread::sleep_for(std::chrono::milliseconds(sleepDist(engine_)));

            double ltp    = InstrumentManager::getInstance().getLTP(instrumentId_);
            auto   hist   = InstrumentManager::getInstance().getLTPHistory(instrumentId_, 5);

            double buyBias   = 0.5;

            if (hist.size() >= 2) {
                double shortReturn = (hist.back() - hist.front()) / hist.front();
                if (shortReturn > 0.002) {
                    buyBias   = 0.70;
                } else if (shortReturn < -0.002) {
                    buyBias   = 0.30;
                } else {
                    double trend = InstrumentManager::getInstance().getPriceTrend(instrumentId_);
                    buyBias = std::max(0.1, std::min(0.9, 0.5 + trend * 0.5));
                }
            } else {
                double trend = InstrumentManager::getInstance().getPriceTrend(instrumentId_);
                buyBias = std::max(0.1, std::min(0.9, 0.5 + trend * 0.5));
            }

            OrderSide side = (uni(engine_) < buyBias) ? OrderSide::BUY : OrderSide::SELL;
            // Place order slightly in the momentum direction (0.3% offset)
            double actualDir = (side == OrderSide::BUY) ? 1.0 : -1.0;
            double price     = ltp * (1.0 + actualDir * 0.003);
            auto   qty       = qtyDist(engine_);

            auto order = std::make_shared<Order>(
                OrderType::LIMIT, side, price, qty,
                TimeInForce::GTC, traderId_, instrumentId_);
            orderBook_->addOrder(order);
            if (logger_) logger_->logOrder(*order);
            // Track for future cancellation when the trend reverses.
            trackGTCOrder(order);
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  MEAN-REVERSION TRADER  (20 per instrument, 10%)
    //
    //  Computes the rolling average of the last 20 LTP samples:
    //    deviation = (currentLTP − ltpAvg) / ltpAvg
    //    > +1%  → sell bias (60% SELL) — price above mean, expect reversion
    //    < −1%  → buy  bias (60% BUY)  — price below mean, expect bounce
    //
    //  Order price is anchored toward the rolling mean, not at LTP.
    //  These traders act as the natural damper that limits trend extension,
    //  opposing the momentum traders and creating realistic oscillation.
    // ──────────────────────────────────────────────────────────────────────────
    void runMeanReversion() {
        std::uniform_int_distribution<int>     sleepDist(300, 2000);
        std::uniform_int_distribution<size_t>  qtyDist(5, 50);
        std::uniform_real_distribution<double> uni(0.0, 1.0);

        while (running_) {
            // ── 45% chance to cancel a resting order whose price may now be
            //    far from the updated rolling mean — realistic market cancellation rate
            maybeCancelGTCOrder(0.45);

            std::this_thread::sleep_for(std::chrono::milliseconds(sleepDist(engine_)));

            double ltp    = InstrumentManager::getInstance().getLTP(instrumentId_);
            auto   hist   = InstrumentManager::getInstance().getLTPHistory(instrumentId_, 20);

            double buyBias    = 0.5;
            double targetPrice = ltp;

            if (hist.size() >= 5) {
                double sum = 0.0;
                for (double v : hist) sum += v;
                double ltpAvg   = sum / hist.size();
                double deviation = (ltp - ltpAvg) / ltpAvg;

                if (deviation > 0.01) {
                    // Price above rolling mean — lean sell
                    buyBias     = 0.40;
                    targetPrice = ltpAvg * 0.999; // target a little below the mean
                } else if (deviation < -0.01) {
                    // Price below rolling mean — lean buy
                    buyBias     = 0.60;
                    targetPrice = ltpAvg * 1.001; // target a little above the mean
                } else {
                    targetPrice = ltpAvg;
                }
            }

            OrderSide side = (uni(engine_) < buyBias) ? OrderSide::BUY : OrderSide::SELL;
            auto qty       = qtyDist(engine_);
            // Price converges toward the rolling average (mean-reverting anchor)
            double price = (side == OrderSide::BUY) ? targetPrice * 1.001 : targetPrice * 0.999;

            auto order = std::make_shared<Order>(
                OrderType::LIMIT, side, price, qty,
                TimeInForce::GTC, traderId_, instrumentId_);
            orderBook_->addOrder(order);
            if (logger_) logger_->logOrder(*order);
            // Track for future cancellation when the mean shifts.
            trackGTCOrder(order);
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  MARKET MAKER  (10 per instrument, 5%)
    //
    //  Always places TWO resting limit orders simultaneously:
    //    BUY  at ltp × (1 − 0.002)  — 0.2% below LTP
    //    SELL at ltp × (1 + 0.002)  — 0.2% above LTP
    //  Total spread = 0.4%. Quantity: 5–30 shares (small lots for high turnover).
    //  Sleep: 50–500 ms (the most active archetype).
    //
    //  Market makers guarantee continuous two-sided liquidity.  Without them,
    //  directional blobs of orders have no counterparty and MARKET orders fail.
    //  Their tight quotes also keep the best bid-ask spread realistic and ensure
    //  that noise traders' ±2% orders frequently find a resting counterparty.
    //
    //  Price impact: as LTP rises, the market maker's freshly placed ask rises
    //  with it, so their quotes always anchor near the true market clearing price.
    // ──────────────────────────────────────────────────────────────────────────
    void runMarketMaker() {
        std::uniform_int_distribution<int>    sleepDist(50, 500);
        std::uniform_int_distribution<size_t> qtyDist(5, 30);
        const double halfSpread = 0.002; // 0.2% each side (0.4% total)

        while (running_) {
            std::this_thread::sleep_for(std::chrono::milliseconds(sleepDist(engine_)));

            // ── Cancel ALL stale resting quotes before refreshing ─────────────
            // Real market makers perform a continuous cancel-and-replace cycle:
            // they pull their old bid/ask from the book whenever the LTP moves
            // so that their quotes always sit near the current fair value.
            // This produces a steady stream of ORDER_CANCELLED events —
            // exactly as seen in production exchange data.
            // Probability 0.80: on 4 out of 5 iterations all old quotes are
            // cancelled; the remaining 1 in 5 lets a quote stay to simulate
            // deliberate passive resting (adds realism without being 100%).
            maybeCancelGTCOrder(0.80);

            double ltp = InstrumentManager::getInstance().getLTP(instrumentId_);
            auto   qty = qtyDist(engine_);

            // Place BUY quote below LTP
            auto buyOrder = std::make_shared<Order>(
                OrderType::LIMIT, OrderSide::BUY,
                ltp * (1.0 - halfSpread), qty,
                TimeInForce::GTC, traderId_, instrumentId_);
            orderBook_->addOrder(buyOrder);
            if (logger_) logger_->logOrder(*buyOrder);
            // Track the new bid so it can be cancelled on the next iteration.
            trackGTCOrder(buyOrder);

            // Place SELL quote above LTP
            auto sellOrder = std::make_shared<Order>(
                OrderType::LIMIT, OrderSide::SELL,
                ltp * (1.0 + halfSpread), qty,
                TimeInForce::GTC, traderId_, instrumentId_);
            orderBook_->addOrder(sellOrder);
            if (logger_) logger_->logOrder(*sellOrder);
            // Track the new ask so it can be cancelled on the next iteration.
            trackGTCOrder(sellOrder);
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  SPOOFING MANIPULATOR  (traders 1–15, one per instrument)
    //
    //  Spoofing cycle (repeats indefinitely — no trade-count cap):
    //
    //  1. Choose direction randomly:
    //       spoofBuy   = true  → place large fake BUY (simulate demand), real SELL
    //       spoofBuy   = false → place large fake SELL (simulate supply), real BUY
    //
    //  2. Submit the large LIMIT GTC "spoof" order so it sits visibly in the
    //     order book.  Quantity: SPOOF_LARGE_QTY_MIN – SPOOF_LARGE_QTY_MAX.
    //     Price is set conservatively (spoof BUY below LTP, spoof SELL above LTP)
    //     so the order is unlikely to match immediately.
    //
    //  3. Let the order rest for SPOOF_CANCEL_WAIT_MIN_MS – SPOOF_CANCEL_WAIT_MAX_MS
    //     milliseconds so other participants perceive the artificial demand/supply.
    //
    //  4. Cancel the spoof order with a variable but high probability >60 %
    //     (drawn each cycle from SPOOF_CANCEL_RATE_MIN – SPOOF_CANCEL_RATE_MAX).
    //     The ORDER_CANCELLED event is logged to QuestDB.
    //
    //  5. Immediately place the real LIMIT-IOC trade in the OPPOSITE direction
    //     (smaller quantity SPOOF_REAL_QTY_MIN – SPOOF_REAL_QTY_MAX) at a price
    //     slightly inside the spread so it executes against resting orders that
    //     reacted to the artificial signal.
    //
    //  6. Pause SPOOF_PAUSE_MIN_MS – SPOOF_PAUSE_MAX_MS ms and repeat.
    //
    //  QuestDB trade_logs labels:
    //    trader_type        = MANIPULATOR on every order/trade row from this trader
    //    buyer_trader_type  = MANIPULATOR when this trader is the buyer leg
    //    seller_trader_type = MANIPULATOR when this trader is the seller leg
    // ──────────────────────────────────────────────────────────────────────────
    void runSpoofing() {
        std::uniform_int_distribution<size_t>  spoofQtyDist(SPOOF_LARGE_QTY_MIN,
                                                             SPOOF_LARGE_QTY_MAX);
        std::uniform_int_distribution<size_t>  realQtyDist(SPOOF_REAL_QTY_MIN,
                                                            SPOOF_REAL_QTY_MAX);
        std::uniform_int_distribution<int>     cancelWaitDist(SPOOF_CANCEL_WAIT_MIN_MS,
                                                               SPOOF_CANCEL_WAIT_MAX_MS);
        std::uniform_int_distribution<int>     pauseDist(SPOOF_PAUSE_MIN_MS,
                                                          SPOOF_PAUSE_MAX_MS);
        std::uniform_real_distribution<double> uni(0.0, 1.0);
        std::uniform_real_distribution<double> cancelRateDist(SPOOF_CANCEL_RATE_MIN,
                                                               SPOOF_CANCEL_RATE_MAX);

        while (running_) {
            // ── Sanity check: wait for a valid LTP ───────────────────────────
            double ltp = InstrumentManager::getInstance().getLTP(instrumentId_);
            if (ltp <= 0.0) {
                std::this_thread::sleep_for(std::chrono::milliseconds(500));
                continue;
            }

            // ── Step 1: choose spoof direction ───────────────────────────────
            //   spoofBuy = true  → fake BUY demand, then real SELL
            //   spoofBuy = false → fake SELL supply, then real BUY
            bool      spoofBuy  = (uni(engine_) < 0.5);
            OrderSide spoofSide = spoofBuy ? OrderSide::BUY  : OrderSide::SELL;
            OrderSide realSide  = spoofBuy ? OrderSide::SELL : OrderSide::BUY;

            // Spoof price: conservative — below LTP for BUY, above LTP for SELL
            // so the order parks in the book without triggering an immediate match.
            double spoofPrice = spoofBuy
                ? std::round(ltp * 0.997 * 100.0) / 100.0   // BUY: 0.3% below LTP
                : std::round(ltp * 1.003 * 100.0) / 100.0;  // SELL: 0.3% above LTP

            size_t spoofQty = spoofQtyDist(engine_);

            // ── Step 2: submit the large fake (spoof) order ──────────────────
            auto spoofOrder = std::make_shared<Order>(
                OrderType::LIMIT, spoofSide,
                spoofPrice, spoofQty,
                TimeInForce::GTC,   // GTC: rests in the book until cancelled
                traderId_, instrumentId_);
            orderBook_->addOrder(spoofOrder);
            if (logger_) logger_->logOrder(*spoofOrder);   // → ORDER_NEW in QuestDB

            // ── Step 3: let participants observe the large order ─────────────
            int waitMs = cancelWaitDist(engine_);
            std::this_thread::sleep_for(std::chrono::milliseconds(waitMs));
            if (!running_) break;

            // ── Step 4: cancel with high but variable rate (>60 %) ───────────
            {
                auto status = spoofOrder->getStatus();
                if (status == OrderStatus::NEW ||
                    status == OrderStatus::PARTIALLY_FILLED) {
                    double cancelRate = cancelRateDist(engine_);
                    if (uni(engine_) < cancelRate) {
                        orderBook_->cancelOrder(spoofOrder->getOrderId());
                        // Log ORDER_CANCELLED to QuestDB for ML detection
                        if (logger_ && spoofOrder->getStatus() == OrderStatus::CANCELLED)
                            logger_->logOrder(*spoofOrder);
                    }
                }
            }

            if (!running_) break;

            // ── Step 5: place real (opposite) trade to exploit price reaction ─
            double freshLtp = InstrumentManager::getInstance().getLTP(instrumentId_);
            if (freshLtp <= 0.0) freshLtp = ltp;

            // Price slightly inside the spread to ensure the IOC order executes
            // against resting counterparties that reacted to the artificial signal.
            double realPrice = (realSide == OrderSide::SELL)
                ? std::round(freshLtp * 0.998 * 100.0) / 100.0  // SELL: take bids
                : std::round(freshLtp * 1.002 * 100.0) / 100.0; // BUY:  take asks

            size_t realQty = realQtyDist(engine_);
            auto realOrder = std::make_shared<Order>(
                OrderType::LIMIT, realSide,
                realPrice, realQty,
                TimeInForce::IOC,   // IOC: fills immediately, drop unfilled portion
                traderId_, instrumentId_);
            orderBook_->addOrder(realOrder);
            if (logger_) logger_->logOrder(*realOrder);  // → ORDER_NEW / ORDER_FILLED

            // ── Step 6: pause before the next spoof cycle ────────────────────
            std::this_thread::sleep_for(std::chrono::milliseconds(pauseDist(engine_)));
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  WASH TRADER  (trader #2500 only, when WASH_TRADER_ACTIVE == true)
    //
    //  Back-to-back BUY + SELL at the same price and quantity — fake volume
    //  with zero net position change.  ML red-flag signals:
    //    ✦ Same user_id on consecutive BUY and SELL
    //    ✦ Identical price+quantity on both legs
    //    ✦ Periodic burst pattern in time-series
    // ──────────────────────────────────────────────────────────────────────────
    void runWash() {
        while (running_) {
            for (int pair = 0; pair < WASH_BURST_PAIRS && running_; ++pair) {
                // Use true LTP (not stale marketPrice) as the wash price anchor
                double ltp       = InstrumentManager::getInstance().getLTP(instrumentId_);
                double washPrice = ltp * washPriceJitter_(engine_);
                washPrice = std::round(washPrice * 100.0) / 100.0;

                auto buyOrder = std::make_shared<Order>(
                    OrderType::LIMIT, OrderSide::BUY,
                    washPrice, WASH_QUANTITY,
                    TimeInForce::GTC, traderId_, instrumentId_);
                orderBook_->addOrder(buyOrder);
                if (logger_) logger_->logOrder(*buyOrder);

                std::this_thread::sleep_for(std::chrono::milliseconds(WASH_INTERVAL_MS));
                if (!running_) break;

                auto sellOrder = std::make_shared<Order>(
                    OrderType::LIMIT, OrderSide::SELL,
                    washPrice,      // same price — red flag ✦
                    WASH_QUANTITY,  // same qty   — red flag ✦
                    TimeInForce::GTC, traderId_, instrumentId_);
                orderBook_->addOrder(sellOrder);
                if (logger_) logger_->logOrder(*sellOrder);

                std::this_thread::sleep_for(std::chrono::milliseconds(WASH_INTERVAL_MS));
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(WASH_PAUSE_MS));
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  GTC ORDER TRACKING / CANCELLATION HELPERS
    //
    //  In real markets every trader type actively cancels orders:
    //    • Market makers  : cancel stale quotes before posting refreshed ones.
    //    • Momentum traders: cancel orders when the trend that prompted them
    //                        reverses.
    //    • Mean-reversion  : cancel orders that have drifted far from the
    //                        current rolling mean.
    //    • Noise traders   : cancel at random (changed plans, risk management).
    //
    //  Each archetype tracks its placed GTC LIMIT orders in pendingGTCOrders_
    //  (capped at 20 entries).  Two helpers implement the mechanics:
    //    trackGTCOrder()        — register a newly placed GTC order.
    //    maybeCancelGTCOrder()  — purge completed orders then, with the given
    //                             probability, cancel one random pending order
    //                             and log ORDER_CANCELLED to QuestDB.
    // ──────────────────────────────────────────────────────────────────────────

    // Register a newly placed GTC LIMIT order so it can be cancelled later.
    // IOC / MARKET orders are excluded — they self-dispose immediately.
    void trackGTCOrder(const std::shared_ptr<Order>& order) {
        if (!order || order->getTimeInForce() == TimeInForce::IOC) return;
        pendingGTCOrders_.push_back(order);
        // Hard cap: keep at most 20 candidates to bound memory.
        if (pendingGTCOrders_.size() > 20)
            pendingGTCOrders_.erase(pendingGTCOrders_.begin());
    }

    // Purge orders that are no longer cancellable (FILLED / CANCELLED / EXPIRED),
    // then cancel one randomly chosen pending GTC order with the given probability.
    // The cancelled order is immediately logged to QuestDB as ORDER_CANCELLED.
    void maybeCancelGTCOrder(double probability) {
        // Step 1 — remove orders that have already been resolved.
        pendingGTCOrders_.erase(
            std::remove_if(pendingGTCOrders_.begin(), pendingGTCOrders_.end(),
                [](const std::shared_ptr<Order>& o) {
                    if (!o) return true;
                    const auto s = o->getStatus();
                    return s == OrderStatus::FILLED   ||
                           s == OrderStatus::CANCELLED ||
                           s == OrderStatus::EXPIRED;
                }),
            pendingGTCOrders_.end());

        if (pendingGTCOrders_.empty()) return;

        // Step 2 — random gate: skip most iterations so the cancel rate stays
        //          proportional to the archetype's natural order-placement rate.
        std::uniform_real_distribution<double> gate(0.0, 1.0);
        if (gate(engine_) >= probability) return;

        // Step 3 — pick one pending order at random and cancel it.
        std::uniform_int_distribution<size_t> pick(0, pendingGTCOrders_.size() - 1);
        auto order = pendingGTCOrders_[pick(engine_)];
        if (!order) return;

        const auto s = order->getStatus();
        if (s == OrderStatus::NEW || s == OrderStatus::PARTIALLY_FILLED) {
            // cancelOrder() acquires the book mutex, removes the order from the
            // price level map, and calls order->cancel() which stamps the cancel
            // timestamp and sets status = CANCELLED.
            orderBook_->cancelOrder(order->getOrderId());
            // After the call the shared_ptr still points to the same Order object
            // whose status is now CANCELLED — log it to produce ORDER_CANCELLED
            // in QuestDB trade_logs.
            if (logger_ && order->getStatus() == OrderStatus::CANCELLED)
                logger_->logOrder(*order);
        }
    }

    // Dispatch to the correct primary behaviour for this trader.
    void run() {
        if (isWashTrader_)  { runWash();     return; }
        if (isSpoofTrader_) { runSpoofing(); return; }
        switch (archetype_) {
            case Archetype::MARKET_MAKER:   runMarketMaker();  break;
            case Archetype::MOMENTUM:       runMomentum();     break;
            case Archetype::MEAN_REVERSION: runMeanReversion(); break;
            default:                        runNoise();        break;
        }
    }

    // ── Members ───────────────────────────────────────────────────────────────
    std::shared_ptr<OrderBook> orderBook_;
    std::string                traderId_;
    bool                       isWashTrader_  = false;
    bool                       isSpoofTrader_ = false;  // true for trader IDs 1–15
    Archetype                  archetype_;
    std::atomic<bool>          running_;
    std::thread                thread_;

    std::mt19937                           engine_;
    std::uniform_real_distribution<double> washPriceJitter_; // ±0.1% for wash trades

    int instrumentId_;

    // Tracks placed GTC LIMIT orders eligible for future cancellation.
    // Single-threaded per MockTrader instance — no extra locking required.
    std::vector<std::shared_ptr<Order>> pendingGTCOrders_;
};

int MockTrader::mockTraderCount = 1;  // Start at 1: IDs 1–15 are spoofing manipulators

#endif // MOCK_TRADER_HPP