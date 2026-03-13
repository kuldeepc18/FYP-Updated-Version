#ifndef MOCK_TRADER_HPP
#define MOCK_TRADER_HPP

#include <random>
#include <thread>
#include <chrono>
#include <cmath>
#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstdlib>
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
//  MANIPULATION #3 — LAYERING  (userIds 1–15, one manipulator per instrument)
//  ─────────────────────────────────────────────────────────────────────────────
//  LAYERING_ACTIVE   master on/off switch.
//    true  → 15 dedicated threads run a perpetual layering cycle on each of
//             the 15 instruments.  Each manipulator:
//               CASE 1 (Bearish Layering) — places 3–7 large SELL LIMIT orders
//                 across multiple price levels above the current LTP, waits
//                 100 ms–3 s, cancels all of them, then places a small BUY
//                 to profit from the artificial sell-wall effect.
//               CASE 2 (Bullish Layering) — mirrors CASE 1 on the BUY side:
//                 3–7 large BUY LIMIT orders below LTP → wait → cancel all →
//                 small SELL at the inflated price.
//             The two cases are chosen randomly each burst cycle.
//    false → LayeringCoordinator::start() is a no-op; only normal traders run.
//
//  ML-detectable red flags in QuestDB trade_logs:
//    ✦ High ORDER_NEW count from userIds 1–15 on their respective instruments
//    ✦ High ORDER_CANCELLED count within 100 ms–3 s of placement
//    ✦ Cancel-to-order ratio 85–90 %  (<<5 fills for every ~35+ new orders)
//    ✦ Large order sizes (20 000–80 000) dwarfing normal traders (100–2 000)
//    ✦ Orders clustered at 3–7 consecutive price levels with 0.2–0.8 % gaps
//    ✦ Immediate opposite-side small trade after the cancellation burst
//    ✦ trader_type = "manipulator" on all layering rows
// ═══════════════════════════════════════════════════════════════════════════════
static constexpr bool   LAYERING_ACTIVE        = true;
static constexpr int    LAYERING_MANIP_COUNT   = 15;     // one per instrument (ids 1–15)

// ── Cancellation-policy targets requested for dataset realism ───────────────
// Normal traders:
//   cancel rate         : 20–25%
//   among cancellations : 80–85% partial-cancel, 15–20% zero-fill cancel
static constexpr double NORMAL_CANCEL_RATE_MIN          = 0.20;
static constexpr double NORMAL_CANCEL_RATE_MAX          = 0.25;
static constexpr double NORMAL_PARTIAL_CANCEL_SHARE_MIN = 0.80;
static constexpr double NORMAL_PARTIAL_CANCEL_SHARE_MAX = 0.85;

// Manipulator traders (layering ids 1–15):
//   cancel rate         : 60–70%
//   among cancellations : 30–40% partial-cancel, 60–70% zero-fill cancel
static constexpr double MANIP_CANCEL_RATE_MIN           = 0.60;
static constexpr double MANIP_CANCEL_RATE_MAX           = 0.70;
static constexpr double MANIP_PARTIAL_CANCEL_SHARE_MIN  = 0.30;
static constexpr double MANIP_PARTIAL_CANCEL_SHARE_MAX  = 0.40;

// Fake (spoofed) layering order parameters
static constexpr size_t LAYERING_QTY_MIN       = 20000;  // shares per fake level
static constexpr size_t LAYERING_QTY_MAX       = 80000;
static constexpr int    LAYERING_LEVELS_MIN    = 12;     // price levels per burst
static constexpr int    LAYERING_LEVELS_MAX    = 20;
static constexpr double LAYERING_GAP_MIN       = 0.002;  // 0.2 % gap between levels
static constexpr double LAYERING_GAP_MAX       = 0.008;  // 0.8 % gap between levels

// Spoof window — how long fake orders remain in the book before cancellation
static constexpr int    LAYERING_CANCEL_MIN_MS = 80;     // 80 ms minimum
static constexpr int    LAYERING_CANCEL_MAX_MS = 260;    // 260 ms maximum

// Profit trade placed on the opposite side after cancelling fake orders
static constexpr size_t LAYERING_PROFIT_QTY    = 3000;   // shares — smaller than fake orders

// Idle time between layering burst cycles
static constexpr int    LAYERING_PAUSE_MIN_MS  = 120;    // 120 ms minimum between bursts
static constexpr int    LAYERING_PAUSE_MAX_MS  = 420;    // 420 ms maximum between bursts

class CancellationMixController {
public:
    CancellationMixController(double cancelMin,
                              double cancelMax,
                              double partialMin,
                              double partialMax)
        : cancelMin_(cancelMin)
        , cancelMax_(cancelMax)
        , partialMin_(partialMin)
        , partialMax_(partialMax)
    {}

    void recordPlaced() {
        placed_.fetch_add(1, std::memory_order_relaxed);
    }

    void recordCancelled(bool partialCancelled) {
        cancelled_.fetch_add(1, std::memory_order_relaxed);
        if (partialCancelled) partialCancelled_.fetch_add(1, std::memory_order_relaxed);
    }

    bool shouldAttemptCancel(std::mt19937& eng, double baseProbability) const {
        const double cancelRate = currentCancelRate();
        if (cancelRate < cancelMin_) return true;
        if (cancelRate > cancelMax_) return false;

        const double target = 0.5 * (cancelMin_ + cancelMax_);
        double adaptive = baseProbability + (target - cancelRate) * 2.0;
        adaptive = std::max(0.01, std::min(0.99, adaptive));

        std::uniform_real_distribution<double> gate(0.0, 1.0);
        return gate(eng) < adaptive;
    }

    bool preferPartialCancel(std::mt19937& eng) const {
        const double partialShare = currentPartialCancelledShare();
        if (partialShare < partialMin_) return true;
        if (partialShare > partialMax_) return false;

        const double target = 0.5 * (partialMin_ + partialMax_);
        double adaptive = 0.5 + (target - partialShare);
        adaptive = std::max(0.05, std::min(0.95, adaptive));
        std::uniform_real_distribution<double> gate(0.0, 1.0);
        return gate(eng) < adaptive;
    }

    bool isBelowCancelFloor() const {
        return currentCancelRate() < cancelMin_;
    }

private:
    double currentCancelRate() const {
        const auto placed = placed_.load(std::memory_order_relaxed);
        if (placed == 0) return 0.0;
        const auto cancelled = cancelled_.load(std::memory_order_relaxed);
        return static_cast<double>(cancelled) / static_cast<double>(placed);
    }

    double currentPartialCancelledShare() const {
        const auto cancelled = cancelled_.load(std::memory_order_relaxed);
        if (cancelled == 0) return 0.0;
        const auto partialCancelled = partialCancelled_.load(std::memory_order_relaxed);
        return static_cast<double>(partialCancelled) / static_cast<double>(cancelled);
    }

    double               cancelMin_;
    double               cancelMax_;
    double               partialMin_;
    double               partialMax_;
    std::atomic<uint64_t> placed_{0};
    std::atomic<uint64_t> cancelled_{0};
    std::atomic<uint64_t> partialCancelled_{0};
};

inline CancellationMixController& normalCancellationPolicy() {
    static CancellationMixController policy(
        NORMAL_CANCEL_RATE_MIN,
        NORMAL_CANCEL_RATE_MAX,
        NORMAL_PARTIAL_CANCEL_SHARE_MIN,
        NORMAL_PARTIAL_CANCEL_SHARE_MAX);
    return policy;
}

inline CancellationMixController& manipCancellationPolicy() {
    static CancellationMixController policy(
        MANIP_CANCEL_RATE_MIN,
        MANIP_CANCEL_RATE_MAX,
        MANIP_PARTIAL_CANCEL_SHARE_MIN,
        MANIP_PARTIAL_CANCEL_SHARE_MAX);
    return policy;
}

inline bool isLayeringManipulatorTraderId(const std::string& traderId) {
    if (traderId.empty()) return false;
    char* end = nullptr;
    const long id = std::strtol(traderId.c_str(), &end, 10);
    return (end != traderId.c_str() && *end == '\0' && id >= 1 && id <= 15);
}

inline CancellationMixController& cancellationPolicyForTrader(const std::string& traderId) {
    return isLayeringManipulatorTraderId(traderId)
        ? manipCancellationPolicy()
        : normalCancellationPolicy();
}

inline void recordOrderPlacedForTrader(const std::string& traderId) {
    cancellationPolicyForTrader(traderId).recordPlaced();
}

inline void recordOrderCancelledForTrader(const std::string& traderId, bool wasPartialBeforeCancel) {
    cancellationPolicyForTrader(traderId).recordCancelled(wasPartialBeforeCancel);
}

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

// ─────────────────────────────────────────────────────────────────────────────
//  LayeringCoordinator
//  ─────────────────────────────────────────────────────────────────────────────
//  Singleton that manages 15 dedicated manipulator threads — one per instrument.
//  Each thread independently runs a perpetual layering cycle:
//
//    1. Sleep LAYERING_PAUSE_MIN_MS – LAYERING_PAUSE_MAX_MS (burst inter-arrival)
//    2. Randomly choose CASE 1 (bearish/fake-SELL) or CASE 2 (bullish/fake-BUY)
//    3. Place LAYERING_LEVELS_MIN–LAYERING_LEVELS_MAX large LIMIT orders at
//       successive price levels (0.2–0.8 % apart) away from the current LTP.
//       Each order is logged as ORDER_NEW immediately after addOrder().
//    4. Sleep LAYERING_CANCEL_MIN_MS – LAYERING_CANCEL_MAX_MS (spoof window).
//    5. Cancel every still-pending layering order; log ORDER_CANCELLED.
//    6. Place one small LIMIT-IOC profit order on the OPPOSITE side; log result.
//
//  TradingApplication::start() calls:
//    LayeringCoordinator::instance().init(orderBooks_, &logger_);
//    LayeringCoordinator::instance().start();
//  TradingApplication cleanup calls:
//    LayeringCoordinator::instance().stop();
// ─────────────────────────────────────────────────────────────────────────────
class LayeringCoordinator {
public:
    static LayeringCoordinator& instance() {
        static LayeringCoordinator inst;
        return inst;
    }

    // Must be called BEFORE start(). Supplies all 15 order books and the logger.
    void init(const std::map<int, std::shared_ptr<OrderBook>>& orderBooks, Logger* log) {
        std::lock_guard<std::mutex> lk(mtx_);
        orderBooks_ = orderBooks;
        logger_     = log;
    }

    void start() {
        if (!LAYERING_ACTIVE) return;
        {
            std::lock_guard<std::mutex> lk(mtx_);
            if (orderBooks_.empty() || !logger_) return;
            running_ = true;
        }
        // Spawn one thread per instrument/manipulator pair
        for (int i = 0; i < LAYERING_MANIP_COUNT; ++i) {
            int         instrId = i + 1;                  // instruments 1–15
            std::string userId  = std::to_string(i + 1); // userIds    1–15
            threads_.emplace_back(
                &LayeringCoordinator::manipulatorLoop, this, instrId, userId);
        }
    }

    void stop() {
        {
            std::lock_guard<std::mutex> lk(mtx_);
            running_ = false;
        }
        for (auto& t : threads_)
            if (t.joinable()) t.join();
        threads_.clear();
    }

private:
    // ── Per-manipulator thread body ───────────────────────────────────────────
    void manipulatorLoop(int instrId, const std::string& userId) {
        // Seed with device entropy XOR'd with a userId-derived value so each
        // of the 15 threads has an independent random stream.
        std::mt19937 eng(std::random_device{}() ^
                         static_cast<uint32_t>(std::hash<std::string>{}(userId)));

        std::uniform_int_distribution<int>     pauseDist (LAYERING_PAUSE_MIN_MS,  LAYERING_PAUSE_MAX_MS);
        std::uniform_int_distribution<int>     cancelDist(LAYERING_CANCEL_MIN_MS, LAYERING_CANCEL_MAX_MS);
        std::uniform_int_distribution<int>     levelsDist(LAYERING_LEVELS_MIN,    LAYERING_LEVELS_MAX);
        std::uniform_int_distribution<size_t>  qtyDist   (LAYERING_QTY_MIN,       LAYERING_QTY_MAX);
        std::uniform_real_distribution<double> gapDist   (LAYERING_GAP_MIN,       LAYERING_GAP_MAX);
        std::uniform_int_distribution<int>     caseDist  (0, 1); // 0=CASE1, 1=CASE2

        while (running_) {
            // ── 1. Inter-burst idle ───────────────────────────────────────────
            std::this_thread::sleep_for(
                std::chrono::milliseconds(pauseDist(eng)));
            if (!running_) break;

            // Fetch the order book for this instrument
            std::shared_ptr<OrderBook> ob;
            {
                std::lock_guard<std::mutex> lk(mtx_);
                auto it = orderBooks_.find(instrId);
                if (it == orderBooks_.end()) continue;
                ob = it->second;
            }

            double ltp = InstrumentManager::getInstance().getLTP(instrId);
            if (ltp <= 0.0) continue;

            // ── 2. Choose manipulation case ───────────────────────────────────
            // CASE 1: bearish — fake SELL wall above LTP → price dips → BUY profit
            // CASE 2: bullish — fake BUY  wall below LTP → price rises → SELL profit
            const bool isCase1 = (caseDist(eng) == 0);
            const int  levels  = levelsDist(eng);

            // ── 3. Place fake layering orders ─────────────────────────────────
            // Each level uses an independently sampled gap, creating realistic
            // non-uniform spacing between price levels in the order book.
            std::vector<std::shared_ptr<Order>> layeringOrders;
            layeringOrders.reserve(static_cast<size_t>(levels));

            for (int lvl = 1; lvl <= levels; ++lvl) {
                if (!running_) break;

                // First few levels are closer to touch with smaller size to
                // naturally create PARTIAL / FILLED transitions; deeper levels
                // remain farther and larger so NEW→EXPIRED and NEW→CANCELLED
                // paths also occur.
                const bool nearTouch = (lvl <= 3);
                const double gap = nearTouch
                    ? std::uniform_real_distribution<double>(0.0002, 0.0012)(eng)
                    : gapDist(eng);                             // 0.2–0.8 % deeper levels
                const size_t qty = nearTouch
                    ? std::uniform_int_distribution<size_t>(5000, 20000)(eng)
                    : qtyDist(eng);                             // 20 000–80 000 shares
                double       price;
                OrderSide    side;

                if (isCase1) {
                    // CASE 1: SELL orders stacked ABOVE current LTP
                    side  = OrderSide::SELL;
                    price = ltp * (1.0 + gap * static_cast<double>(lvl));
                } else {
                    // CASE 2: BUY orders stacked BELOW current LTP
                    side  = OrderSide::BUY;
                    price = ltp * (1.0 - gap * static_cast<double>(lvl));
                }
                price = std::round(price * 100.0) / 100.0; // 2 d.p. rounding

                auto order = std::make_shared<Order>(
                    OrderType::LIMIT, side, price, qty,
                    TimeInForce::GTC, userId, instrId);

                ob->addOrder(order);
                recordOrderPlacedForTrader(userId);
                // Log ORDER_NEW immediately — fake order is now visible in the book
                if (logger_) logger_->logOrder(*order);
                layeringOrders.push_back(order);
            }

            if (layeringOrders.empty()) continue;

            // ── 4. Spoof window — orders sit in the book creating artificial pressure
            std::this_thread::sleep_for(
                std::chrono::milliseconds(cancelDist(eng)));

            // ── 5. Cancel all fake orders ─────────────────────────────────────
            cancelLayeringOrders(ob, layeringOrders, userId, eng);
            if (!running_) break;

            // ── 6. Profit trade — small opposite-side LIMIT-IOC ───────────────
            // IOC ensures the order is either filled immediately against existing
            // book liquidity or discarded — it never rests in the book, keeping
            // the manipulator's footprint minimal after the spoof window closes.
            double    ltp2       = InstrumentManager::getInstance().getLTP(instrId);
            OrderSide profitSide;
            double    profitPrice;

            if (isCase1) {
                // After fake SELL pressure: BUY at slightly above LTP to cross spread
                profitSide  = OrderSide::BUY;
                profitPrice = std::round(ltp2 * 1.005 * 100.0) / 100.0;
            } else {
                // After fake BUY pressure: SELL at slightly below LTP to cross spread
                profitSide  = OrderSide::SELL;
                profitPrice = std::round(ltp2 * 0.995 * 100.0) / 100.0;
            }

            auto profitOrder = std::make_shared<Order>(
                OrderType::LIMIT, profitSide, profitPrice, LAYERING_PROFIT_QTY,
                TimeInForce::IOC, userId, instrId);

            ob->addOrder(profitOrder);
            recordOrderPlacedForTrader(userId);
            // logOrder() will capture the final status (FILLED, PARTIALLY_FILLED,
            // or CANCELLED-by-IOC if no counterparty was found).
            if (logger_) logger_->logOrder(*profitOrder);
        }
    }

    // ── Cancel all still-pending layering orders and log ORDER_CANCELLED ──────
    void cancelLayeringOrders(
        const std::shared_ptr<OrderBook>&          ob,
        const std::vector<std::shared_ptr<Order>>& orders,
        const std::string&                         userId,
        std::mt19937&                              eng)
    {
        std::vector<std::shared_ptr<Order>> shuffled = orders;
        std::shuffle(shuffled.begin(), shuffled.end(), eng);

        auto& policy = cancellationPolicyForTrader(userId);
        size_t pendingPartial = 0;
        size_t pendingZero    = 0;
        for (const auto& order : shuffled) {
            if (!order) continue;
            const auto s = order->getStatus();
            if (s == OrderStatus::PARTIALLY_FILLED) ++pendingPartial;
            else if (s == OrderStatus::NEW) ++pendingZero;
        }

        for (const auto& order : shuffled) {
            if (!order) continue;
            const auto s = order->getStatus();
            if (s != OrderStatus::NEW && s != OrderStatus::PARTIALLY_FILLED) continue;

            if (!policy.shouldAttemptCancel(eng, 0.65)) continue;

            const bool preferPartial = policy.preferPartialCancel(eng);
            if (preferPartial && s != OrderStatus::PARTIALLY_FILLED && pendingPartial > 0) continue;
            if (!preferPartial && s != OrderStatus::NEW && pendingZero > 0) continue;

            const bool wasPartialBeforeCancel = (s == OrderStatus::PARTIALLY_FILLED);
            ob->cancelOrder(order->getOrderId());
            if (order->getStatus() == OrderStatus::CANCELLED) {
                recordOrderCancelledForTrader(userId, wasPartialBeforeCancel);
                if (wasPartialBeforeCancel && pendingPartial > 0) --pendingPartial;
                if (!wasPartialBeforeCancel && pendingZero > 0) --pendingZero;
                if (logger_) logger_->logOrder(*order);
            }
        }
    }

    // ── Private constructor / copy-delete (singleton) ─────────────────────────
    LayeringCoordinator()  = default;
    ~LayeringCoordinator() { stop(); }
    LayeringCoordinator(const LayeringCoordinator&)            = delete;
    LayeringCoordinator& operator=(const LayeringCoordinator&) = delete;

    // ── Members ───────────────────────────────────────────────────────────────
    std::map<int, std::shared_ptr<OrderBook>> orderBooks_;
    Logger*                                   logger_  = nullptr;
    bool                                      running_ = false;
    std::mutex                                mtx_;
    std::vector<std::thread>                  threads_;
};


class MockTrader {
public:
    // ── Trader archetypes ─────────────────────────────────────────────────────
    // Assignment per instrument (200 traders total):
    //   i <  10 → MARKET_MAKER   (10,  5%) — continuous two-sided quotes
    //   i <  60 → MOMENTUM       (50, 25%) — trend-following, LTP history driven
    //   i <  80 → MEAN_REVERSION (20, 10%) — buys dips, sells rallies
    //   i < 200 → NOISE          (120,60%) — OU-biased random retail orders
    enum class Archetype { NOISE, MOMENTUM, MEAN_REVERSION, MARKET_MAKER };

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
    //  Lifecycle diversity for NORMAL traders (ids >= 16)
    //
    //  Produces a random mix of realistic order paths:
    //    NEW -> PARTIAL -> CANCELLED     (handled by cancellation policy)
    //    NEW -> PARTIAL -> EXPIRED       (passive+large GTC near touch)
    //    NEW -> EXPIRED                  (deep passive GTC)
    //    NEW -> FILLED                   (aggressive IOC)
    //    NEW -> PARTIAL -> FILLED        (aggressive large GTC)
    //
    //  No synthetic status mutation is used; outcomes come from real matching,
    //  cancellation, and expiry threads.
    // ──────────────────────────────────────────────────────────────────────────
    void applyNormalLifecycleDiversity(OrderSide side,
                                       double ltp,
                                       double& price,
                                       TimeInForce& tif,
                                       size_t& qty)
    {
        if (isLayeringManipulatorTraderId(traderId_)) return;

        std::uniform_real_distribution<double> choice(0.0, 1.0);
        const double r = choice(engine_);

        // ~8%: deep passive order likely to remain unmatched and EXPIRE.
        if (r < 0.08) {
            tif = TimeInForce::GTC;
            if (side == OrderSide::BUY) price = ltp * 0.94;
            else                        price = ltp * 1.06;
            qty = std::max<size_t>(qty, 80);
            return;
        }

        // ~8%: larger near-touch resting order, often partial then EXPIRED.
        if (r < 0.16) {
            tif = TimeInForce::GTC;
            if (side == OrderSide::BUY) price = ltp * 0.998;
            else                        price = ltp * 1.002;
            qty = std::max<size_t>(qty * 4, 120);
            return;
        }

        // ~30%: aggressive IOC, mostly NEW->FILLED (or partial immediate fill).
        if (r < 0.46) {
            tif = TimeInForce::IOC;
            if (side == OrderSide::BUY) price = ltp * 1.004;
            else                        price = ltp * 0.996;
            qty = std::max<size_t>(qty, 20);
            return;
        }

        // Remaining cases keep archetype-native behavior.
    }

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
            // ── 15% chance to cancel one resting GTC order before placing a
            //    new one — retail traders regularly change their minds or adjust
            //    to news, creating realistic ORDER_CANCELLED events.
            maybeCancelGTCOrder(0.45, 2);

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
            applyNormalLifecycleDiversity(side, ltp, price, tif, qty);
            auto order = std::make_shared<Order>(
                orderType, side, price, qty, tif, traderId_, instrumentId_);
            orderBook_->addOrder(order);
            recordOrderPlacedForTrader(traderId_);
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
            // ── 12% chance to cancel a pending order that may now be against
            //    the updated trend direction — a realistic momentum-trader
            //    risk-management step before reassessing the market.
            maybeCancelGTCOrder(0.40, 2);

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
            TimeInForce tif  = TimeInForce::GTC;

            applyNormalLifecycleDiversity(side, ltp, price, tif, qty);

            auto order = std::make_shared<Order>(
                OrderType::LIMIT, side, price, qty,
                tif, traderId_, instrumentId_);
            orderBook_->addOrder(order);
            recordOrderPlacedForTrader(traderId_);
            if (logger_) logger_->logOrder(*order);
            // Track for future cancellation when the trend reverses.
            if (tif == TimeInForce::GTC) trackGTCOrder(order);
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
            // ── 10% chance to cancel a resting order whose price may now be
            //    far from the updated rolling mean — mean-reversion traders
            //    cull stale orders whenever the mean shifts significantly.
            maybeCancelGTCOrder(0.35, 2);

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
            TimeInForce tif = TimeInForce::GTC;

            applyNormalLifecycleDiversity(side, ltp, price, tif, qty);

            auto order = std::make_shared<Order>(
                OrderType::LIMIT, side, price, qty,
                tif, traderId_, instrumentId_);
            orderBook_->addOrder(order);
            recordOrderPlacedForTrader(traderId_);
            if (logger_) logger_->logOrder(*order);
            // Track for future cancellation when the mean shifts.
            if (tif == TimeInForce::GTC) trackGTCOrder(order);
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
            maybeCancelGTCOrder(0.95, 4);

            double ltp = InstrumentManager::getInstance().getLTP(instrumentId_);
            auto   qty = qtyDist(engine_);

            // Place BUY quote below LTP
            auto buyOrder = std::make_shared<Order>(
                OrderType::LIMIT, OrderSide::BUY,
                ltp * (1.0 - halfSpread), qty,
                TimeInForce::GTC, traderId_, instrumentId_);
            orderBook_->addOrder(buyOrder);
            recordOrderPlacedForTrader(traderId_);
            if (logger_) logger_->logOrder(*buyOrder);
            // Track the new bid so it can be cancelled on the next iteration.
            trackGTCOrder(buyOrder);

            // Place SELL quote above LTP
            auto sellOrder = std::make_shared<Order>(
                OrderType::LIMIT, OrderSide::SELL,
                ltp * (1.0 + halfSpread), qty,
                TimeInForce::GTC, traderId_, instrumentId_);
            orderBook_->addOrder(sellOrder);
            recordOrderPlacedForTrader(traderId_);
            if (logger_) logger_->logOrder(*sellOrder);
            // Track the new ask so it can be cancelled on the next iteration.
            trackGTCOrder(sellOrder);
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
                recordOrderPlacedForTrader(traderId_);
                if (logger_) logger_->logOrder(*buyOrder);

                std::this_thread::sleep_for(std::chrono::milliseconds(WASH_INTERVAL_MS));
                if (!running_) break;

                auto sellOrder = std::make_shared<Order>(
                    OrderType::LIMIT, OrderSide::SELL,
                    washPrice,      // same price — red flag ✦
                    WASH_QUANTITY,  // same qty   — red flag ✦
                    TimeInForce::GTC, traderId_, instrumentId_);
                orderBook_->addOrder(sellOrder);
                recordOrderPlacedForTrader(traderId_);
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
        // Hard cap: keep at most 60 candidates to improve cancellation
        // opportunity density while still bounding memory.
        if (pendingGTCOrders_.size() > 60)
            pendingGTCOrders_.erase(pendingGTCOrders_.begin());
    }

    // Purge orders that are no longer cancellable (FILLED / CANCELLED / EXPIRED),
    // then cancel up to maxCancels randomly chosen pending GTC orders with the
    // given probability.
    // The cancelled order is immediately logged to QuestDB as ORDER_CANCELLED.
    void maybeCancelGTCOrder(double probability, size_t maxCancels = 1) {
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

        auto& policy = cancellationPolicyForTrader(traderId_);

        // Step 3 — cancel a bounded number of randomly selected pending orders.
        // If current cancel rate is below floor, temporarily increase attempts
        // to steer back toward target range faster.
        const size_t dynamicMaxCancels = maxCancels + (policy.isBelowCancelFloor() ? 2 : 0);
        const size_t attempts = std::min(dynamicMaxCancels, pendingGTCOrders_.size());
        for (size_t i = 0; i < attempts; ++i) {
            if (pendingGTCOrders_.empty()) break;
            if (!policy.shouldAttemptCancel(engine_, probability)) break;

            std::vector<size_t> partialIdx;
            std::vector<size_t> zeroIdx;
            partialIdx.reserve(pendingGTCOrders_.size());
            zeroIdx.reserve(pendingGTCOrders_.size());
            for (size_t idx = 0; idx < pendingGTCOrders_.size(); ++idx) {
                const auto& cand = pendingGTCOrders_[idx];
                if (!cand) continue;
                const auto st = cand->getStatus();
                if (st == OrderStatus::PARTIALLY_FILLED) partialIdx.push_back(idx);
                else if (st == OrderStatus::NEW) zeroIdx.push_back(idx);
            }

            if (partialIdx.empty() && zeroIdx.empty()) break;

            const bool wantPartial = policy.preferPartialCancel(engine_);
            const std::vector<size_t>* source = nullptr;
            if (wantPartial && !partialIdx.empty()) source = &partialIdx;
            else if (!wantPartial && !zeroIdx.empty()) source = &zeroIdx;
            else if (!partialIdx.empty()) source = &partialIdx;
            else source = &zeroIdx;

            std::uniform_int_distribution<size_t> pickVec(0, source->size() - 1);
            const size_t pickedPos = (*source)[pickVec(engine_)];
            auto order = pendingGTCOrders_[pickedPos];
            pendingGTCOrders_[pickedPos] = pendingGTCOrders_.back();
            pendingGTCOrders_.pop_back();

            if (!order) continue;

            const auto s = order->getStatus();
            if (s == OrderStatus::NEW || s == OrderStatus::PARTIALLY_FILLED) {
                // cancelOrder() acquires the book mutex, removes the order from the
                // price level map, and calls order->cancel() which stamps the cancel
                // timestamp and sets status = CANCELLED.
                orderBook_->cancelOrder(order->getOrderId());
                // After the call the shared_ptr still points to the same Order object
                // whose status is now CANCELLED — log it to produce ORDER_CANCELLED
                // in QuestDB trade_logs.
                if (order->getStatus() == OrderStatus::CANCELLED) {
                    const bool wasPartialBeforeCancel = (s == OrderStatus::PARTIALLY_FILLED);
                    recordOrderCancelledForTrader(traderId_, wasPartialBeforeCancel);
                    if (logger_) logger_->logOrder(*order);
                }
            }
        }
    }

    // Dispatch to the correct primary behaviour for this trader.
    void run() {
        if (isWashTrader_) { runWash(); return; }
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
    bool                       isWashTrader_ = false;
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

int MockTrader::mockTraderCount = 16; // IDs 1-15 reserved for LayeringCoordinator manipulators

#endif // MOCK_TRADER_HPP