from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
import os
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from predictor_service import (
    BASE_DIR,
    MODELS_DIR,
    predict_dataframe,
)


app = FastAPI(
    title="Trader Type Live Prediction API",
    description="Real-time trader-type prediction from QuestDB trade_logs.",
    version="1.0.0",
)

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


QUESTDB_EXEC_URL = os.getenv("QUESTDB_EXEC_URL", "http://127.0.0.1:9000/exec")
LIVE_REFRESH_SECONDS = max(1, int(os.getenv("LIVE_REFRESH_SECONDS", "2")))
LIVE_QUERY_LIMIT = max(100, int(os.getenv("LIVE_QUERY_LIMIT", "50000")))


class LivePredictionState:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._snapshot: dict[str, Any] = {
            "updated_at": None,
            "refresh_seconds": LIVE_REFRESH_SECONDS,
            "trade_log_rows": 0,
            "prediction_rows": 0,
            "manipulators_count": 0,
            "manipulator_user_ids": [],
            "predictions": [],
            "source": {
                "table": "trade_logs",
                "query_limit": LIVE_QUERY_LIMIT,
                "questdb_exec_url": QUESTDB_EXEC_URL,
            },
        }
        self._last_error: str | None = None

    async def set_snapshot(self, snapshot: dict[str, Any]) -> None:
        async with self._lock:
            self._snapshot = snapshot
            self._last_error = None

    async def set_error(self, error: str) -> None:
        async with self._lock:
            self._last_error = error

    async def get_snapshot(self) -> dict[str, Any]:
        async with self._lock:
            snapshot = dict(self._snapshot)
            snapshot["last_error"] = self._last_error
            return snapshot


def _questdb_query(query: str) -> pd.DataFrame:
    encoded = urlencode({"query": query})
    url = f"{QUESTDB_EXEC_URL}?{encoded}"
    with urlopen(url, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if "error" in payload:
        raise RuntimeError(str(payload["error"]))

    columns = [column["name"] for column in payload.get("columns", [])]
    dataset = payload.get("dataset", [])
    if not columns:
        return pd.DataFrame()
    return pd.DataFrame(dataset, columns=columns)


def _fetch_live_trade_logs(limit: int) -> pd.DataFrame:
    safe_limit = max(100, min(int(limit), 200000))
    query = f"""
        SELECT
            user_id,
            quantity,
            filled_quantity,
            remaining_quantity,
            price,
            order_type,
            side,
            order_status_event,
            trade_id,
            instrument_id,
            buyer_user_id,
            seller_user_id,
            order_submit_timestamp,
            order_cancel_timestamp,
            match_engine_timestamp,
            timestamp
        FROM trade_logs
        WHERE user_id IS NOT NULL
          AND user_id != 'NA'
          AND order_status_event != 'TRADE_MATCH'
        ORDER BY timestamp DESC
        LIMIT {safe_limit}
    """
    df = _questdb_query(query)
    if df.empty:
        return df
    return df.iloc[::-1].reset_index(drop=True)


def _build_live_snapshot(limit: int) -> dict[str, Any]:
    live_df = _fetch_live_trade_logs(limit)
    if live_df.empty:
        return {
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "refresh_seconds": LIVE_REFRESH_SECONDS,
            "trade_log_rows": 0,
            "prediction_rows": 0,
            "manipulators_count": 0,
            "manipulator_user_ids": [],
            "predictions": [],
            "source": {
                "table": "trade_logs",
                "query_limit": limit,
                "questdb_exec_url": QUESTDB_EXEC_URL,
            },
        }

    predictions = predict_dataframe(live_df)
    prediction_rows = predictions.to_dict(orient="records")
    manipulator_ids = [
        str(row.get("user_id"))
        for row in prediction_rows
        if str(row.get("predicted_trader_type")) == "1" and row.get("user_id") is not None
    ]

    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "refresh_seconds": LIVE_REFRESH_SECONDS,
        "trade_log_rows": int(len(live_df)),
        "prediction_rows": int(len(prediction_rows)),
        "manipulators_count": int(len(manipulator_ids)),
        "manipulator_user_ids": manipulator_ids,
        "predictions": prediction_rows,
        "source": {
            "table": "trade_logs",
            "query_limit": limit,
            "questdb_exec_url": QUESTDB_EXEC_URL,
        },
    }


async def _live_prediction_loop(state: LivePredictionState) -> None:
    while True:
        try:
            snapshot = _build_live_snapshot(LIVE_QUERY_LIMIT)
            await state.set_snapshot(snapshot)
        except Exception as exc:
            await state.set_error(str(exc))
        await asyncio.sleep(LIVE_REFRESH_SECONDS)


@app.get("/")
def service_info() -> dict[str, Any]:
    return {
        "service": "Trader Type Live Prediction API",
        "mode": "streaming-only",
        "source": "QuestDB trade_logs",
        "endpoints": ["/health", "/predict/live", "/predict/live/stream"],
    }


@app.get("/health")
async def health_check() -> dict[str, Any]:
    state: LivePredictionState = app.state.live_prediction_state
    snapshot = await state.get_snapshot()
    return {
        "status": "ok",
        "base_dir": str(BASE_DIR),
        "models_dir": str(MODELS_DIR),
        "questdb_exec_url": QUESTDB_EXEC_URL,
        "live_refresh_seconds": LIVE_REFRESH_SECONDS,
        "live_updated_at": snapshot.get("updated_at"),
        "live_last_error": snapshot.get("last_error"),
    }


@app.on_event("startup")
async def startup_event() -> None:
    app.state.live_prediction_state = LivePredictionState()
    app.state.live_prediction_task = asyncio.create_task(
        _live_prediction_loop(app.state.live_prediction_state)
    )


@app.on_event("shutdown")
async def shutdown_event() -> None:
    task: asyncio.Task | None = getattr(app.state, "live_prediction_task", None)
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


@app.get("/predict/live")
async def predict_live(limit: int = Query(LIVE_QUERY_LIMIT, ge=100, le=200000)):
    state: LivePredictionState = app.state.live_prediction_state
    if limit != LIVE_QUERY_LIMIT:
        try:
            snapshot = _build_live_snapshot(limit)
            return JSONResponse(snapshot)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Live prediction failed: {exc}") from exc

    return JSONResponse(await state.get_snapshot())


@app.get("/predict/live/stream")
async def predict_live_stream():
    state: LivePredictionState = app.state.live_prediction_state

    async def event_generator():
        while True:
            snapshot = await state.get_snapshot()
            yield f"data: {json.dumps(snapshot)}\n\n"
            await asyncio.sleep(LIVE_REFRESH_SECONDS)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
