#!/usr/bin/env bash
# test.sh — Verifies QuestDB storage and expiry logic WITHOUT the TUI black screen.
# Runs the matching engine silently in background, waits, then queries QuestDB.

set -e
cd "$(dirname "$0")"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
info() { echo -e "${CYAN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Cleanup trap — always kill engine if test script is interrupted or fails
_cleanup_engine() {
    if [ -n "${ENGINE_PID:-}" ] && kill -0 "$ENGINE_PID" 2>/dev/null; then
        warn "Cleaning up: killing engine PID $ENGINE_PID"
        kill -9 "$ENGINE_PID" 2>/dev/null || true
    fi
    rm -f /tmp/matching_engine.pid 2>/dev/null || true
}
trap '_cleanup_engine' INT TERM EXIT

QUESTDB="http://127.0.0.1:9000/exec"
query() { curl -sf --max-time 5 "${QUESTDB}?query=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$1")"; }
count() { query "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['dataset'][0][0] if d.get('dataset') else 0)" 2>/dev/null || echo 0; }

echo ""
echo "======================================================"
echo "  KTrade Matching Engine — Integration Test"
echo "======================================================"
echo ""

# ── 1. Check QuestDB ─────────────────────────────────────────────────────────
info "Checking QuestDB..."
if ! curl -sf --max-time 3 "${QUESTDB}?query=SELECT+1" > /dev/null; then
    fail "QuestDB is NOT running at localhost:9000"
    echo "      Start QuestDB first, then re-run test.sh"
    exit 1
fi
pass "QuestDB is reachable"

# ── 2. Snapshot row counts BEFORE ────────────────────────────────────────────
info "Snapshot: counting existing rows in trade_logs..."
BEFORE_TOTAL=$(count "SELECT count() FROM trade_logs")
BEFORE_EXPIRED=$(count "SELECT count() FROM trade_logs WHERE status = 'EXPIRED'")
BEFORE_FILLED=$(count "SELECT count() FROM trade_logs WHERE status = 'FILLED'")
BEFORE_PARTIAL=$(count "SELECT count() FROM trade_logs WHERE status = 'PARTIAL'")
echo "         Before: total=$BEFORE_TOTAL  FILLED=$BEFORE_FILLED  PARTIAL=$BEFORE_PARTIAL  EXPIRED=$BEFORE_EXPIRED"
echo ""

# ── 3. Build ──────────────────────────────────────────────────────────────────
info "Building matching engine..."
g++ -std=c++17 -I../include -pthread -O2 -o matching_engine main.cpp 2>&1
pass "Build succeeded"
echo ""

# ── 4. Run engine silently in background ─────────────────────────────────────
info "Starting matching engine in background (TUI suppressed)..."
# Redirect ALL output (TUI screen redraws) to /dev/null so terminal stays clean
./matching_engine > /dev/null 2>&1 &
ENGINE_PID=$!
echo "         Engine PID: $ENGINE_PID"
echo ""

# ── 5. Wait for orders to accumulate and expire ───────────────────────────────
WAIT_SECS=15   # 5 s for orders to be placed + 5 s expiry window + 5 s buffer
info "Waiting ${WAIT_SECS}s for orders to be placed and expire (expiry = 5 s)..."
for i in $(seq 1 $WAIT_SECS); do
    sleep 1
    RUNNING_TOTAL=$(count "SELECT count() FROM trade_logs")
    NEW_ROWS=$(( RUNNING_TOTAL - BEFORE_TOTAL ))
    printf "\r         Elapsed: %2ds | New rows in trade_logs: %d    " "$i" "$NEW_ROWS"
done
echo ""
echo ""

# ── 6. Stop engine ────────────────────────────────────────────────────────────
info "Stopping engine (PID $ENGINE_PID) — sending SIGTERM, waiting for clean shutdown..."
kill -TERM "$ENGINE_PID" 2>/dev/null || true
# Wait up to 8 s for the process to exit cleanly (mock trader threads joining)
STOP_WAITED=0
while kill -0 "$ENGINE_PID" 2>/dev/null && [ $STOP_WAITED -lt 8 ]; do
    sleep 1
    STOP_WAITED=$(( STOP_WAITED + 1 ))
done
# Force-kill if still running
if kill -0 "$ENGINE_PID" 2>/dev/null; then
    warn "Engine did not exit after 8 s — sending SIGKILL"
    kill -9 "$ENGINE_PID" 2>/dev/null || true
    sleep 1
fi
# Also clean up any stale PID file written by the engine
rm -f /tmp/matching_engine.pid 2>/dev/null || true
pass "Engine stopped (waited ${STOP_WAITED}s for clean shutdown)"
echo ""

# ── 7. Query results AFTER ───────────────────────────────────────────────────
info "Querying trade_logs after run..."
AFTER_TOTAL=$(count "SELECT count() FROM trade_logs")
AFTER_NEW=$(count "SELECT count() FROM trade_logs WHERE status = 'NEW'")
AFTER_FILLED=$(count "SELECT count() FROM trade_logs WHERE status = 'FILLED' OR status = 'PARTIAL'")
AFTER_EXPIRED=$(count "SELECT count() FROM trade_logs WHERE status = 'EXPIRED'")
AFTER_CANCELLED=$(count "SELECT count() FROM trade_logs WHERE status = 'CANCELLED'")

DELTA_TOTAL=$(( AFTER_TOTAL - BEFORE_TOTAL ))
DELTA_EXPIRED=$(( AFTER_EXPIRED - BEFORE_EXPIRED ))
DELTA_FILLED_PARTIAL=$(( AFTER_FILLED - BEFORE_FILLED - BEFORE_PARTIAL ))

echo ""
echo "======================================================"
echo "  TEST RESULTS"
echo "======================================================"
printf "  %-30s  %s\n" "New rows written:"            "$DELTA_TOTAL"
printf "  %-30s  %s\n" "  NEW (pending):"             "$AFTER_NEW"
printf "  %-30s  %s\n" "  FILLED / PARTIAL:"          "$AFTER_FILLED"
printf "  %-30s  %s\n" "  EXPIRED (expiry logic):"    "$AFTER_EXPIRED"
printf "  %-30s  %s\n" "  CANCELLED:"                 "$AFTER_CANCELLED"
echo "------------------------------------------------------"

# ── 8. Pass / Fail checks ────────────────────────────────────────────────────
echo ""
echo "  Checks:"
# Check 1: data is reaching QuestDB
if [ "$DELTA_TOTAL" -gt 0 ]; then
    pass "Orders are being stored in QuestDB ($DELTA_TOTAL new rows)"
else
    fail "NO new rows written to QuestDB — Logger is not connecting to port 9009"
fi

# Check 2: expiry logic working
if [ "$AFTER_EXPIRED" -gt 0 ]; then
    pass "Expiry logic is working ($AFTER_EXPIRED EXPIRED rows in trade_logs)"
else
    fail "No EXPIRED rows found — expiry thread may not be running"
fi

# Check 3: resting orders are being logged (FILLED/PARTIAL rows expected)
if [ "$AFTER_FILLED" -gt 0 ]; then
    pass "Resting order fills are being logged (FILLED/PARTIAL rows present)"
else
    warn "No FILLED/PARTIAL rows yet — may need more time or price overlap"
fi

echo ""
echo "======================================================"

# ── 9. Show 5 most recent rows ───────────────────────────────────────────────
info "5 most recent trade_logs rows:"
query "SELECT order_id, side, status, price, quantity, timestamp FROM trade_logs ORDER BY timestamp DESC LIMIT 5" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
cols = [c['name'] for c in d['columns']]
print('  ' + '  |  '.join(f'{c:<12}' for c in cols))
print('  ' + '-'*80)
for row in d.get('dataset', []):
    print('  ' + '  |  '.join(f'{str(v):<12}' for v in row))
" 2>/dev/null || warn "Could not fetch recent rows"

echo ""
