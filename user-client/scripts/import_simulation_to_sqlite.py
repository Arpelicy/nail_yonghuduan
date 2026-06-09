import json
import sqlite3
import uuid
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SIM_DIR = ROOT / "outputs" / "simulation"
DB_PATH = ROOT / "db" / "nail_simulation.sqlite"
REPORT_PATH = ROOT / "db" / "simulation-db-summary.json"
STORE_ID = "demo_store"
STORE_NAME = "指尖艺术美甲店"
START_DATE = pd.Timestamp("2026-01-01")
RNG_SEED = 20260528
USER_COUNT = 8000
EVENT_SAMPLE_RATE = 0.02
EVENT_SCALE_FACTOR = int(round(1 / EVENT_SAMPLE_RATE))
DETAIL_EVENT_DAYS = 30


def safe_div(a, b):
    return a / b if b else 0


def load_csv(name):
    path = SIM_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"Missing simulation file: {path}")
    return pd.read_csv(path)


def prepare_styles(styles):
    rows = styles.copy()
    rows["store_id"] = STORE_ID
    rows["name"] = rows["style_name"]
    rows["source_type"] = "simulation"
    rows["status"] = "active"
    rows["style_tag"] = rows["true_state"].apply(lambda value: json.dumps([value], ensure_ascii=False))
    rows["launch_date"] = START_DATE.date().isoformat()
    rows["base_price"] = rows["price_level"].map({"low": 98, "mid": 168, "high": 298}).fillna(168)
    return rows[
        [
            "style_id",
            "store_id",
            "name",
            "source_type",
            "category",
            "price_level",
            "true_state",
            "base_popularity",
            "style_tag",
            "base_price",
            "status",
            "launch_date",
        ]
    ]


def prepare_daily(daily):
    rows = daily.copy()
    rows["store_id"] = STORE_ID
    rows["metric_date"] = rows["date"]
    rows["confirm_uv"] = rows["total_confirm_uv"]
    rows["detail_rate"] = rows.apply(lambda row: safe_div(row.detail_uv, row.view_uv), axis=1)
    rows["tryon_rate"] = rows.apply(lambda row: safe_div(row.tryon_uv, row.view_uv), axis=1)
    rows["want_rate"] = rows.apply(lambda row: safe_div(row.want_uv, row.view_uv), axis=1)
    rows["direct_confirm_rate"] = rows.apply(lambda row: safe_div(row.confirm_direct_uv, row.view_uv), axis=1)
    rows["detail_confirm_rate"] = rows.apply(lambda row: safe_div(row.confirm_detail_uv, row.detail_uv), axis=1)
    rows["tryon_want_rate"] = rows.apply(lambda row: safe_div(row.want_after_tryon_uv, row.tryon_result_uv), axis=1)
    rows["tryon_confirm_rate"] = rows.apply(lambda row: safe_div(row.confirm_after_tryon_uv, row.tryon_result_uv), axis=1)
    rows["want_to_confirm_rate"] = rows.apply(lambda row: safe_div(row.confirm_from_want_uv, row.want_uv), axis=1)
    rows["total_confirm_rate"] = rows.apply(lambda row: safe_div(row.total_confirm_uv, row.view_uv), axis=1)
    return rows[
        [
            "store_id",
            "style_id",
            "metric_date",
            "category",
            "price_level",
            "view_uv",
            "detail_uv",
            "tryon_uv",
            "tryon_result_uv",
            "want_uv",
            "want_after_tryon_uv",
            "confirm_uv",
            "confirm_direct_uv",
            "confirm_detail_uv",
            "confirm_after_tryon_uv",
            "confirm_from_want_uv",
            "detail_rate",
            "tryon_rate",
            "want_rate",
            "direct_confirm_rate",
            "detail_confirm_rate",
            "tryon_want_rate",
            "tryon_confirm_rate",
            "want_to_confirm_rate",
            "total_confirm_rate",
        ]
    ]


def prepare_weekly(weekly):
    rows = weekly.copy()
    rows["store_id"] = STORE_ID
    rows["window_start"] = rows["week_idx"].apply(lambda value: (START_DATE + pd.Timedelta(days=int(value) * 7)).date().isoformat())
    rows["window_end"] = rows["week_idx"].apply(lambda value: (START_DATE + pd.Timedelta(days=int(value) * 7 + 6)).date().isoformat())
    rows["window_size"] = 7
    rows["confirm_7d"] = rows["total_confirm_uv"]
    rows["sample_status"] = rows["view_uv"].apply(lambda value: "sufficient" if value >= 100 else "insufficient")
    rows["trend_label"] = rows["label"]
    rows["cold_type"] = rows["label"].where(rows["label"].str.startswith("Cold"), "")
    rows["suggestion"] = rows["trend_label"].apply(build_suggestion)
    rows["reason"] = rows.apply(build_reason, axis=1)
    return rows[
        [
            "store_id",
            "style_id",
            "window_start",
            "window_end",
            "window_size",
            "category",
            "price_level",
            "week_idx",
            "view_uv",
            "detail_uv",
            "tryon_uv",
            "tryon_result_uv",
            "want_uv",
            "confirm_7d",
            "confirm_after_tryon_uv",
            "confirm_from_want_uv",
            "detail_rate",
            "tryon_rate",
            "want_rate",
            "direct_confirm_rate",
            "tryon_confirm_rate",
            "want_to_confirm_rate",
            "total_confirm_rate",
            "view_uv_growth",
            "detail_uv_growth",
            "tryon_uv_growth",
            "want_uv_growth",
            "total_confirm_uv_growth",
            "confirm_after_tryon_uv_growth",
            "detail_rate_pct",
            "tryon_rate_pct",
            "want_rate_pct",
            "direct_confirm_rate_pct",
            "detail_confirm_rate_pct",
            "tryon_confirm_rate_pct",
            "want_to_confirm_rate_pct",
            "total_confirm_rate_pct",
            "hot_score",
            "cold_risk_score",
            "growth_score",
            "sample_status",
            "trend_label",
            "cold_type",
            "suggestion",
            "reason",
            "true_state",
            "label_3class",
            "true_group",
            "next_label",
            "next_label_3class",
            "next_true_group",
        ]
    ]


def make_id(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def create_users():
    rng = np.random.default_rng(RNG_SEED)
    first_seen_offsets = rng.integers(0, 90, size=USER_COUNT)
    users = []
    for index in range(USER_COUNT):
        user_id = f"sim_user_{index + 1:05d}"
        first_seen = START_DATE + pd.Timedelta(days=int(first_seen_offsets[index]))
        users.append(
            {
                "user_id": user_id,
                "store_id": STORE_ID,
                "display_name": f"模拟用户{index + 1:05d}",
                "is_anonymous": 1,
                "device_id": f"sim_device_{index + 1:05d}",
                "first_seen_at": first_seen.isoformat(),
                "last_seen_at": (START_DATE + pd.Timedelta(days=119)).isoformat(),
            }
        )
    return pd.DataFrame(users)


def sampled_count(count):
    if count <= 0:
        return 0
    estimate = int(round(count * EVENT_SAMPLE_RATE))
    if estimate > 0:
        return estimate
    return 1 if count >= 50 else 0


def make_events_and_actions(daily, users):
    rng = np.random.default_rng(RNG_SEED)
    daily = daily.copy()
    latest_date = pd.to_datetime(daily["date"]).max()
    cutoff_date = latest_date - pd.Timedelta(days=DETAIL_EVENT_DAYS - 1)
    daily = daily[pd.to_datetime(daily["date"]) >= cutoff_date]
    user_ids = users["user_id"].to_numpy()
    device_by_user = dict(zip(users["user_id"], users["device_id"]))
    events = []
    try_on_jobs = []
    intents = []
    orders = []
    session_keys = {}

    def pick_users(count):
        if count <= 0:
            return []
        replace = count > len(user_ids)
        return rng.choice(user_ids, size=count, replace=replace).tolist()

    def session_for(user_id, date_value):
        key = (user_id, date_value)
        if key not in session_keys:
            session_keys[key] = f"sess_{uuid.uuid4().hex[:14]}"
        return session_keys[key]

    def add_event(date_value, style_id, event_type, user_id, **extra):
        event_time = pd.Timestamp(date_value) + pd.Timedelta(
            hours=int(rng.integers(10, 22)),
            minutes=int(rng.integers(0, 60)),
            seconds=int(rng.integers(0, 60)),
        )
        events.append(
            {
                "event_id": make_id("evt"),
                "store_id": STORE_ID,
                "user_id": user_id,
                "session_id": session_for(user_id, date_value),
                "style_id": style_id,
                "event_type": event_type,
                "event_time": event_time.isoformat(),
                "page_source": extra.pop("page_source", "catalog"),
                "position_index": int(rng.integers(1, 13)),
                "want_source": extra.pop("want_source", None),
                "confirm_source": extra.pop("confirm_source", None),
                "tryon_source": extra.pop("tryon_source", None),
                "generate_status": extra.pop("generate_status", None),
                "visible_ratio": extra.pop("visible_ratio", None),
                "visible_duration_ms": extra.pop("visible_duration_ms", None),
                "result_visible_duration_ms": extra.pop("result_visible_duration_ms", None),
                "is_valid_impression": int(extra.pop("is_valid_impression", False)),
                "is_valid_view": int(extra.pop("is_valid_view", False)),
                "action_result": extra.pop("action_result", "success"),
                "scale_factor": EVENT_SCALE_FACTOR,
                "properties": json.dumps(extra, ensure_ascii=False),
            }
        )
        return events[-1]

    for row in daily.itertuples(index=False):
        date_value = str(row.date)
        style_id = row.style_id

        for user_id in pick_users(sampled_count(row.view_uv)):
            add_event(
                date_value,
                style_id,
                "style_view",
                user_id,
                visible_ratio=round(float(rng.uniform(0.7, 1.0)), 4),
                visible_duration_ms=int(rng.integers(2000, 9000)),
                is_valid_view=True,
            )

        for user_id in pick_users(sampled_count(row.detail_uv)):
            add_event(date_value, style_id, "detail_view", user_id, page_source="catalog")

        for user_id in pick_users(sampled_count(row.tryon_uv)):
            event = add_event(date_value, style_id, "tryon_click", user_id, tryon_source="card")
            job_id = make_id("tryon")
            try_on_jobs.append(
                {
                    "try_on_id": job_id,
                    "store_id": STORE_ID,
                    "user_id": user_id,
                    "style_id": style_id,
                    "try_on_type": "normal",
                    "model_version": "simulation-v1",
                    "status": "success",
                    "duration_ms": int(rng.integers(1800, 9000)),
                    "started_at": event["event_time"],
                    "finished_at": (pd.Timestamp(event["event_time"]) + pd.Timedelta(seconds=int(rng.integers(2, 12)))).isoformat(),
                    "scale_factor": EVENT_SCALE_FACTOR,
                }
            )

        for user_id in pick_users(sampled_count(row.tryon_result_uv)):
            add_event(
                date_value,
                style_id,
                "tryon_result_view",
                user_id,
                page_source="tryon_result",
                generate_status="success",
                result_visible_duration_ms=int(rng.integers(1500, 12000)),
            )

        after_tryon_want = sampled_count(row.want_after_tryon_uv)
        base_want = max(0, sampled_count(row.want_uv) - after_tryon_want)
        for user_id in pick_users(base_want):
            source = "detail" if rng.random() < 0.35 else "card"
            event = add_event(date_value, style_id, "want_click", user_id, want_source=source, page_source=source)
            intents.append(
                {
                    "intent_id": make_id("intent"),
                    "store_id": STORE_ID,
                    "user_id": user_id,
                    "style_id": style_id,
                    "intent_source": source,
                    "created_at": event["event_time"],
                    "scale_factor": EVENT_SCALE_FACTOR,
                }
            )

        for user_id in pick_users(after_tryon_want):
            event = add_event(date_value, style_id, "want_click", user_id, want_source="tryon_result", page_source="tryon_result")
            intents.append(
                {
                    "intent_id": make_id("intent"),
                    "store_id": STORE_ID,
                    "user_id": user_id,
                    "style_id": style_id,
                    "intent_source": "tryon_result",
                    "created_at": event["event_time"],
                    "scale_factor": EVENT_SCALE_FACTOR,
                }
            )

        confirm_specs = [
            ("card", row.confirm_direct_uv),
            ("detail", row.confirm_detail_uv),
            ("tryon_result", row.confirm_after_tryon_uv),
            ("want_list", row.confirm_from_want_uv),
        ]
        for source, count in confirm_specs:
            for user_id in pick_users(sampled_count(count)):
                event = add_event(date_value, style_id, "confirm_click", user_id, confirm_source=source, page_source=source)
                orders.append(
                    {
                        "order_id": make_id("order"),
                        "store_id": STORE_ID,
                        "user_id": user_id,
                        "style_id": style_id,
                        "confirm_source": source,
                        "amount": float(rng.choice([98, 128, 168, 198, 268, 298])),
                        "status": "confirmed",
                        "ordered_at": event["event_time"],
                        "scale_factor": EVENT_SCALE_FACTOR,
                    }
                )

    sessions = []
    for (user_id, date_value), session_id in session_keys.items():
        started_at = pd.Timestamp(date_value) + pd.Timedelta(hours=10 + int(hash(user_id) % 8))
        sessions.append(
            {
                "session_id": session_id,
                "store_id": STORE_ID,
                "user_id": user_id,
                "device_id": device_by_user[user_id],
                "started_at": started_at.isoformat(),
                "ended_at": (started_at + pd.Timedelta(minutes=8 + int(hash(session_id) % 25))).isoformat(),
            }
        )

    return (
        pd.DataFrame(events),
        pd.DataFrame(try_on_jobs),
        pd.DataFrame(intents),
        pd.DataFrame(orders),
        pd.DataFrame(sessions),
    )


def build_suggestion(label):
    if label == "HotUp":
        return "保持首页主推，观察近 7 日增长是否继续。"
    if label == "Potential":
        return "低曝光高转化，建议补曝光验证。"
    if label == "Untested":
        return "样本不足，先增加曝光再判断。"
    if str(label).startswith("Cold"):
        return "进入冷门预警，按断点检查封面、详情、试戴或想要转确认。"
    return "维持正常推荐，持续观察。"


def build_reason(row):
    return (
        f"view_7d={int(row.view_uv)}, tryon_7d={int(row.tryon_uv)}, "
        f"confirm_7d={int(row.total_confirm_uv)}, hot_score={row.hot_score:.3f}, "
        f"cold_risk_score={row.cold_risk_score:.3f}, growth_score={row.growth_score:.3f}"
    )


def create_schema(conn):
    conn.executescript(
        """
        PRAGMA foreign_keys = ON;

        DROP TABLE IF EXISTS stores;
        DROP TABLE IF EXISTS users;
        DROP TABLE IF EXISTS user_sessions;
        DROP TABLE IF EXISTS user_style_events;
        DROP TABLE IF EXISTS try_on_jobs;
        DROP TABLE IF EXISTS style_intents;
        DROP TABLE IF EXISTS orders;
        DROP TABLE IF EXISTS nail_styles;
        DROP TABLE IF EXISTS style_daily_metrics;
        DROP TABLE IF EXISTS style_window_metrics;

        CREATE TABLE stores (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE nail_styles (
          style_id TEXT PRIMARY KEY,
          store_id TEXT NOT NULL,
          name TEXT NOT NULL,
          source_type TEXT NOT NULL,
          category TEXT NOT NULL,
          price_level TEXT NOT NULL,
          true_state TEXT NOT NULL,
          base_popularity REAL,
          style_tag TEXT NOT NULL,
          base_price REAL,
          status TEXT NOT NULL,
          launch_date TEXT NOT NULL,
          FOREIGN KEY (store_id) REFERENCES stores(id)
        );

        CREATE TABLE users (
          user_id TEXT PRIMARY KEY,
          store_id TEXT NOT NULL,
          display_name TEXT,
          is_anonymous INTEGER NOT NULL,
          device_id TEXT,
          first_seen_at TEXT,
          last_seen_at TEXT,
          FOREIGN KEY (store_id) REFERENCES stores(id)
        );

        CREATE TABLE user_sessions (
          session_id TEXT PRIMARY KEY,
          store_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          device_id TEXT,
          started_at TEXT,
          ended_at TEXT,
          FOREIGN KEY (store_id) REFERENCES stores(id),
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        );

        CREATE TABLE user_style_events (
          event_id TEXT PRIMARY KEY,
          store_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          style_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          event_time TEXT NOT NULL,
          page_source TEXT,
          position_index INTEGER,
          want_source TEXT,
          confirm_source TEXT,
          tryon_source TEXT,
          generate_status TEXT,
          visible_ratio REAL,
          visible_duration_ms INTEGER,
          result_visible_duration_ms INTEGER,
          is_valid_impression INTEGER NOT NULL DEFAULT 0,
          is_valid_view INTEGER NOT NULL DEFAULT 0,
          action_result TEXT,
          scale_factor INTEGER NOT NULL DEFAULT 1,
          properties TEXT NOT NULL DEFAULT '{}',
          FOREIGN KEY (store_id) REFERENCES stores(id),
          FOREIGN KEY (user_id) REFERENCES users(user_id),
          FOREIGN KEY (session_id) REFERENCES user_sessions(session_id),
          FOREIGN KEY (style_id) REFERENCES nail_styles(style_id)
        );

        CREATE TABLE try_on_jobs (
          try_on_id TEXT PRIMARY KEY,
          store_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          style_id TEXT NOT NULL,
          try_on_type TEXT NOT NULL,
          model_version TEXT,
          status TEXT NOT NULL,
          duration_ms INTEGER,
          started_at TEXT,
          finished_at TEXT,
          scale_factor INTEGER NOT NULL DEFAULT 1,
          FOREIGN KEY (store_id) REFERENCES stores(id),
          FOREIGN KEY (user_id) REFERENCES users(user_id),
          FOREIGN KEY (style_id) REFERENCES nail_styles(style_id)
        );

        CREATE TABLE style_intents (
          intent_id TEXT PRIMARY KEY,
          store_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          style_id TEXT NOT NULL,
          intent_source TEXT NOT NULL,
          created_at TEXT,
          scale_factor INTEGER NOT NULL DEFAULT 1,
          FOREIGN KEY (store_id) REFERENCES stores(id),
          FOREIGN KEY (user_id) REFERENCES users(user_id),
          FOREIGN KEY (style_id) REFERENCES nail_styles(style_id)
        );

        CREATE TABLE orders (
          order_id TEXT PRIMARY KEY,
          store_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          style_id TEXT NOT NULL,
          confirm_source TEXT NOT NULL,
          amount REAL,
          status TEXT NOT NULL,
          ordered_at TEXT,
          scale_factor INTEGER NOT NULL DEFAULT 1,
          FOREIGN KEY (store_id) REFERENCES stores(id),
          FOREIGN KEY (user_id) REFERENCES users(user_id),
          FOREIGN KEY (style_id) REFERENCES nail_styles(style_id)
        );

        CREATE TABLE style_daily_metrics (
          store_id TEXT NOT NULL,
          style_id TEXT NOT NULL,
          metric_date TEXT NOT NULL,
          category TEXT NOT NULL,
          price_level TEXT NOT NULL,
          view_uv INTEGER NOT NULL,
          detail_uv INTEGER NOT NULL,
          tryon_uv INTEGER NOT NULL,
          tryon_result_uv INTEGER NOT NULL,
          want_uv INTEGER NOT NULL,
          want_after_tryon_uv INTEGER NOT NULL,
          confirm_uv INTEGER NOT NULL,
          confirm_direct_uv INTEGER NOT NULL,
          confirm_detail_uv INTEGER NOT NULL,
          confirm_after_tryon_uv INTEGER NOT NULL,
          confirm_from_want_uv INTEGER NOT NULL,
          detail_rate REAL,
          tryon_rate REAL,
          want_rate REAL,
          direct_confirm_rate REAL,
          detail_confirm_rate REAL,
          tryon_want_rate REAL,
          tryon_confirm_rate REAL,
          want_to_confirm_rate REAL,
          total_confirm_rate REAL,
          PRIMARY KEY (store_id, style_id, metric_date),
          FOREIGN KEY (store_id) REFERENCES stores(id),
          FOREIGN KEY (style_id) REFERENCES nail_styles(style_id)
        );

        CREATE TABLE style_window_metrics (
          store_id TEXT NOT NULL,
          style_id TEXT NOT NULL,
          window_start TEXT NOT NULL,
          window_end TEXT NOT NULL,
          window_size INTEGER NOT NULL,
          category TEXT NOT NULL,
          price_level TEXT NOT NULL,
          week_idx INTEGER NOT NULL,
          view_uv INTEGER NOT NULL,
          detail_uv INTEGER NOT NULL,
          tryon_uv INTEGER NOT NULL,
          tryon_result_uv INTEGER NOT NULL,
          want_uv INTEGER NOT NULL,
          confirm_7d INTEGER NOT NULL,
          confirm_after_tryon_uv INTEGER NOT NULL,
          confirm_from_want_uv INTEGER NOT NULL,
          detail_rate REAL,
          tryon_rate REAL,
          want_rate REAL,
          direct_confirm_rate REAL,
          tryon_confirm_rate REAL,
          want_to_confirm_rate REAL,
          total_confirm_rate REAL,
          view_uv_growth REAL,
          detail_uv_growth REAL,
          tryon_uv_growth REAL,
          want_uv_growth REAL,
          total_confirm_uv_growth REAL,
          confirm_after_tryon_uv_growth REAL,
          detail_rate_pct REAL,
          tryon_rate_pct REAL,
          want_rate_pct REAL,
          direct_confirm_rate_pct REAL,
          detail_confirm_rate_pct REAL,
          tryon_confirm_rate_pct REAL,
          want_to_confirm_rate_pct REAL,
          total_confirm_rate_pct REAL,
          hot_score REAL,
          cold_risk_score REAL,
          growth_score REAL,
          sample_status TEXT NOT NULL,
          trend_label TEXT NOT NULL,
          cold_type TEXT,
          suggestion TEXT,
          reason TEXT,
          true_state TEXT,
          label_3class TEXT,
          true_group TEXT,
          next_label TEXT,
          next_label_3class TEXT,
          next_true_group TEXT,
          PRIMARY KEY (store_id, style_id, window_start, window_end),
          FOREIGN KEY (store_id) REFERENCES stores(id),
          FOREIGN KEY (style_id) REFERENCES nail_styles(style_id)
        );

        CREATE INDEX idx_daily_date ON style_daily_metrics(store_id, metric_date);
        CREATE INDEX idx_daily_style_date ON style_daily_metrics(store_id, style_id, metric_date);
        CREATE INDEX idx_window_label ON style_window_metrics(store_id, trend_label, window_end);
        CREATE INDEX idx_window_hot ON style_window_metrics(store_id, category, price_level, hot_score DESC);
        CREATE INDEX idx_window_cold ON style_window_metrics(store_id, category, price_level, cold_risk_score DESC);
        CREATE INDEX idx_events_type_time ON user_style_events(store_id, event_type, event_time);
        CREATE INDEX idx_events_style_time ON user_style_events(store_id, style_id, event_time);
        CREATE INDEX idx_events_user_time ON user_style_events(store_id, user_id, event_time);
        CREATE INDEX idx_tryon_style_time ON try_on_jobs(store_id, style_id, started_at);
        CREATE INDEX idx_intents_style_time ON style_intents(store_id, style_id, created_at);
        CREATE INDEX idx_orders_style_time ON orders(store_id, style_id, ordered_at);
        """
    )


def write_report(conn, styles, daily, weekly):
    latest_week = int(weekly["week_idx"].max())
    latest = weekly[weekly["week_idx"] == latest_week]
    report = {
        "database": str(DB_PATH),
        "store_id": STORE_ID,
        "tables": {
            "stores": 1,
            "users": query_scalar(conn, "SELECT COUNT(*) FROM users"),
            "user_sessions": query_scalar(conn, "SELECT COUNT(*) FROM user_sessions"),
            "user_style_events_sampled": query_scalar(conn, "SELECT COUNT(*) FROM user_style_events"),
            "user_style_events_estimated": query_scalar(conn, "SELECT COALESCE(SUM(scale_factor), 0) FROM user_style_events"),
            "try_on_jobs_sampled": query_scalar(conn, "SELECT COUNT(*) FROM try_on_jobs"),
            "style_intents_sampled": query_scalar(conn, "SELECT COUNT(*) FROM style_intents"),
            "orders_sampled": query_scalar(conn, "SELECT COUNT(*) FROM orders"),
            "nail_styles": int(len(styles)),
            "style_daily_metrics": int(len(daily)),
            "style_window_metrics": int(len(weekly)),
        },
        "event_sampling": {
            "sample_rate": EVENT_SAMPLE_RATE,
            "scale_factor": EVENT_SCALE_FACTOR,
            "detail_event_days": DETAIL_EVENT_DAYS,
            "note": "明细事件按比例抽样生成；聚合日表和窗口表为全量模拟口径。"
        },
        "date_range": {
            "daily_start": str(daily["metric_date"].min()),
            "daily_end": str(daily["metric_date"].max()),
            "n_days": int(pd.to_datetime(daily["metric_date"]).nunique()),
            "latest_week": latest_week,
        },
        "latest_week_distribution": latest["trend_label"].value_counts().to_dict(),
        "latest_3class_distribution": latest["label_3class"].value_counts().to_dict(),
        "top_hot_from_db": query_rows(conn, "SELECT style_id, category, price_level, view_uv, tryon_uv, confirm_7d, ROUND(hot_score, 4) AS hot_score, trend_label FROM style_window_metrics WHERE week_idx = ? ORDER BY hot_score DESC LIMIT 10", (latest_week,)),
        "top_cold_from_db": query_rows(conn, "SELECT style_id, category, price_level, view_uv, tryon_uv, confirm_7d, ROUND(cold_risk_score, 4) AS cold_risk_score, trend_label, sample_status FROM style_window_metrics WHERE week_idx = ? ORDER BY cold_risk_score DESC LIMIT 10", (latest_week,)),
        "event_type_distribution_sampled": query_rows(conn, "SELECT event_type, COUNT(*) AS sampled_count, SUM(scale_factor) AS estimated_count FROM user_style_events GROUP BY event_type ORDER BY estimated_count DESC"),
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def query_rows(conn, sql, params=()):
    conn.row_factory = sqlite3.Row
    rows = conn.execute(sql, params).fetchall()
    return [dict(row) for row in rows]


def query_scalar(conn, sql, params=()):
    return conn.execute(sql, params).fetchone()[0]


def main():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    if DB_PATH.exists():
        DB_PATH.unlink()

    source_styles = load_csv("simulated_nail_style_table.csv")
    source_daily = load_csv("simulated_nail_style_daily_metrics.csv")
    source_weekly = load_csv("simulated_nail_style_weekly_metrics.csv")

    styles = prepare_styles(source_styles)
    daily = prepare_daily(source_daily)
    weekly = prepare_weekly(source_weekly)
    users = create_users()
    events, try_on_jobs, intents, orders, sessions = make_events_and_actions(source_daily, users)

    with sqlite3.connect(DB_PATH) as conn:
        create_schema(conn)
        conn.execute("INSERT INTO stores (id, name, status) VALUES (?, ?, 'active')", (STORE_ID, STORE_NAME))
        styles.to_sql("nail_styles", conn, if_exists="append", index=False)
        users.to_sql("users", conn, if_exists="append", index=False)
        sessions.to_sql("user_sessions", conn, if_exists="append", index=False)
        events.to_sql("user_style_events", conn, if_exists="append", index=False)
        try_on_jobs.to_sql("try_on_jobs", conn, if_exists="append", index=False)
        intents.to_sql("style_intents", conn, if_exists="append", index=False)
        orders.to_sql("orders", conn, if_exists="append", index=False)
        daily.to_sql("style_daily_metrics", conn, if_exists="append", index=False)
        weekly.to_sql("style_window_metrics", conn, if_exists="append", index=False)
        report = write_report(conn, styles, daily, weekly)

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
