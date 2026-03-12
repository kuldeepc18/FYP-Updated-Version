#ifndef INSTRUMENT_HPP
#define INSTRUMENT_HPP

#include <string>
#include <vector>
#include <map>
#include <deque>
#include <mutex>
#include <thread>
#include <atomic>
#include <random>
#include <cmath>
#include <chrono>
#include <algorithm>
// ── POSIX socket headers for loadLTPFromQuestDB() ─────────────────────────
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <cstring>   // strlen
#include <cstdio>    // fprintf, sscanf

// ── Instrument record ─────────────────────────────────────────────────────────
// marketPrice is the INITIAL / cold-start fallback price only.
// All runtime price reads MUST use InstrumentManager::getLTP(id).
// This field is never written after startup — no const_cast needed anywhere.
struct Instrument {
    std::string name;
    std::string symbol;
    int         instrumentId;
    double      marketPrice; // initial price — read-only after construction

    Instrument(const std::string& n, const std::string& s, int id, double mPrice)
        : name(n), symbol(s), instrumentId(id), marketPrice(mPrice) {}
};

// ── InstrumentManager ─────────────────────────────────────────────────────────
// Singleton that owns:
//   1. The immutable instrument catalogue (name, symbol, id, initial price).
//   2. A mutex-protected LTP map updated on every matched trade via setLTP().
//   3. A rolling 30-sample LTP history per instrument (for momentum traders).
//   4. An Ornstein-Uhlenbeck sentiment engine: priceTrend ∈ [−0.4, +0.4]
//      updated every 2–3 s, converging to 0 with mean-reversion coefficient 0.97.
// ─────────────────────────────────────────────────────────────────────────────
class InstrumentManager {
public:
    static InstrumentManager& getInstance() {
        static InstrumentManager instance;
        return instance;
    }

    ~InstrumentManager() {
        sentimentRunning_.store(false);
        if (sentimentThread_.joinable())
            sentimentThread_.join();
    }

    const std::vector<Instrument>& getInstruments() const { return instruments_; }

    const Instrument* getInstrumentById(int id) const {
        for (const auto& instr : instruments_)
            if (instr.instrumentId == id) return &instr;
        return nullptr;
    }

    // ── True Last Traded Price ────────────────────────────────────────────────
    // Called by OrderBook::executeTrade() immediately after every matched trade.
    // Thread-safe: protected by ltpMutex_.
    void setLTP(int id, double price) {
        std::lock_guard<std::mutex> lk(ltpMutex_);
        ltpMap_[id] = price;
        auto& hist = ltpHistory_[id];
        hist.push_back(price);
        if (hist.size() > 30) hist.pop_front(); // rolling window of 30
    }

    // Returns the LTP for the given instrument.
    // Falls back to the instrument's initial price if no trade has executed yet.
    double getLTP(int id) const {
        std::lock_guard<std::mutex> lk(ltpMutex_);
        auto it = ltpMap_.find(id);
        if (it != ltpMap_.end()) return it->second;
        for (const auto& instr : instruments_)
            if (instr.instrumentId == id) return instr.marketPrice;
        return 100.0;
    }

    // Returns the last n LTP values (oldest→newest). May return fewer than n
    // if fewer trades have executed. Used by momentum traders.
    std::vector<double> getLTPHistory(int id, int n) const {
        std::lock_guard<std::mutex> lk(ltpMutex_);
        auto it = ltpHistory_.find(id);
        if (it == ltpHistory_.end()) return {};
        const auto& hist = it->second;
        int count = std::min(n, static_cast<int>(hist.size()));
        return std::vector<double>(hist.end() - count, hist.end());
    }

    // Returns the number of instruments whose LTP was seeded from QuestDB.
    // 0 = QuestDB unreachable or no prior TRADE_MATCH rows — hardcoded seeds.
    int getLTPRestoreCount() const { return ltpRestoredCount_; }

    // ── Ornstein-Uhlenbeck sentiment ─────────────────────────────────────────
    // Returns priceTrend ∈ [−0.4, +0.4] for the given instrument.
    // Updated every 2–3 s by the background OU thread.
    // Long-run mean = 0.0; oscillates with σ ≈ 0.025 per step.
    double getPriceTrend(int id) const {
        std::lock_guard<std::mutex> lk(sentimentMutex_);
        auto it = priceTrend_.find(id);
        if (it != priceTrend_.end()) return it->second;
        return 0.0;
    }

private:
    InstrumentManager() {
        instruments_ = {
            Instrument("Reliance Industries",       "RELIANCE (NSE)",   1,  1577.00),
            Instrument("Tata Consultancy Services", "TCS (NSE)",        2,  3213.00),
            Instrument("Dixon Technologies",        "DIXON (NSE)",      3, 12055.00),
            Instrument("HDFC Bank",                 "HDFCBANK (NSE)",   4,   987.50),
            Instrument("Tata Motors",               "TATAMOTORS (NSE)", 5,   373.55),
            Instrument("Tata Power",                "TATAPOWER (NSE)",  6,   388.00),
            Instrument("Adani Enterprises",         "ADANIENT (NSE)",   7,  2279.00),
            Instrument("Adani Green Energy",        "ADANIGREEN (NSE)", 8,  1028.80),
            Instrument("Adani Power",               "ADANIPOWER (NSE)", 9,   146.00),
            Instrument("Tanla Platforms",           "TANLA (NSE)",     10,   524.00),
            Instrument("Nifty 50 Index",            "NIFTY 50",        11, 26250.30),
            Instrument("Bank Nifty Index",          "BANKNIFTY",       12, 60044.20),
            Instrument("FinNifty",                  "FINNIFTY",        13, 27851.45),
            Instrument("Sensex",                    "SENSEX",          14, 84961.14),
            Instrument("Nifty Next 50 Index",       "NIFTY NEXT 50",   15, 70413.40)
        };

        // Seed LTP map and sentiment map with initial prices
        for (const auto& instr : instruments_) {
            ltpMap_[instr.instrumentId]     = instr.marketPrice;
            priceTrend_[instr.instrumentId] = 0.0;
        }

        // Restore LTP and rolling price history from QuestDB if a previous
        // session exists. Overwrites hardcoded seeds with real last-traded
        // prices. Falls back silently to hardcoded seeds on any failure.
        // Must run BEFORE the OU sentiment thread starts (single-threaded here).
        loadLTPFromQuestDB();

        // Launch the OU sentiment background thread
        sentimentRunning_.store(true);
        sentimentThread_ = std::thread(&InstrumentManager::runSentimentEngine, this);
    }

    // Non-copyable singleton
    InstrumentManager(const InstrumentManager&)            = delete;
    InstrumentManager& operator=(const InstrumentManager&) = delete;

    // ── Ornstein-Uhlenbeck mean-reversion sentiment engine ────────────────────
    // Update rule every 2–3 s:
    //   priceTrend[i] = priceTrend[i] × 0.97 + N(0, 0.025)
    //
    // Mathematical guarantee: long-run mean = 0, std-dev ≈ 0.025/√(1−0.97²) ≈ 0.127
    // Values are soft-clamped to [−0.4, +0.4] to prevent runaway extremes.
    // When priceTrend > 0 → bullish regime; < 0 → bearish regime.
    // The OU pull (×0.97) ensures every trend eventually reverts to 0.
    void runSentimentEngine() {
        std::mt19937_64                   eng(std::random_device{}());
        std::normal_distribution<double>  noise(0.0, 0.025);
        std::uniform_int_distribution<int> sleepMs(2000, 3000);

        while (sentimentRunning_.load()) {
            std::this_thread::sleep_for(std::chrono::milliseconds(sleepMs(eng)));
            std::lock_guard<std::mutex> lk(sentimentMutex_);
            for (auto& kv : priceTrend_) {
                double v = kv.second * 0.97 + noise(eng);
                if (v >  0.4) v =  0.4;
                if (v < -0.4) v = -0.4;
                kv.second = v;
            }
        }
    }

    // ── QuestDB LTP restoration ───────────────────────────────────────────────
    // Queries QuestDB REST API (port 9000) for the last 1 500 TRADE_MATCH rows
    // and seeds ltpMap_ + ltpHistory_ with real prices from the previous session.
    //
    // Called from the constructor — runs single-threaded before the OU thread
    // starts and before any mock trader exists, so NO mutex needed here.
    // Direct writes to ltpMap_/ltpHistory_ are therefore safe.
    //
    // On any failure (QuestDB unreachable, malformed JSON, timeout) the method
    // returns without touching ltpMap_, leaving the hardcoded seeds intact.
    void loadLTPFromQuestDB() {
        // ── Open TCP socket to QuestDB HTTP API (port 9000) ─────────────────
        int sock = ::socket(AF_INET, SOCK_STREAM, 0);
        if (sock < 0) {
            std::printf("[InstrumentManager] LTP restore: socket() failed — using HARDCODED seed prices.\n");
            std::fflush(stdout);
            return;
        }
        // 2-second timeout so a hung QuestDB does not block startup
        struct timeval tv;
        tv.tv_sec  = 2;
        tv.tv_usec = 0;
        ::setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
        ::setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port   = htons(9000);
        ::inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);

        if (::connect(sock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
            ::close(sock);
            std::printf("[InstrumentManager] LTP restore: QuestDB not reachable (port 9000) — using HARDCODED seed prices.\n");
            std::fflush(stdout);
            return;
        }

        // ── HTTP GET: last 1500 TRADE_MATCH rows, 2 columns (newest first) ───
        // LIMIT 1500 = 15 instruments × 100 samples — ensures at least 30 per
        // instrument for ltpHistory_ even with uneven trading activity.
        // URL-encoded SQL:
        //   SELECT instrument_id,price FROM trade_logs
        //   WHERE order_status_event='TRADE_MATCH'
        //   ORDER BY timestamp DESC LIMIT 1500
        const char* req =
            "GET /exec?query=SELECT%20instrument_id%2Cprice%20FROM%20trade_logs"
            "%20WHERE%20order_status_event%3D%27TRADE_MATCH%27"
            "%20ORDER%20BY%20timestamp%20DESC%20LIMIT%201500"
            " HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n";
        ::send(sock, req, std::strlen(req), 0);

        // ── Read full response ────────────────────────────────────────────────
        std::string response;
        char buf[4096];
        int  n;
        while ((n = ::recv(sock, buf, sizeof(buf) - 1, 0)) > 0) {
            buf[n] = '\0';
            response += buf;
        }
        ::close(sock);

        if (response.empty()) {
            std::printf("[InstrumentManager] LTP restore: empty response from QuestDB — using HARDCODED seed prices.\n");
            std::fflush(stdout);
            return;
        }

        // ── Find the JSON dataset array ───────────────────────────────────────────
        auto ds = response.find("\"dataset\":[");
        if (ds == std::string::npos) {
            std::printf("[InstrumentManager] LTP restore: no TRADE_MATCH rows in QuestDB yet — using HARDCODED seed prices.\n");
            std::fflush(stdout);
            return;
        }
        size_t pos = ds + 11; // skip past "dataset":[

        // ── Parse [[instrument_id, price], ...] ───────────────────────────────
        // Rows are newest-first from ORDER BY timestamp DESC.
        // First occurrence per instrument_id = most recent = LTP.
        // Accumulate up to 30 per instrument for ltpHistory_.
        // instrument_id is a SYMBOL in QuestDB → comes as quoted string "1"
        // price is a DOUBLE → comes as unquoted number 1582.15
        std::map<int, bool>                seenLTP;  // id → LTP already captured?
        std::map<int, std::vector<double>> hist;     // id → prices newest→oldest
        int restoredCount = 0;

        auto skipWsL = [&]() {
            while (pos < response.size() &&
                   (response[pos]==' '||response[pos]=='\n'||response[pos]=='\r'||response[pos]=='\t'))
                ++pos;
        };

        while (pos < response.size()) {
            skipWsL();
            if (pos < response.size() && response[pos] == ',') { ++pos; continue; }
            if (pos >= response.size() || response[pos] == ']') break;
            if (response[pos] != '[') { ++pos; continue; }
            ++pos; // skip opening '['

            // Column 0: instrument_id — SYMBOL → quoted string e.g. "1"
            skipWsL();
            std::string idToken;
            if (pos < response.size() && response[pos] == '"') {
                ++pos; // skip opening quote
                while (pos < response.size() && response[pos] != '"') idToken += response[pos++];
                if (pos < response.size()) ++pos; // skip closing quote
            } else {
                while (pos < response.size() && response[pos] != ',' && response[pos] != ']')
                    idToken += response[pos++];
            }
            skipWsL();
            if (pos < response.size() && response[pos] == ',') ++pos;

            // Column 1: price — DOUBLE → unquoted number e.g. 1582.15
            skipWsL();
            std::string priceToken;
            while (pos < response.size() && response[pos] != ']' && response[pos] != ',')
                priceToken += response[pos++];

            // Skip to end of this row
            while (pos < response.size() && response[pos] != ']') ++pos;
            if (pos < response.size()) ++pos; // skip ']'

            if (idToken.empty() || priceToken.empty()) continue;

            int    id    = 0;
            double price = 0.0;
            try { id    = std::stoi(idToken);    } catch (...) { continue; }
            try { price = std::stod(priceToken); } catch (...) { continue; }
            if (id < 1 || id > 15 || price <= 0.0) continue;

            // First occurrence = most recent = LTP
            if (!seenLTP[id]) {
                ltpMap_[id] = price;
                seenLTP[id] = true;
                ++restoredCount;
            }
            // Accumulate up to 30 samples for rolling history
            if (hist[id].size() < 30)
                hist[id].push_back(price);
        }

        // ── Populate ltpHistory_ (oldest→newest — reverse of what we read) ───
        // hist[id] is newest→oldest (ORDER BY timestamp DESC).
        // ltpHistory_ is appended oldest→newest during live trading, so reverse.
        for (auto& kv : hist) {
            auto& dq = ltpHistory_[kv.first];
            dq.clear();
            for (auto it = kv.second.rbegin(); it != kv.second.rend(); ++it)
                dq.push_back(*it);
        }

        ltpRestoredCount_ = restoredCount;

        // ── Print startup status to stdout so it’s always visible in the terminal ──
        if (restoredCount == 0) {
            std::printf("[InstrumentManager] QuestDB had no prior TRADE_MATCH rows —"
                        " all 15 instruments using HARDCODED seed prices.\n");
        } else {
            std::printf("[InstrumentManager] LTP restored from QuestDB (%d/15 instruments).\n"
                        "  %-4s  %-22s  %-12s  %s\n",
                        restoredCount, "ID", "Symbol", "Source", "Price (Rs.)");
            std::printf("  %s\n", std::string(58, '-').c_str());
            for (const auto& instr : instruments_) {
                bool fromDB = (seenLTP.count(instr.instrumentId) > 0);
                double p    = ltpMap_.count(instr.instrumentId)
                               ? ltpMap_[instr.instrumentId]
                               : instr.marketPrice;
                std::printf("  %-4d  %-22s  %-12s  %.2f\n",
                            instr.instrumentId,
                            instr.symbol.c_str(),
                            fromDB ? "[QuestDB]" : "[Hardcoded]",
                            p);
            }
        }
        std::fflush(stdout);
    }

    // ── Data members ──────────────────────────────────────────────────────────
    std::vector<Instrument> instruments_;

    mutable std::mutex               ltpMutex_;
    std::map<int, double>            ltpMap_;
    std::map<int, std::deque<double>> ltpHistory_;

    mutable std::mutex      sentimentMutex_;
    std::map<int, double>   priceTrend_;

    std::atomic<bool>       sentimentRunning_{false};
    std::thread             sentimentThread_;

    // Number of instruments whose LTP was seeded from QuestDB at startup.
    // 0 = QuestDB unreachable or no prior data — hardcoded seeds in use.
    int                     ltpRestoredCount_{0};
};

#endif // INSTRUMENT_HPP