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

// ═══════════════════════════════════════════════════════════════════════════════
//  MANIPULATION #3 — PUMP AND DUMP  (traders 2500, 2600, 2700, 2800)
//  ─────────────────────────────────────────────────────────────────────────────
//  PUMP_AND_DUMP_ACTIVE   master on/off switch.
//    true  → PumpAndDumpCoordinator drives a 3-phase scheme on instrument 1
//            (RELIANCE INDUSTRIES):
//
//              Phase 1 — ACCUMULATION (90 s)
//                Manipulators 2500/2600/2700/2800 gradually accumulate large
//                positions by placing large BUY LIMIT orders at a mild premium
//                above the current ask.  Specific retail IDs (4301, 5200, …)
//                place complementary SELL orders to provide natural supply.
//                Price rises slowly.
//
//              Phase 2 — PUMP (60 s)
//                Manipulators switch to aggressive BUY orders (2.5–4 % above
//                market) at higher quantities, rapidly pushing the price up.
//                Retail FOMO buyers (same ID pool) see the rising price and
//                join the rally with BUY orders, amplifying the move.
//
//              Phase 3 — DUMP (60 s)
//                Manipulators unload all holdings by placing large SELL LIMIT
//                orders just below the current bid.  Retail participants (still
//                expecting further gains) absorb the dump with BUY orders.
//                Price collapses immediately after the sell-off.
//
//    false → coordinator never starts; all four IDs behave as normal retail.
//
//  IMPORTANT DESIGN CONSTRAINTS (enforced automatically by phase logic):
//    • Accumulation + Pump: manipulators BUY only  → same-side, no inter-manip match
//    • Dump:                manipulators SELL only  → same-side, no inter-manip match
//    • Manipulators NEVER trade with each other in any phase.
//    • All other retail MockTrader threads (IDs 0–299) continue trading normally.
//
//  ML-detectable signals in QuestDB trade_logs:
//    ✦ ACCUMULATION: buyer_user_id ∈ {2500,2600,2700,2800}; seller = retail
//    ✦ PUMP: same buyer IDs + retail FOMO buyers; price climbs visibly
//    ✦ DUMP: seller_user_id ∈ {2500,2600,2700,2800}; buyer = retail; price crashes
//    ✦ Volume concentration in 4 IDs over accumulation/pump, then sudden exit
//    ✦ Sharp price spike followed by immediate collapse — classic P&D signature
// ═══════════════════════════════════════════════════════════════════════════════
static constexpr bool PUMP_AND_DUMP_ACTIVE = true;

// ── Phase timing (milliseconds) ───────────────────────────────────────────────
static constexpr int PD_WARMUP_MS          = 15000; // 15 s market warm-up before scheme starts
static constexpr int PD_ACCUM_DURATION_MS  = 90000; // 90 s accumulation phase
static constexpr int PD_PUMP_DURATION_MS   = 60000; // 60 s aggressive pump phase
static constexpr int PD_DUMP_DURATION_MS   = 60000; // 60 s mass dump phase

// ── Order placement intervals ─────────────────────────────────────────────────
static constexpr int PD_ACCUM_INTERVAL_MS      = 7000; // gap between accumulation bursts
static constexpr int PD_PUMP_INTERVAL_MS       = 2500; // gap between pump bursts
static constexpr int PD_DUMP_INTERVAL_MS       = 1500; // gap between dump orders
static constexpr int PD_MANIP_STAGGER_MS       = 1200; // stagger between each manipulator in a burst
static constexpr int PD_RETAIL_FOMO_INTERVAL_MS= 4500; // retail FOMO order frequency

// ── Order quantities (shares per manipulator per order) ───────────────────────
static constexpr size_t PD_ACCUM_QTY_MIN  = 30000;
static constexpr size_t PD_ACCUM_QTY_MAX  = 60000;
static constexpr size_t PD_PUMP_QTY_MIN   = 50000;
static constexpr size_t PD_PUMP_QTY_MAX   = 80000;
static constexpr size_t PD_DUMP_QTY_MIN   = 90000;
static constexpr size_t PD_DUMP_QTY_MAX   = 130000;

// ── Retail participant quantities (shares per order) ──────────────────────────
static constexpr size_t PD_RETAIL_QTY_MIN = 3000;
static constexpr size_t PD_RETAIL_QTY_MAX = 8000;

// ── Price aggressiveness multipliers ─────────────────────────────────────────
//  BUY premium:  place above best ask so the order matches immediately and
//                consumes the ask side, pushing price upward.
//  SELL discount: place below best bid so the order matches immediately against
//                retail BUY resting orders during the dump.
static constexpr double PD_ACCUM_PRICE_PREMIUM = 1.008; // 0.8 % above market
static constexpr double PD_PUMP_PRICE_PREMIUM  = 1.025; // 2.5 % above market
static constexpr double PD_DUMP_PRICE_DISCOUNT = 0.997; // 0.3 % below market

// ── Manipulator IDs ───────────────────────────────────────────────────────────
//  All four buy in phases 1–2 and sell in phase 3 → never opposite sides
//  in the same phase → can never match each other. ✓
static const int PD_MANIP_IDS[4] = {2500, 2600, 2700, 2800};

// ── Retail participant IDs visible in trade_logs ──────────────────────────────
//  ACCUMULATION: these IDs place SELL orders (providing supply to manipulators).
//  PUMP / DUMP:  these IDs place BUY orders  (FOMO / catching-the-falling-knife).
static const int PD_RETAIL_FOMO_IDS[] = {
    4301, 5200, 6102, 4802, 5100,
    5401, 5500, 5600, 5700, 4701,
    5900, 4201, 6003, 7102, 8045
};
static constexpr int PD_RETAIL_FOMO_COUNT = 15;

// ─────────────────────────────────────────────────────────────────────────────
//  PumpAndDumpCoordinator
//  ─────────────────────────────────────────────────────────────────────────────
//  Singleton coordinator that manages two threads:
//    coordThread_  — drives the 3-phase manipulation sequence for the 4 manip IDs.
//    retailThread_ — simulates retail participants reacting to each phase:
//                    • ACCUMULATION: retail SELLS into the manipulator BUYs.
//                    • PUMP / DUMP:  retail BUYS (FOMO / knife-catching).
//
//  TradingApplication::start() must call:
//    PumpAndDumpCoordinator::instance().init(orderBooks_[1], &logger_, 1);
//    PumpAndDumpCoordinator::instance().start();
//  TradingApplication cleanup must call:
//    PumpAndDumpCoordinator::instance().stop();
// ─────────────────────────────────────────────────────────────────────────────
class PumpAndDumpCoordinator {
public:
    enum class Phase { WARMUP, ACCUMULATION, PUMP, DUMP, DONE };

    static PumpAndDumpCoordinator& instance() {
        static PumpAndDumpCoordinator inst;
        return inst;
    }

    // Must be called BEFORE start().  Supplies the shared order book and logger.
    void init(std::shared_ptr<OrderBook> ob, Logger* log, int instrId) {
        std::lock_guard<std::mutex> lk(mtx_);
        orderBook_ = ob;
        logger_    = log;
        instrId_   = instrId;
    }

    void start() {
        if (!PUMP_AND_DUMP_ACTIVE) return;
        {
            std::lock_guard<std::mutex> lk(mtx_);
            if (!orderBook_) return; // init() was not called
            running_ = true;
            phase_   = Phase::WARMUP;
        }
        coordThread_  = std::thread(&PumpAndDumpCoordinator::coordinatorLoop, this);
        retailThread_ = std::thread(&PumpAndDumpCoordinator::retailFOMOLoop,  this);
    }

    void stop() {
        {
            std::lock_guard<std::mutex> lk(mtx_);
            running_ = false;
        }
        cv_.notify_all();
        if (coordThread_.joinable())  coordThread_.join();
        if (retailThread_.joinable()) retailThread_.join();
    }

private:
    // ── Read current market price (weak consistency — same pattern as rest of engine) ──
    double marketPrice() const {
        const Instrument* instr =
            InstrumentManager::getInstance().getInstrumentById(instrId_);
        return instr ? instr->marketPrice : 100.0;
    }

    // ── Interruptible sleep — returns true if still running, false on shutdown ──
    bool sleepMs(int ms) {
        std::unique_lock<std::mutex> lk(mtx_);
        // wait_for returns true when predicate fires (shutdown), false on timeout
        bool shutdown = cv_.wait_for(lk,
                                     std::chrono::milliseconds(ms),
                                     [&] { return !running_; });
        return !shutdown; // true = still running, false = shutting down
    }

    // ── Place a LIMIT order on behalf of any participant ──────────────────────
    void placeOrder(const std::string& userId,
                    OrderSide          side,
                    double             price,
                    size_t             qty) {
        if (!orderBook_ || price <= 0.0 || qty == 0) return;
        price = std::round(price * 100.0) / 100.0; // 2 decimal places
        auto order = std::make_shared<Order>(
            OrderType::LIMIT, side, price, qty,
            TimeInForce::GTC, userId, instrId_);
        orderBook_->addOrder(order);
        if (logger_) logger_->logOrder(*order);
    }

    // ── Transition to a new phase and wake the retail thread ─────────────────
    void setPhase(Phase p) {
        {
            std::lock_guard<std::mutex> lk(mtx_);
            phase_ = p;
        }
        cv_.notify_all(); // wake retailFOMOLoop and any sleeping sleepMs
    }

    // ── Coordinator thread: drives the 3-phase pump-and-dump cycle ───────────
    void coordinatorLoop() {
        std::mt19937 eng(std::random_device{}());
        std::uniform_int_distribution<size_t> accumQty(PD_ACCUM_QTY_MIN, PD_ACCUM_QTY_MAX);
        std::uniform_int_distribution<size_t> pumpQty (PD_PUMP_QTY_MIN,  PD_PUMP_QTY_MAX);
        std::uniform_int_distribution<size_t> dumpQty (PD_DUMP_QTY_MIN,  PD_DUMP_QTY_MAX);

        // ── Warm-up: let retail order flow establish a natural bid/ask spread ─
        if (!sleepMs(PD_WARMUP_MS)) return;

        // ══════════════════════════════════════════════════════════════════════
        //  PHASE 1 — ACCUMULATION
        //  Manipulators BUY gradually at a mild premium.
        //  Retail FOMO sellers (from retailFOMOLoop) provide natural supply.
        //  Price rises slowly as the ask side of the book is consumed.
        // ══════════════════════════════════════════════════════════════════════
        setPhase(Phase::ACCUMULATION);
        auto phaseEnd = std::chrono::steady_clock::now()
                        + std::chrono::milliseconds(PD_ACCUM_DURATION_MS);

        while (running_) {
            if (std::chrono::steady_clock::now() >= phaseEnd) break;
            double mkt = marketPrice();

            // Each manipulator places one BUY at a slightly escalating premium
            // so that together they sweep the available sell-side of the book.
            for (int i = 0; i < 4 && running_; ++i) {
                // 0.8%, 1.0%, 1.2%, 1.4% above market for IDs 2500→2800
                double premium = PD_ACCUM_PRICE_PREMIUM + i * 0.002;
                double price   = mkt * premium;
                placeOrder(std::to_string(PD_MANIP_IDS[i]),
                           OrderSide::BUY, price, accumQty(eng));
                if (!sleepMs(PD_MANIP_STAGGER_MS)) return; // stagger within burst
            }
            if (!sleepMs(PD_ACCUM_INTERVAL_MS)) return; // gap between bursts
        }
        if (!running_) return;

        // ══════════════════════════════════════════════════════════════════════
        //  PHASE 2 — PUMP
        //  Manipulators buy aggressively at a large premium (2.5–4 %).
        //  Retail FOMO buyers now join the rally (via retailFOMOLoop).
        //  Price climbs sharply to a speculative peak.
        // ══════════════════════════════════════════════════════════════════════
        setPhase(Phase::PUMP);
        phaseEnd = std::chrono::steady_clock::now()
                   + std::chrono::milliseconds(PD_PUMP_DURATION_MS);

        while (running_) {
            if (std::chrono::steady_clock::now() >= phaseEnd) break;
            double mkt = marketPrice();

            // Aggressive BUY orders: 2.5%, 3.0%, 3.5%, 4.0% above market
            for (int i = 0; i < 4 && running_; ++i) {
                double premium = PD_PUMP_PRICE_PREMIUM + i * 0.005;
                double price   = mkt * premium;
                placeOrder(std::to_string(PD_MANIP_IDS[i]),
                           OrderSide::BUY, price, pumpQty(eng));
                if (!sleepMs(800)) return;
            }
            if (!sleepMs(PD_PUMP_INTERVAL_MS)) return;
        }
        if (!running_) return;

        // ══════════════════════════════════════════════════════════════════════
        //  PHASE 3 — DUMP
        //  Manipulators SELL all holdings at the inflated peak price.
        //  Large SELL orders hit the book just below the bid, immediately
        //  matching against retail BUY orders (FOMO / knife-catchers).
        //  After the dump the ask side floods with supply → price collapses.
        // ══════════════════════════════════════════════════════════════════════
        setPhase(Phase::DUMP);
        phaseEnd = std::chrono::steady_clock::now()
                   + std::chrono::milliseconds(PD_DUMP_DURATION_MS);

        while (running_) {
            if (std::chrono::steady_clock::now() >= phaseEnd) break;
            double mkt = marketPrice();

            // SELL just below bid: 0.3%, 0.4%, 0.5%, 0.6% below market
            for (int i = 0; i < 4 && running_; ++i) {
                double discount = PD_DUMP_PRICE_DISCOUNT - i * 0.001;
                double price    = mkt * discount;
                placeOrder(std::to_string(PD_MANIP_IDS[i]),
                           OrderSide::SELL, price, dumpQty(eng));
                if (!sleepMs(500)) return;
            }
            if (!sleepMs(PD_DUMP_INTERVAL_MS)) return;
        }

        setPhase(Phase::DONE);
    }

    // ── Retail FOMO thread: simulates retail participant behaviour per phase ───
    //   ACCUMULATION → retail IDs SELL  (supplying shares to accumulating manips)
    //   PUMP         → retail IDs BUY   (FOMO chase — attracted by rising price)
    //   DUMP         → retail IDs BUY   (catching the falling knife)
    void retailFOMOLoop() {
        std::mt19937 eng(std::random_device{}());
        std::uniform_int_distribution<size_t> qtyDist(PD_RETAIL_QTY_MIN, PD_RETAIL_QTY_MAX);
        std::uniform_int_distribution<int>    idxDist(0, PD_RETAIL_FOMO_COUNT - 1);
        // Retail SELL: slight below-market discount (natural willing seller)
        std::uniform_real_distribution<double> sellDiscDist(0.993, 0.999);
        // Retail BUY: slight above-market premium (eager FOMO buyer / knife-catcher)
        std::uniform_real_distribution<double> buyPremDist(1.001, 1.010);

        // Block until accumulation phase begins (skip the warm-up period)
        {
            std::unique_lock<std::mutex> lk(mtx_);
            cv_.wait(lk, [&] {
                return !running_
                    || phase_ == Phase::ACCUMULATION
                    || phase_ == Phase::PUMP
                    || phase_ == Phase::DUMP;
            });
        }
        if (!running_) return;

        // Active across ACCUMULATION, PUMP, and DUMP
        while (running_) {
            Phase currentPhase;
            {
                std::lock_guard<std::mutex> lk(mtx_);
                currentPhase = phase_;
            }
            if (currentPhase == Phase::DONE || currentPhase == Phase::WARMUP) break;

            double mkt = marketPrice();
            int    rid = PD_RETAIL_FOMO_IDS[idxDist(eng)];
            size_t qty = qtyDist(eng);

            if (currentPhase == Phase::ACCUMULATION) {
                // ── Retail trader voluntarily SELLS into accumulating demand ──
                //    These orders appear as seller_user_id in TRADE_MATCH rows
                //    where buyer_user_id ∈ {2500,2600,2700,2800}.
                double price = mkt * sellDiscDist(eng);
                placeOrder(std::to_string(rid), OrderSide::SELL, price, qty);
            } else {
                // ── PUMP / DUMP: retail FOMO BUY ─────────────────────────────
                //    During PUMP:  matches other retail SELLs  → retail buys from retail
                //    During DUMP:  matches manipulator SELLs   → buyer=retail, seller=manip
                //    These are the "knife-catchers" that absorb the dump.
                double price = mkt * buyPremDist(eng);
                placeOrder(std::to_string(rid), OrderSide::BUY, price, qty);
            }

            if (!sleepMs(PD_RETAIL_FOMO_INTERVAL_MS)) return;
        }
    }

    // ── Singleton boilerplate ─────────────────────────────────────────────────
    PumpAndDumpCoordinator()  = default;
    ~PumpAndDumpCoordinator() { stop(); }
    PumpAndDumpCoordinator(const PumpAndDumpCoordinator&)            = delete;
    PumpAndDumpCoordinator& operator=(const PumpAndDumpCoordinator&) = delete;

    // ── Members ───────────────────────────────────────────────────────────────
    std::shared_ptr<OrderBook> orderBook_;
    Logger*                    logger_   = nullptr;
    int                        instrId_  = 1;
    bool                       running_  = false;
    Phase                      phase_    = Phase::WARMUP;
    mutable std::mutex         mtx_;
    std::condition_variable    cv_;
    std::thread                coordThread_;
    std::thread                retailThread_;
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

    // Dispatch to the correct primary behaviour for this trader.
    void run() {
        if (isWashTrader_)
            runWash();
        else
            runRetail();
    }

    // ── Members ───────────────────────────────────────────────────────────────
    std::shared_ptr<OrderBook> orderBook_;
    std::string                traderId_;
    bool                       isWashTrader_ = false;
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