from __future__ import annotations

from functools import lru_cache
from io import BytesIO, StringIO
from pathlib import Path
import pickle

import numpy as np
import pandas as pd


BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models"
FEATURES_PATH = MODELS_DIR / "feature_cols.pkl"
MODEL_CANDIDATE_PATHS = [
    MODELS_DIR / "manipulator_detector.pkl",
    MODELS_DIR / "manipulation_detector.pkl",
    MODELS_DIR / "layering_detector.pkl",
]


def resolve_model_path() -> Path:
    for model_path in MODEL_CANDIDATE_PATHS:
        if model_path.exists():
            return model_path
    expected = ", ".join(str(path) for path in MODEL_CANDIDATE_PATHS)
    raise FileNotFoundError(f"Missing model file. Expected one of: {expected}")


def to_numeric(series: pd.Series, default: float = 0.0) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").fillna(default)


def to_datetime_safe(series: pd.Series | None) -> pd.Series:
    if series is None:
        return pd.Series(dtype="datetime64[ns, UTC]")
    return pd.to_datetime(series, errors="coerce", utc=True)


def mode_or_unknown(series: pd.Series) -> str:
    values = series.dropna().astype(str)
    if values.empty:
        return "unknown"
    return values.mode().iloc[0]


def build_user_features(df: pd.DataFrame) -> pd.DataFrame:
    work = df.copy()

    if "user_id" not in work.columns:
        raise ValueError("The uploaded CSV must contain a user_id column.")

    numeric_columns = ["quantity", "filled_quantity", "remaining_quantity", "price"]
    for column in numeric_columns:
        if column not in work.columns:
            work[column] = 0
        work[column] = to_numeric(work[column], 0.0)

    object_columns = [
        "order_type",
        "side",
        "order_status_event",
        "trade_id",
        "instrument_id",
        "buyer_user_id",
        "seller_user_id",
        "trader_type",
    ]
    for column in object_columns:
        if column not in work.columns:
            work[column] = np.nan

    work["order_submit_dt"] = to_datetime_safe(work.get("order_submit_timestamp"))
    work["order_cancel_dt"] = to_datetime_safe(work.get("order_cancel_timestamp"))
    work["match_engine_dt"] = to_datetime_safe(work.get("match_engine_timestamp"))

    status = work["order_status_event"].astype(str).str.lower()
    order_type = work["order_type"].astype(str).str.lower()
    side = work["side"].astype(str).str.lower()

    work["is_cancel"] = status.str.contains("cancel", na=False)
    work["is_limit"] = order_type.eq("limit")
    work["is_market"] = order_type.eq("market")
    work["is_buy"] = side.eq("buy")
    work["is_sell"] = side.eq("sell")
    work["has_trade"] = work["trade_id"].notna()

    quantity = work["quantity"].replace(0, np.nan)
    work["fill_ratio"] = (
        (work["filled_quantity"] / quantity)
        .replace([np.inf, -np.inf], np.nan)
        .fillna(0.0)
        .clip(0, 1)
    )

    work["time_to_cancel"] = (work["order_cancel_dt"] - work["order_submit_dt"]).dt.total_seconds()
    work["time_to_cancel"] = work["time_to_cancel"].replace([np.inf, -np.inf], np.nan)

    work["engine_latency"] = (work["match_engine_dt"] - work["order_submit_dt"]).dt.total_seconds()
    work["engine_latency"] = work["engine_latency"].replace([np.inf, -np.inf], np.nan)

    instrument_median_price = work.groupby("instrument_id", dropna=False)["price"].transform("median")
    denominator = instrument_median_price.replace(0, np.nan)
    work["price_deviation"] = (
        ((work["price"] - instrument_median_price).abs() / denominator)
        .replace([np.inf, -np.inf], np.nan)
        .fillna(0.0)
    )

    grouped = work.groupby("user_id", dropna=False)
    features = pd.DataFrame(index=grouped.size().index)
    features["cancel_rate"] = grouped["is_cancel"].mean()
    features["zero_fill_cancel_rate"] = grouped.apply(
        lambda group: ((group["is_cancel"]) & (group["filled_quantity"] <= 0)).mean(),
        include_groups=False,
    )
    features["cancel_to_order_ratio"] = grouped["is_cancel"].sum() / grouped.size()
    features["avg_fill_ratio"] = grouped["fill_ratio"].mean()
    features["min_fill_ratio"] = grouped["fill_ratio"].min()
    features["avg_time_to_cancel"] = grouped["time_to_cancel"].mean()
    features["min_time_to_cancel"] = grouped["time_to_cancel"].min()
    features["std_time_to_cancel"] = grouped["time_to_cancel"].std()
    features["limit_order_ratio"] = grouped["is_limit"].mean()
    features["market_order_ratio"] = grouped["is_market"].mean()

    self_trade_mask = (
        (work["buyer_user_id"].astype(str) == work["seller_user_id"].astype(str))
        & work["buyer_user_id"].notna()
    )
    features["self_trade_count"] = (
        work[self_trade_mask].groupby("user_id", dropna=False).size().reindex(features.index, fill_value=0)
    )

    features["both_sides_manip"] = grouped["side"].nunique(dropna=True).gt(1).astype(int)
    features["avg_engine_latency"] = grouped["engine_latency"].mean()
    features["max_engine_latency"] = grouped["engine_latency"].max()
    features["unique_sides"] = grouped["side"].nunique(dropna=True)
    features["unique_instruments"] = grouped["instrument_id"].nunique(dropna=True)

    buy_counts = grouped["is_buy"].sum()
    sell_counts = grouped["is_sell"].sum()
    total_side_counts = (buy_counts + sell_counts).replace(0, np.nan)
    features["order_book_imbalance"] = ((buy_counts - sell_counts).abs() / total_side_counts).fillna(0.0)

    def cancel_regularity(group: pd.DataFrame) -> float:
        timestamps = group.loc[group["is_cancel"], "order_cancel_dt"].dropna().sort_values()
        if timestamps.shape[0] < 3:
            return 0.0
        value = timestamps.diff().dt.total_seconds().std()
        if pd.isna(value):
            return 0.0
        return float(value)

    features["cancel_timing_regularity"] = grouped.apply(cancel_regularity, include_groups=False)
    features["avg_price_deviation"] = grouped["price_deviation"].mean()

    trades_per_user = grouped["has_trade"].sum()
    orders_per_user = grouped.size()
    features["quote_to_trade_ratio"] = (
        (orders_per_user / trades_per_user.replace(0, np.nan))
        .replace([np.inf, -np.inf], np.nan)
        .fillna(0.0)
    )

    features["latency_cancel_interaction"] = (
        features["avg_engine_latency"].fillna(0.0) * features["cancel_rate"].fillna(0.0)
    )

    def cancel_intensity(group: pd.DataFrame) -> float:
        start_time = group["order_submit_dt"].min()
        end_time = group["order_submit_dt"].max()
        if pd.isna(start_time) or pd.isna(end_time) or start_time == end_time:
            return float(group["is_cancel"].sum())
        span_seconds = max((end_time - start_time).total_seconds(), 1.0)
        return float(group["is_cancel"].sum()) / span_seconds

    features["cancel_intensity_ratio"] = grouped.apply(cancel_intensity, include_groups=False)
    features["fill_cancel_interaction"] = (
        features["avg_fill_ratio"].fillna(0.0) * features["cancel_rate"].fillna(0.0)
    )
    features["trader_type"] = grouped["trader_type"].apply(mode_or_unknown)

    features = features.replace([np.inf, -np.inf], np.nan).fillna(0.0)
    features["trader_type"] = grouped["trader_type"].apply(mode_or_unknown)

    return features.reset_index().rename(columns={"index": "user_id"})


@lru_cache(maxsize=1)
def load_artifacts() -> tuple[list[str], object]:
    if not FEATURES_PATH.exists():
        raise FileNotFoundError(f"Missing feature definitions at {FEATURES_PATH}")
    model_path = resolve_model_path()

    with FEATURES_PATH.open("rb") as file_handle:
        feature_columns = pickle.load(file_handle)

    with model_path.open("rb") as file_handle:
        model = pickle.load(file_handle)

    return feature_columns, model


def predict_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    feature_columns, model = load_artifacts()
    user_features = build_user_features(df)

    for column in feature_columns:
        if column not in user_features.columns:
            user_features[column] = 0.0

    model_input = user_features[feature_columns].copy()
    model_input = model_input.replace([np.inf, -np.inf], np.nan).fillna(0.0)
    user_features["predicted_trader_type"] = model.predict(model_input)

    if "trader_type" not in df.columns:
        user_features = user_features.drop(columns=["trader_type"], errors="ignore")

    return user_features


def read_csv_bytes(file_bytes: bytes, filename: str = "uploaded.csv") -> pd.DataFrame:
    try:
        return pd.read_csv(BytesIO(file_bytes))
    except UnicodeDecodeError:
        return pd.read_csv(StringIO(file_bytes.decode("latin-1")))
    except Exception as exc:
        raise ValueError(f"Unable to parse CSV file {filename}: {exc}") from exc


def predict_csv_bytes(file_bytes: bytes, filename: str = "uploaded.csv") -> pd.DataFrame:
    dataframe = read_csv_bytes(file_bytes, filename)
    return predict_dataframe(dataframe)