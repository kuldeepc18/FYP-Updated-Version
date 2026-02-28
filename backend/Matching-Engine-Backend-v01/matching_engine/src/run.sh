#!/usr/bin/env bash
# Build and run the KTrade matching engine on Linux.
# All order events (NEW/PARTIAL/FILLED/CANCELLED/EXPIRED) are stored in
# QuestDB table trade_logs via ILP on port 9009.
# QuestDB MUST be running before this script is executed.
#
# The engine writes /tmp/matching_engine.pid on start and removes it on clean
# stop.  This script kills any stale instance before starting a new one so
# there is never more than one writer pushing data to QuestDB.

set -e
cd "$(dirname "$0")"

# ── 0. Kill any previously running matching engine instance ──────────────────
PID_FILE="/tmp/matching_engine.pid"
KILLED_OLD=0
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "=== Stopping previous matching engine (PID $OLD_PID) ==="
        kill -TERM "$OLD_PID" 2>/dev/null || true
        # Wait up to 3 s for graceful exit, then force-kill
        for i in 1 2 3; do
            sleep 1
            kill -0 "$OLD_PID" 2>/dev/null || break
        done
        kill -9 "$OLD_PID" 2>/dev/null || true
        echo "  Previous instance stopped."
        KILLED_OLD=1
    fi
    rm -f "$PID_FILE"
fi
# Kill any stale processes not tracked by PID file (only pay the 1-s penalty
# if we actually found and killed something above, otherwise skip the wait)
if pkill -9 -f "\./matching_engine" 2>/dev/null; then
    KILLED_OLD=1
fi
if [ "$KILLED_OLD" -eq 1 ]; then
    sleep 1   # Brief settle so OS releases the port before the new instance binds
fi
echo ""

# --- 1. Check QuestDB is reachable (HTTP REST on port 9000) ------------------
echo "=== Checking QuestDB connectivity ==="
QUESTDB_OK=0
for i in 1 2 3 4 5; do
    if curl -sf --max-time 2 "http://127.0.0.1:9000/exec?query=SELECT+1" > /dev/null 2>&1; then
        QUESTDB_OK=1
        break
    fi
    echo "  Attempt $i/5: QuestDB not ready yet, retrying in 2 s..."
    sleep 2
done

if [ "$QUESTDB_OK" -eq 0 ]; then
    echo ""
    echo "ERROR: Cannot reach QuestDB at http://127.0.0.1:9000"
    echo ""
    echo "Start QuestDB first, then re-run this script."
    echo "  e.g.:  java -jar ~/questdb/questdb.jar start"
    echo "         OR:  systemctl --user start questdb"
    exit 1
fi
echo "  QuestDB is reachable [OK]"
echo ""

# --- 2. Build (only when source or headers are newer than the binary) --------
NEEDS_BUILD=0
if [ ! -f matching_engine ]; then
    NEEDS_BUILD=1
    echo "=== Building matching engine (first build) ==="
elif [ main.cpp -nt matching_engine ] || \
     [ ../include/Order.hpp -nt matching_engine ] || \
     [ ../include/OrderBook.hpp -nt matching_engine ] || \
     [ ../include/Logger.hpp -nt matching_engine ] || \
     [ ../include/Instrument.hpp -nt matching_engine ] || \
     [ ../include/MarketDisplay.hpp -nt matching_engine ] || \
     [ ../include/PriceLevel.hpp -nt matching_engine ] || \
     [ ../include/Trade.hpp -nt matching_engine ]; then
    NEEDS_BUILD=1
    echo "=== Source changed — rebuilding matching engine ==="
fi

if [ "$NEEDS_BUILD" -eq 1 ]; then
    g++ -std=c++17 -I../include -pthread -O2 -o matching_engine main.cpp
    echo "=== Build successful ==="
else
    echo "=== Binary is up to date — skipping recompile ==="
fi
echo ""

# --- 3. Run ------------------------------------------------------------------
echo "Starting matching engine..."
echo "  Orders (NEW/PARTIAL/FILLED/CANCELLED/EXPIRED) -> QuestDB table: trade_logs"
echo "  Order expiry: 5 seconds after placement if unfilled"
echo "  PID file: $PID_FILE  (use 'kill \$(cat $PID_FILE)' to stop remotely)"
echo ""

# Shell-level trap: if THIS script receives INT/TERM/HUP first, forward it
# to the engine so g_shutdown is set and mock traders stop cleanly.
_cleanup() {
    ENGINE_PID=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$ENGINE_PID" ] && kill -0 "$ENGINE_PID" 2>/dev/null; then
        echo ""
        echo "=== Stopping matching engine (PID $ENGINE_PID) ==="
        kill -TERM "$ENGINE_PID" 2>/dev/null || true
        wait "$ENGINE_PID" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
    echo "[run.sh] Engine stopped. No more data will be sent to QuestDB."
}
trap '_cleanup' INT TERM HUP EXIT

./matching_engine
