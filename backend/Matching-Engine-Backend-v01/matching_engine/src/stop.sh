#!/usr/bin/env bash
# stop.sh — Reliably stop the KTrade matching engine.
# Reads the PID written by run.sh / the engine itself, sends SIGTERM for a
# graceful shutdown (mock traders finish and disconnect from QuestDB), then
# SIGKILL if it doesn't exit within 8 seconds.
# After this script returns NO more data will be written to QuestDB.

PID_FILE="/tmp/matching_engine.pid"

echo "=== Stopping KTrade Matching Engine ==="

# 1. Try PID file first
if [ -f "$PID_FILE" ]; then
    ENGINE_PID=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$ENGINE_PID" ] && kill -0 "$ENGINE_PID" 2>/dev/null; then
        echo "  Found engine PID $ENGINE_PID (from $PID_FILE)"
        echo "  Sending SIGTERM for clean shutdown..."
        kill -TERM "$ENGINE_PID" 2>/dev/null || true

        WAITED=0
        while kill -0 "$ENGINE_PID" 2>/dev/null && [ $WAITED -lt 8 ]; do
            sleep 1
            WAITED=$(( WAITED + 1 ))
            echo "  Waiting... (${WAITED}s)"
        done

        if kill -0 "$ENGINE_PID" 2>/dev/null; then
            echo "  Engine still alive after 8 s — sending SIGKILL"
            kill -9 "$ENGINE_PID" 2>/dev/null || true
        else
            echo "  Engine exited cleanly after ${WAITED}s"
        fi
    else
        echo "  PID $ENGINE_PID from file is not running."
    fi
    rm -f "$PID_FILE"
else
    echo "  No PID file found at $PID_FILE"
fi

# 2. Belt-and-suspenders: kill any remaining matching_engine process by name
REMAINING=$(pgrep -f "\./matching_engine" 2>/dev/null || true)
if [ -n "$REMAINING" ]; then
    echo "  Killing stale matching_engine processes: $REMAINING"
    pkill -9 -f "\./matching_engine" 2>/dev/null || true
fi

echo ""
echo "=== Matching engine stopped. QuestDB will receive no more trade data. ==="
