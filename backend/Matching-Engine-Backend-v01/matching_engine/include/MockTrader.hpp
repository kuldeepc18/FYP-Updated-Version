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
//  MANIPULATION — RAMPING  (trader ID 2500)
//  ─────────────────────────────────────────────────────────────────────────────
//  RAMPING_ACTIVE   master on/off switch.
//    true  → trader #2500 repeatedly places small BUY orders at gradually
//            increasing prices, pushing the price upward without sudden spikes.
//            Retail traders act as natural sellers on the opposite side.
//    false → trader #2500 reverts to a normal retail trader.
//
//  RAMPING_TRADER_USER_ID  the trader ID performing the ramp.
//
//  How ramping works:
//    Step 0 : 2500 BUY 1,000 @ marketPrice + 0.20
//    Step 1 : 2500 BUY 1,000 @ marketPrice + 0.40
//    Step 2 : 2500 BUY 1,000 @ marketPrice + 0.60
//    ... continues with RAMPING_PRICE_INCREMENT each step ...
//
//  ML-detectable red flags in QuestDB trade_logs:
//    * Single user_id (2500) on the BUY side of many consecutive trades
//    * Monotonically increasing trade prices over a short time window
//    * No SELL orders from user 2500 during ramp phase
//    * Consistent small quantity on every order (RAMPING_QUANTITY = 1,000)
//    * Periodic timing signature (order every RAMPING_INTERVAL_MS)
//    * Gradual price uptrend driven by a single participant
// ═══════════════════════════════════════════════════════════════════════════════
static constexpr bool   RAMPING_ACTIVE            = true;   // true = trader 2500 ramps
static constexpr int    RAMPING_TRADER_USER_ID    = 2500;
static constexpr size_t RAMPING_QUANTITY           = 1000;   // shares per buy order
static constexpr double RAMPING_PRICE_INCREMENT    = 0.20;   // price increase per step
static constexpr int    RAMPING_INTERVAL_MS        = 1500;   // ms between consecutive buy orders
static constexpr int    RAMPING_STEPS_PER_CYCLE    = 20;     // buy orders per cycle
static constexpr int    RAMPING_PAUSE_MS           = 3000;   // ms pause between cycles

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
                    // BUY step — anchor a fresh ring price from the live market
                    const Instrument* instr =
                        InstrumentManager::getInstance().getInstrumentById(instrId_);
                    double mkt = instr ? instr->marketPrice : 100.0;
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
    static int mockTraderCount;

    MockTrader(std::shared_ptr<OrderBook> orderBook, int instrumentId, Logger* logger = nullptr)
        : orderBook_(orderBook)
        , instrumentId_(instrumentId)
        , running_(false)
        , engine_(std::random_device{}())
        , priceDistribution_(0.95, 1.05)    // ±5 % of market price  (retail)
        , quantityDistribution_(1, 100)      // 1–100 shares           (retail)
        , sleepDistribution_(100, 2000)      // 100–2000 ms think time (retail)
        , sideDistribution_(0, 1)           // random BUY / SELL      (retail)
        , washPriceJitter_(0.999, 1.001)    // ±0.1 % price noise     (wash)
        , logger_(logger)
    {
        if (mockTraderCount >= 10000)
            throw std::runtime_error("Max 10 000 mock traders allowed");

        int myId  = mockTraderCount++;
        traderId_ = std::to_string(myId);

        // ── Designate trader #2500 as the wash-trade manipulator ─────────────
        // Flip WASH_TRADER_ACTIVE to false to revert #2500 to retail behaviour.
        isWashTrader_ = (WASH_TRADER_ACTIVE && myId == WASH_TRADER_USER_ID);

        // ── Designate trader #2500 as the ramping manipulator ────────────────
        // When RAMPING_ACTIVE == true, trader 2500 ONLY places BUY orders at
        // gradually increasing prices.  All other manipulation flags for 2500
        // must be false (no wash, no spoofing, no layering, etc.).
        isRampingTrader_ = (RAMPING_ACTIVE && myId == RAMPING_TRADER_USER_ID);

        // ── Note: traders 2500 / 2600 / 2700 / 2800 additionally participate
        // in the circular trading ring via CircularRingCoordinator (separate
        // threads).  Their MockTrader thread continues its primary behaviour
        // (wash for 2500, retail for 2600/2700/2800) on their assigned instrument
        // while the ring coordinator fires ring orders on instrument 1 (RELIANCE).
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
    //  RETAIL TRADER  (9996 normal mock traders plus 2600 / 2700 / 2800)
    //  Behaviour: random side, random order type, random price & quantity.
    //  Represents normal market participants with no coordinated intent.
    // ──────────────────────────────────────────────────────────────────────────
    void runRetail() {
        while (running_) {
            std::this_thread::sleep_for(
                std::chrono::milliseconds(sleepDistribution_(engine_)));

            auto      side      = sideDistribution_(engine_) == 0
                                      ? OrderSide::BUY : OrderSide::SELL;
            OrderType orderType = (quantityDistribution_(engine_) % 2 == 0)
                                      ? OrderType::LIMIT : OrderType::MARKET;

            const Instrument* instr =
                InstrumentManager::getInstance().getInstrumentById(instrumentId_);
            double basePrice = instr ? instr->marketPrice : 100.0;
            double price     = basePrice * priceDistribution_(engine_);
            auto   quantity  = quantityDistribution_(engine_);

            auto order = std::make_shared<Order>(
                orderType, side, price, quantity,
                TimeInForce::GTC, traderId_, instrumentId_);

            orderBook_->addOrder(order);
            if (logger_) logger_->logOrder(*order);
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  WASH TRADER  (trader #2500 only, when WASH_TRADER_ACTIVE == true)
    //
    //  What wash trading looks like in QuestDB trade_logs:
    //
    //    user_id │ side │  price  │   qty  │ status
    //    ────────┼──────┼─────────┼────────┼───────
    //      2500  │ BUY  │ 150.12  │ 10 000 │ NEW     ← Leg 1
    //      2500  │ SELL │ 150.12  │ 10 000 │ NEW     ← Leg 2 (identical price & qty)
    //      2500  │ BUY  │ 150.13  │ 10 000 │ NEW     ← next pair
    //      2500  │ SELL │ 150.13  │ 10 000 │ NEW
    //      … × WASH_BURST_PAIRS pairs, then pause …
    //
    //  ML red-flag signals baked into every burst:
    //    ✦ Same user_id (2500) on back-to-back BUY and SELL
    //    ✦ Identical price on both legs of each pair
    //    ✦ Identical large quantity on both legs (WASH_QUANTITY = 10 000)
    //    ✦ No net position change across any burst
    //    ✦ High self-trade ratio vs. total orders placed
    //    ✦ Periodic burst pattern in time-series (burst → pause → burst)
    // ──────────────────────────────────────────────────────────────────────────
    void runWash() {
        while (running_) {

            for (int pair = 0; pair < WASH_BURST_PAIRS && running_; ++pair) {

                const Instrument* instr =
                    InstrumentManager::getInstance().getInstrumentById(instrumentId_);
                double marketPrice = instr ? instr->marketPrice : 100.0;

                // Tiny jitter keeps the price from looking artificially static,
                // but BOTH legs of each pair share the EXACT same washPrice.
                double washPrice = marketPrice * washPriceJitter_(engine_);
                washPrice = std::round(washPrice * 100.0) / 100.0; // 2 d.p.

                // ── Leg 1 : BUY ──────────────────────────────────────────────
                auto buyOrder = std::make_shared<Order>(
                    OrderType::LIMIT, OrderSide::BUY,
                    washPrice, WASH_QUANTITY,
                    TimeInForce::GTC, traderId_, instrumentId_);
                orderBook_->addOrder(buyOrder);
                if (logger_) logger_->logOrder(*buyOrder);

                std::this_thread::sleep_for(
                    std::chrono::milliseconds(WASH_INTERVAL_MS));
                if (!running_) break;

                // ── Leg 2 : SELL — mirrors Leg 1 exactly ─────────────────────
                auto sellOrder = std::make_shared<Order>(
                    OrderType::LIMIT, OrderSide::SELL,
                    washPrice,      // ← same price as BUY  (red flag ✦)
                    WASH_QUANTITY,  // ← same qty  as BUY   (red flag ✦)
                    TimeInForce::GTC, traderId_, instrumentId_);
                orderBook_->addOrder(sellOrder);
                if (logger_) logger_->logOrder(*sellOrder);

                std::this_thread::sleep_for(
                    std::chrono::milliseconds(WASH_INTERVAL_MS));
            }

            std::this_thread::sleep_for(
                std::chrono::milliseconds(WASH_PAUSE_MS));
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  RAMPING TRADER  (trader #2500 only, when RAMPING_ACTIVE == true)
    //
    //  What ramping looks like in QuestDB trade_logs:
    //
    //    buyer_user_id | seller_user_id |  price   |  qty
    //    --------------+----------------+----------+------
    //      2500        |  4511          |  100.00  | 1000
    //      2500        |  4722          |  100.20  | 1000
    //      2500        |  4981          |  100.40  | 1000
    //      2500        |  5102          |  100.60  | 1000
    //      2500        |  6230          |  100.80  | 1000
    //      ...  gradually increasing price, always BUY side  ...
    //
    //  Restrictions enforced:
    //    - Trader 2500 ONLY places BUY orders during ramp phase
    //    - Trader 2500 does NOT sell during ramp
    //    - Trades only with retail traders (self-trade prevention in OrderBook)
    // ──────────────────────────────────────────────────────────────────────────
    void runRamping() {
        const Instrument* instr =
            InstrumentManager::getInstance().getInstrumentById(instrumentId_);
        double rampPrice = instr ? instr->marketPrice : 100.0;

        while (running_) {
            for (int step = 0; step < RAMPING_STEPS_PER_CYCLE && running_; ++step) {
                // Each BUY order slightly increases the price
                rampPrice += RAMPING_PRICE_INCREMENT;
                rampPrice = std::round(rampPrice * 100.0) / 100.0; // 2 d.p.

                // Place aggressive BUY order at ramping price
                auto order = std::make_shared<Order>(
                    OrderType::LIMIT, OrderSide::BUY,
                    rampPrice, RAMPING_QUANTITY,
                    TimeInForce::GTC, traderId_, instrumentId_);
                orderBook_->addOrder(order);
                if (logger_) logger_->logOrder(*order);

                std::this_thread::sleep_for(
                    std::chrono::milliseconds(RAMPING_INTERVAL_MS));
            }

            // Pause between ramping cycles
            std::this_thread::sleep_for(
                std::chrono::milliseconds(RAMPING_PAUSE_MS));
        }
    }

    // Dispatch to the correct primary behaviour for this trader.
    void run() {
        if (isRampingTrader_)
            runRamping();
        else if (isWashTrader_)
            runWash();
        else
            runRetail();
    }

    // ── Members ───────────────────────────────────────────────────────────────
    std::shared_ptr<OrderBook> orderBook_;
    std::string                traderId_;
    bool                       isWashTrader_   = false;
    bool                       isRampingTrader_ = false;
    std::atomic<bool>          running_;
    std::thread                thread_;

    std::mt19937                           engine_;
    std::uniform_real_distribution<double> priceDistribution_;
    std::uniform_int_distribution<size_t>  quantityDistribution_;
    std::uniform_int_distribution<size_t>  sleepDistribution_;
    std::uniform_int_distribution<int>     sideDistribution_;
    std::uniform_real_distribution<double> washPriceJitter_;

    int instrumentId_;
};

int MockTrader::mockTraderCount = 0;

#endif // MOCK_TRADER_HPP