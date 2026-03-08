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
static constexpr bool   WASH_TRADER_ACTIVE   = false;  // ← false → ring members only perform circular trading
static constexpr int    WASH_TRADER_USER_ID  = 2500;

// ── Wash-trade burst parameters ───────────────────────────────────────────────
//  WASH_QUANTITY     shares placed on each BUY leg AND each SELL leg.
//  WASH_INTERVAL_MS  ms between the BUY leg and its mirrored SELL leg.
//  WASH_BURST_PAIRS  BUY+SELL pairs per burst (creates the repetitive pattern).
//  WASH_PAUSE_MS     idle gap between bursts (creates a periodic time signature).
// ─────────────────────────────────────────────────────────────────────────────
static constexpr size_t WASH_QUANTITY      = 10000; // shares per leg  (matches spec: 10 000 @ price)
static constexpr int    WASH_INTERVAL_MS   = 50;    // ms between BUY leg and SELL leg (very short interval)
static constexpr int    WASH_BURST_PAIRS   = 5;     // back-to-back BUY+SELL pairs per burst
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
//    Step 0 : user 2600  BUY  CIRCULAR_QUANTITY @ ringPrice  → sits in book
//    Step 1 : user 2500  SELL CIRCULAR_QUANTITY @ ringPrice  → matches 2600 BUY  ★  (2500 → 2600)
//    Step 2 : user 2700  BUY  CIRCULAR_QUANTITY @ ringPrice  → sits in book
//    Step 3 : user 2600  SELL CIRCULAR_QUANTITY @ ringPrice  → matches 2700 BUY  ★  (2600 → 2700)
//    Step 4 : user 2800  BUY  CIRCULAR_QUANTITY @ ringPrice  → sits in book
//    Step 5 : user 2700  SELL CIRCULAR_QUANTITY @ ringPrice  → matches 2800 BUY  ★  (2700 → 2800)
//    Step 6 : user 2500  BUY  CIRCULAR_QUANTITY @ ringPrice  → sits in book
//    Step 7 : user 2800  SELL CIRCULAR_QUANTITY @ ringPrice  → matches 2500 BUY  ★  (2800 → 2500)
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
static constexpr bool   CIRCULAR_TRADING_ACTIVE = false;  // ← false → ring coordinator disabled; pump-and-dump is now active
static constexpr size_t CIRCULAR_QUANTITY        = 5000;   // shares per ring order
static constexpr int    CIRCULAR_STEP_MS         = 500;    // ms between ring steps
static constexpr int    CIRCULAR_PAUSE_MS        = 3000;   // ms pause between full rotations
static constexpr double CIRCULAR_PRICE_JITTER    = 0.002;  // ±0.2 % random noise per BUY step
static constexpr double CIRCULAR_PRICE_DRIFT     = 0.001;  // +0.1 % upward drift per BUY step → gradual price increase

// Ring member IDs — defines the directed cycle 2500 → 2600 → 2700 → 2800 → 2500
static const int CIRCULAR_RING_IDS[4] = {2500, 2600, 2700, 2800};

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
                    // BUY step — compound upward from the previous ring price to
                    // produce a gradual price increase each rotation.  On the very
                    // first BUY of the session, anchor from the live market price.
                    double base;
                    if (ringPrice_ > 0.0) {
                        base = ringPrice_ * (1.0 + CIRCULAR_PRICE_DRIFT);
                    } else {
                        const Instrument* instr =
                            InstrumentManager::getInstance().getInstrumentById(instrId_);
                        base = instr ? instr->marketPrice : 100.0;
                    }
                    price      = std::round(base * jitter(eng) * 100.0) / 100.0;
                    ringPrice_ = price; // stored so the matching SELL step reuses it
                } else {
                    // SELL step — inherit the price anchored by the preceding BUY step
                    // so both legs of each pair cross at exactly the same price.
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
    {1, OrderSide::BUY,  true },  // step 0 : 2600 BUY  — anchors ringPrice; rests in book
    {0, OrderSide::SELL, false},  // step 1 : 2500 SELL — matches 2600's BUY  ★  (2500 → 2600)
    {2, OrderSide::BUY,  true },  // step 2 : 2700 BUY  — anchors new ringPrice; rests in book
    {1, OrderSide::SELL, false},  // step 3 : 2600 SELL — matches 2700's BUY  ★  (2600 → 2700)
    {3, OrderSide::BUY,  true },  // step 4 : 2800 BUY  — anchors new ringPrice; rests in book
    {2, OrderSide::SELL, false},  // step 5 : 2700 SELL — matches 2800's BUY  ★  (2700 → 2800)
    {0, OrderSide::BUY,  true },  // step 6 : 2500 BUY  — anchors new ringPrice; rests in book
    {3, OrderSide::SELL, false},  // step 7 : 2800 SELL — matches 2500's BUY  ★  (2800 → 2500)
};


// ═══════════════════════════════════════════════════════════════════════════════
//  MANIPULATION #3 — PUMP AND DUMP  (traders 2500, 2600, 2700, 2800)
//  ─────────────────────────────────────────────────────────────────────────────
//  PUMP_DUMP_ACTIVE  master on/off switch.
//    true  → PumpDumpCoordinator runs a perpetual 3-phase cycle on instrument 1:
//             Phase 1 ACCUMULATION — manipulators gradually accumulate large
//               share holdings via BUY orders filled by retail SELL counterparts.
//             Phase 2 PUMP — aggressive, escalating BUY orders drive the price
//               upward; retail momentum traders begin entering the market long.
//             Phase 3 DUMP — manipulators rapidly flood the book with large SELL
//               orders, collapsing the price and leaving retail traders trapped.
//    false → manipulators 2500/2600/2700/2800 behave as normal retail traders.
//
//  Key invariants enforced by design:
//    ✦ Manipulators ONLY place BUY orders during Phases 1 & 2.
//    ✦ Manipulators ONLY place SELL orders during Phase 3.
//    ✦ Orders always cross with retail counterparties — never with each other —
//      because only one side (BUY or SELL) is active per phase.
//    ✦ Aggressive pricing (BUY above ask / SELL below bid) guarantees fills
//      against existing retail orders rather than resting unmatched.
//
//  ML-detectable red flags in QuestDB trade_logs:
//    ✦ Sudden large-volume BUY activity from 4 IDs driving a rapid price rise
//    ✦ Quantities 35,000–60,000 dwarf normal retail size (1–100 shares)
//    ✦ Price escalation pattern (@100 → @102 → @104 → @107) in a short window
//    ✦ Retail momentum surge follows manipulator buys (buy-side volume spike)
//    ✦ Precipitous price collapse immediately following the price peak
//    ✦ All 4 IDs switch simultaneously from BUY to SELL at the inflection point
//    ✦ Net position of each manipulator ≈ 0 after a complete P&D cycle
// ═══════════════════════════════════════════════════════════════════════════════
static constexpr bool   PUMP_DUMP_ACTIVE  = true;  // ← true → pump-and-dump cycle is live

// ── Accumulation phase parameters ─────────────────────────────────────────────
// Manipulators gradually build up large long positions before the pump begins.
static constexpr int    PD_ACCUM_ROUNDS      = 8;      // BUY orders per manipulator per cycle
static constexpr size_t PD_ACCUM_QTY_MIN     = 3000;   // min shares per accumulation BUY
static constexpr size_t PD_ACCUM_QTY_MAX     = 8000;   // max shares per accumulation BUY
static constexpr int    PD_ACCUM_STEP_MS     = 1500;   // ms between successive accumulation orders
static constexpr double PD_ACCUM_PRICE_ABOVE = 1.005;  // 0.5 % above market → guaranteed fill vs retail SELL

// ── Pump phase parameters ─────────────────────────────────────────────────────
// Per-manipulator BUY quantities match the specification exactly:
//   2500 → 50 000 shares   2600 → 40 000 shares
//   2700 → 35 000 shares   2800 → 60 000 shares
static constexpr size_t PD_PUMP_QTY[4]    = {50000, 40000, 35000, 60000};
static constexpr double PD_PUMP_PRICE_STEP = 0.02;  // +2 % price escalation per pump round
static constexpr int    PD_PUMP_ROUNDS     = 6;     // rounds of escalating aggressive BUYs
static constexpr int    PD_PUMP_STEP_MS    = 800;   // ms between successive pump orders

// ── Dump phase parameters ──────────────────────────────────────────────────────
// All 4 manipulators rapidly flood the book with large SELL orders,
// priced 3 % below market to guarantee immediate fills vs retail BUY orders.
static constexpr size_t PD_DUMP_QTY_MIN    = 10000; // min shares per dump SELL order
static constexpr size_t PD_DUMP_QTY_MAX    = 20000; // max shares per dump SELL order
static constexpr double PD_DUMP_PRICE_BELOW = 0.97; // 3 % below market → guaranteed fill vs retail BUY
static constexpr int    PD_DUMP_STEP_MS    = 300;   // ms between dump orders (rapid to cascade price)
static constexpr int    PD_DUMP_ROUNDS     = 12;    // rounds of rapid selling per cycle

// ── Inter-phase timing ────────────────────────────────────────────────────────
static constexpr int    PD_PHASE_PAUSE_MS  = 5000;  // pause between consecutive phases
static constexpr int    PD_CYCLE_PAUSE_MS  = 15000; // cooldown between full P&D cycles

// Manipulator trader IDs — identical to the ring IDs so training data is consistent
static const int PUMP_DUMP_IDS[4] = {2500, 2600, 2700, 2800};

// ─────────────────────────────────────────────────────────────────────────────
//  PumpDumpCoordinator
//  ─────────────────────────────────────────────────────────────────────────────
//  Singleton that runs a single coordinator thread executing the perpetual
//  3-phase pump-and-dump cycle on the designated order book.
//
//  TradingApplication::start() calls:
//    PumpDumpCoordinator::instance().init(orderBooks_[1], &logger_, 1);
//    PumpDumpCoordinator::instance().start();
//  TradingApplication cleanup calls:
//    PumpDumpCoordinator::instance().stop();
// ─────────────────────────────────────────────────────────────────────────────
class PumpDumpCoordinator {
public:
    static PumpDumpCoordinator& instance() {
        static PumpDumpCoordinator inst;
        return inst;
    }

    // Must be called BEFORE start(). Supplies the shared order book and logger.
    void init(std::shared_ptr<OrderBook> ob, Logger* log, int instrId) {
        std::lock_guard<std::mutex> lk(mtx_);
        orderBook_ = ob;
        logger_    = log;
        instrId_   = instrId;
    }

    void start() {
        if (!PUMP_DUMP_ACTIVE) return;
        {
            std::lock_guard<std::mutex> lk(mtx_);
            if (!orderBook_) return; // init() was not called
            running_ = true;
        }
        threads_.emplace_back(&PumpDumpCoordinator::coordinatorLoop, this);
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
    // ── Place one LIMIT order on behalf of a manipulator ─────────────────────
    // Price is rounded to 2 decimal places to match exchange conventions.
    void placeOrder(int manipId, OrderSide side, double price, size_t qty) {
        auto order = std::make_shared<Order>(
            OrderType::LIMIT,
            side,
            std::round(price * 100.0) / 100.0,
            qty,
            TimeInForce::GTC,
            std::to_string(manipId),
            instrId_);
        orderBook_->addOrder(order);
        if (logger_) logger_->logOrder(*order);
    }

    // Sleep for `ms` milliseconds on the coordinator thread.
    // Returns false immediately if stop() was called during the sleep.
    bool sleepMs(int ms) {
        std::unique_lock<std::mutex> lk(mtx_);
        return !cv_.wait_for(lk, std::chrono::milliseconds(ms),
                             [this] { return !running_; });
    }

    // ── Phase 1: Accumulation ─────────────────────────────────────────────────
    // Each manipulator places PD_ACCUM_ROUNDS BUY orders priced 0.5 % above
    // the current market price. This premium above the ask guarantees each order
    // is filled immediately against resting retail SELL orders. No manipulator
    // places a SELL order here → every fill is manipulator-BUY vs retail-SELL.
    void runAccumulation() {
        std::mt19937 eng(std::random_device{}());
        std::uniform_int_distribution<size_t> qtyDist(PD_ACCUM_QTY_MIN, PD_ACCUM_QTY_MAX);
        for (int round = 0; round < PD_ACCUM_ROUNDS && running_; ++round) {
            for (int i = 0; i < 4 && running_; ++i) {
                const Instrument* instr =
                    InstrumentManager::getInstance().getInstrumentById(instrId_);
                double marketPrice = instr ? instr->marketPrice : 100.0;
                double price = marketPrice * PD_ACCUM_PRICE_ABOVE;
                size_t qty   = qtyDist(eng);
                placeOrder(PUMP_DUMP_IDS[i], OrderSide::BUY, price, qty);
                if (!sleepMs(PD_ACCUM_STEP_MS)) return;
            }
        }
    }

    // ── Phase 2: Pump ─────────────────────────────────────────────────────────
    // Manipulators place aggressive BUY orders at escalating price multiples,
    // forcibly driving the market price upward. Quantities follow the spec:
    //   2500 BUY 50,000 @ market × (1 + step×2%)
    //   2600 BUY 40,000 @ market × (1 + step×2%)
    //   2700 BUY 35,000 @ market × (1 + step×2%)
    //   2800 BUY 60,000 @ market × (1 + step×2%)
    // No manipulator is on the SELL side → every fill is manipulator-BUY vs
    // retail-SELL (retail sellers are swept as manipulators aggressively bid up).
    // Retail traders observe momentum and begin entering long at 110 +.
    void runPump() {
        for (int round = 0; round < PD_PUMP_ROUNDS && running_; ++round) {
            double priceMultiplier = 1.0 + PD_PUMP_PRICE_STEP * (round + 1);
            for (int i = 0; i < 4 && running_; ++i) {
                const Instrument* instr =
                    InstrumentManager::getInstance().getInstrumentById(instrId_);
                double marketPrice = instr ? instr->marketPrice : 100.0;
                double price = marketPrice * priceMultiplier;
                placeOrder(PUMP_DUMP_IDS[i], OrderSide::BUY, price, PD_PUMP_QTY[i]);
                if (!sleepMs(PD_PUMP_STEP_MS)) return;
            }
        }
    }

    // ── Phase 3: Dump ─────────────────────────────────────────────────────────
    // All 4 manipulators rapidly flood the order book with large SELL orders
    // priced 3 % below the current market price, guaranteeing immediate fills
    // against resting retail BUY orders. No manipulator is on the BUY side →
    // every dump fill is manipulator-SELL vs retail-BUY. The sudden avalanche
    // of sell volume causes the market price to collapse sharply, trapping
    // retail traders who entered long during the pump phase.
    void runDump() {
        std::mt19937 eng(std::random_device{}());
        std::uniform_int_distribution<size_t> qtyDist(PD_DUMP_QTY_MIN, PD_DUMP_QTY_MAX);
        for (int round = 0; round < PD_DUMP_ROUNDS && running_; ++round) {
            for (int i = 0; i < 4 && running_; ++i) {
                const Instrument* instr =
                    InstrumentManager::getInstance().getInstrumentById(instrId_);
                double marketPrice = instr ? instr->marketPrice : 100.0;
                double price = marketPrice * PD_DUMP_PRICE_BELOW;
                size_t qty   = qtyDist(eng);
                placeOrder(PUMP_DUMP_IDS[i], OrderSide::SELL, price, qty);
                if (!sleepMs(PD_DUMP_STEP_MS)) return;
            }
        }
    }

    // ── Main coordinator thread ───────────────────────────────────────────────
    // Perpetual 3-phase cycle:
    //   Accumulation → pause → Pump → pause → Dump → cooldown → repeat
    void coordinatorLoop() {
        while (running_) {
            // Phase 1 — Accumulation: build up large long positions quietly
            runAccumulation();
            if (!running_ || !sleepMs(PD_PHASE_PAUSE_MS)) break;

            // Phase 2 — Pump: aggressive buying drives price up; retail enters long
            runPump();
            if (!running_ || !sleepMs(PD_PHASE_PAUSE_MS)) break;

            // Phase 3 — Dump: rapid selling collapses the price; retail is trapped
            runDump();
            if (!running_) break;

            // Cooldown before the next full pump-and-dump cycle
            if (!sleepMs(PD_CYCLE_PAUSE_MS)) break;
        }
    }

    PumpDumpCoordinator()  = default;
    ~PumpDumpCoordinator() { stop(); }
    PumpDumpCoordinator(const PumpDumpCoordinator&) = delete;
    PumpDumpCoordinator& operator=(const PumpDumpCoordinator&) = delete;

    std::shared_ptr<OrderBook> orderBook_;
    Logger*                    logger_  = nullptr;
    int                        instrId_ = 1;
    bool                       running_ = false;
    std::mutex                 mtx_;
    std::condition_variable    cv_;
    std::vector<std::thread>   threads_;
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
        // (WASH_TRADER_ACTIVE = false while circular trading is active, so this
        // flag stays false and no wash orders are emitted.)
        isWashTrader_ = (WASH_TRADER_ACTIVE && myId == WASH_TRADER_USER_ID);

        // ── Ring members 2500/2600/2700/2800 exclusively perform circular trading.
        // CircularRingCoordinator drives ALL their orders via dedicated threads on
        // instrument 1 (RELIANCE).  This MockTrader thread stays idle so no retail
        // orders are mixed into the ring signal logged to QuestDB.
        isRingMember_ = (CIRCULAR_TRADING_ACTIVE &&
                         (myId == 2500 || myId == 2600 || myId == 2700 || myId == 2800));

        // ── Pump-and-dump manipulators 2500/2600/2700/2800 exclusively perform
        // pump-and-dump via the PumpDumpCoordinator singleton.  This MockTrader
        // thread stays idle so no retail orders are mixed into the P&D signal.
        isPumpDumpManipulator_ = (PUMP_DUMP_ACTIVE &&
                                  (myId == 2500 || myId == 2600 || myId == 2700 || myId == 2800));
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

    // ── Ring member / pump-dump manipulator idle loop ─────────────────────────
    // Traders 2500/2600/2700/2800 have all orders placed by their coordinator
    // (CircularRingCoordinator or PumpDumpCoordinator).  This thread must stay
    // alive so stop() can join it, but must NOT place any orders itself.
    void runIdle() {
        while (running_)
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }

    // Dispatch to the correct primary behaviour for this trader.
    void run() {
        if (isWashTrader_)
            runWash();
        else if (isRingMember_ || isPumpDumpManipulator_)
            runIdle();
        else
            runRetail();
    }

    // ── Members ───────────────────────────────────────────────────────────────
    std::shared_ptr<OrderBook> orderBook_;
    std::string                traderId_;
    bool                       isWashTrader_         = false;
    bool                       isRingMember_         = false;
    bool                       isPumpDumpManipulator_ = false;
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