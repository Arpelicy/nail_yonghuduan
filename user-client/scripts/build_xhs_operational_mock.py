import json
import math
import random
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
SIM_DIR = ROOT / "outputs" / "simulation"
DB_DIR = ROOT / "db"
DATA_DIR = ROOT.parent / "data" / "xhs" / "processed"
ADMIN_SEED_PATH = ROOT.parent / "admin-ops" / "src" / "data" / "xhs-admin-seed.json"
DATASET_PATH = DATA_DIR / "xhs-style-dataset.json"
ENRICHED_DATASET_PATH = DATA_DIR / "xhs-style-dataset.enriched.json"
SUMMARY_PATH = SIM_DIR / "summary.json"
XHS_SUMMARY_PATH = SIM_DIR / "xhs_summary.json"
XHS_TREND_SNAPSHOT_PATH = SIM_DIR / "xhs_trend_snapshot.json"
MOCK_DB_PATH = DB_DIR / "mock-analytics.json"
MAPPING_PATH = SIM_DIR / "xhs_style_simulation_mapping.json"
XHS_STYLE_TABLE_PATH = SIM_DIR / "xhs_simulated_nail_style_table.csv"
XHS_DAILY_PATH = SIM_DIR / "xhs_simulated_nail_style_daily_metrics.csv"
XHS_WEEKLY_PATH = SIM_DIR / "xhs_simulated_nail_style_weekly_metrics.csv"

STORE_ID = "demo_store"
EVENT_SAMPLE_RATE = 0.02
USER_COUNT = 2400
SEED = 20260531
HOT_MIN_VIEW = 120
COLD_MIN_VIEW = 120
POTENTIAL_MAX_VIEW = 180
POTENTIAL_MIN_CONFIRM_RATE = 0.12


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def dump_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def price_to_level(price):
    if price <= 120:
        return "low"
    if price >= 220:
        return "high"
    return "mid"


def bucket_for_style(style):
    bucket = style.get("recommendBucket")
    if bucket in {"hot", "stable"}:
        return "hot"
    if bucket == "potential":
        return "potential"
    if bucket == "cold":
        return "cold"
    metrics = style.get("businessMetrics") or {}
    trend = metrics.get("trendLabel")
    if trend in {"HotUp", "Stable"}:
        return "hot"
    if trend == "Potential":
        return "potential"
    if trend == "ColdDown":
        return "cold"
    return "potential"


def label_bucket(label):
    if label in {"HotUp", "Stable"}:
        return "hot"
    if label in {"Potential", "Untested"}:
        return "potential"
    return "cold"


def select_hot_candidates(frame: pd.DataFrame):
    candidates = frame[
        (frame["label"].isin(["HotUp", "Stable"]))
        & (frame["view_uv"] >= HOT_MIN_VIEW)
        & (frame["tryon_confirm_rate"] >= 0.08)
    ]
    if candidates.empty:
        candidates = frame[frame["view_uv"] >= HOT_MIN_VIEW]
    return candidates.sort_values(["hot_score", "growth_score", "total_confirm_uv"], ascending=[False, False, False]).head(16)


def select_cold_candidates(frame: pd.DataFrame):
    candidates = frame[
        (frame["label"] == "ColdDown")
        & (frame["view_uv"] >= COLD_MIN_VIEW)
        & (frame["want_to_confirm_rate"] <= 0.18)
    ]
    if candidates.empty:
        candidates = frame[frame["view_uv"] >= COLD_MIN_VIEW]
    return candidates.sort_values(["cold_risk_score", "view_uv"], ascending=[False, False]).head(16)


def select_potential_candidates(frame: pd.DataFrame):
    candidates = frame[
        (frame["label"].isin(["Potential", "Untested"]))
        & (frame["view_uv"] <= POTENTIAL_MAX_VIEW)
        & (frame["want_to_confirm_rate"] >= POTENTIAL_MIN_CONFIRM_RATE)
    ]
    if candidates.empty:
        candidates = frame[frame["label"].isin(["Potential", "Untested"])]
    return candidates.sort_values(["growth_score", "hot_score", "want_to_confirm_rate"], ascending=[False, False, False]).head(16)


def choose_simulation_mapping(xhs_styles, latest_week):
    latest_rows = latest_week.copy()
    latest_rows = latest_rows.sort_values(["hot_score", "growth_score", "view_uv"], ascending=[False, False, False])
    pools = {"hot": [], "potential": [], "cold": []}
    for _, row in latest_rows.iterrows():
      pools[label_bucket(row["label"])].append(row.to_dict())

    used = set()
    cursor = {"hot": 0, "potential": 0, "cold": 0}
    ordered_styles = sorted(
        xhs_styles,
        key=lambda item: (
            {"hot": 0, "potential": 1, "cold": 2}.get(bucket_for_style(item), 3),
            -(item.get("businessMetrics") or {}).get("confirm", 0),
            -(item.get("postStats") or {}).get("likes", 0),
        ),
    )

    mapping = {}
    fallback_rows = latest_rows.to_dict("records")

    for style in ordered_styles:
        bucket = bucket_for_style(style)
        selected = None
        for pool_name in [bucket, "hot", "potential", "cold"]:
            pool = pools[pool_name]
            while cursor[pool_name] < len(pool):
                candidate = pool[cursor[pool_name]]
                cursor[pool_name] += 1
                if candidate["style_id"] in used:
                    continue
                selected = candidate
                break
            if selected:
                break
        if not selected:
            for candidate in fallback_rows:
                if candidate["style_id"] not in used:
                    selected = candidate
                    break
        if not selected:
            selected = random.choice(fallback_rows)
        used.add(selected["style_id"])
        mapping[style["id"]] = selected

    return mapping


def compute_exposure(row):
    view_uv = int(row["view_uv"])
    detail_rate = float(row.get("detail_rate", 0) or 0)
    base = max(view_uv, int(round(view_uv * 2.4)))
    if detail_rate < 0.12:
        base = int(round(view_uv * 3.1))
    elif detail_rate > 0.28:
        base = int(round(view_uv * 2.0))
    return max(base, view_uv)


def build_admin_suggestion(label):
    if label == "HotUp":
        return "热度和确认都高，适合继续保留在首页主推位。"
    if label == "Stable":
        return "表现稳定，适合作为稳转化款持续承接。"
    if label == "Potential":
        return "曝光还没吃满，但转化不差，建议继续给测试位。"
    if label == "Untested":
        return "样本不足，先给基础曝光，不急着判断冷热。"
    return "漏斗偏弱，优先检查封面、价格和试戴结果。"


def update_style_business_metrics(style, latest_row):
    style["businessMetrics"] = {
        "exposure": int(compute_exposure(latest_row)),
        "view": int(latest_row["view_uv"]),
        "detail": int(latest_row["detail_uv"]),
        "tryonSuccess": int(latest_row["tryon_result_uv"]),
        "want": int(latest_row["want_uv"]),
        "confirm": int(latest_row["total_confirm_uv"]),
        "orders": max(0, int(round(float(latest_row["total_confirm_uv"]) * 0.88))),
        "trendLabel": latest_row["label"],
        "sampleStatus": "enough" if int(latest_row["view_uv"]) >= 100 else "low_sample",
        "tryonRate": round(float(latest_row.get("tryon_rate", 0) or 0), 3),
        "wantRate": round(float(latest_row.get("want_rate", 0) or 0), 3),
        "confirmRate": round(float(latest_row.get("want_to_confirm_rate", 0) or 0), 3),
    }


def build_xhs_simulation_files(dataset_styles, admin_seed, sim_styles, sim_daily, sim_weekly, base_summary):
    latest_week_idx = int(sim_weekly["week_idx"].max())
    latest_week = sim_weekly[sim_weekly["week_idx"] == latest_week_idx]
    mapping = choose_simulation_mapping(dataset_styles, latest_week)
    sim_style_lookup = sim_styles.set_index("style_id").to_dict("index")
    admin_lookup = {item["id"]: item for item in admin_seed}
    xhs_style_rows = []
    xhs_daily_parts = []
    xhs_weekly_parts = []

    mapping_records = []

    for style in dataset_styles:
        style_id = style["id"]
        sim_row = mapping[style_id]
        sim_style_id = sim_row["style_id"]
        sim_meta = sim_style_lookup[sim_style_id]
        admin_row = admin_lookup.get(style_id)
        price = int(admin_row["price"]) if admin_row else 168
        level = price_to_level(price)

        style_daily = sim_daily[sim_daily["style_id"] == sim_style_id].copy()
        style_daily["style_id"] = style_id
        style_daily["style_name"] = style.get("marketingTitle") or style["name"]
        style_daily["category"] = (style.get("primaryTag") or sim_meta["category"])[:32]
        style_daily["price_level"] = level
        style_daily["true_state"] = sim_meta["true_state"]
        xhs_daily_parts.append(style_daily)

        style_weekly = sim_weekly[sim_weekly["style_id"] == sim_style_id].copy()
        style_weekly["style_id"] = style_id
        style_weekly["category"] = (style.get("primaryTag") or sim_meta["category"])[:32]
        style_weekly["price_level"] = level
        xhs_weekly_parts.append(style_weekly)

        latest_row = style_weekly[style_weekly["week_idx"] == latest_week_idx].iloc[0].to_dict()
        update_style_business_metrics(style, latest_row)

        if admin_row:
            admin_row["name"] = style.get("name") or style.get("marketingTitle") or admin_row.get("name")
            admin_row["description"] = style.get("definition") or admin_row.get("description")
            admin_row["category"] = style.get("primaryTag") or admin_row.get("category")
            admin_row["coverImage"] = style.get("image") or admin_row.get("coverImage")
            admin_row["tags"] = {
                "color": list((style.get("tagGroups") or {}).get("季节") or admin_row.get("tags", {}).get("color") or []),
                "style": list((style.get("tagGroups") or {}).get("风格") or admin_row.get("tags", {}).get("style") or []),
                "craft": list((style.get("tagGroups") or {}).get("款式") or admin_row.get("tags", {}).get("craft") or []),
                "length": list((style.get("tagGroups") or {}).get("甲型") or admin_row.get("tags", {}).get("length") or []),
                "scene": list((style.get("scenes") or []) or admin_row.get("tags", {}).get("scene") or []),
                "effect": list((style.get("effects") or []) or admin_row.get("tags", {}).get("effect") or []),
            }
            if admin_row["status"] in {"published", "unpublished", "archived"}:
                exposure = compute_exposure(latest_row)
                admin_row["metrics"] = {
                    "exposure": int(exposure),
                    "view": int(latest_row["view_uv"]),
                    "detail": int(latest_row["detail_uv"]),
                    "basketAdd": max(0, int(round(float(latest_row["tryon_uv"]) * 0.88))),
                    "tryonSuccess": int(latest_row["tryon_result_uv"]),
                    "resultView": max(0, int(round(float(latest_row["tryon_result_uv"]) * 0.84))),
                    "want": int(latest_row["want_uv"]),
                    "confirm": int(latest_row["total_confirm_uv"]),
                    "orders": max(0, int(round(float(latest_row["total_confirm_uv"]) * 0.88))),
                    "hotScore": int(round(float(latest_row["hot_score"]) * 100)),
                    "coldRiskScore": int(round(float(latest_row["cold_risk_score"]) * 100)),
                    "growthScore": int(round(float(latest_row["growth_score"]) * 100)),
                    "trendLabel": latest_row["label"],
                    "sampleStatus": "enough" if int(latest_row["view_uv"]) >= 100 else "low_sample",
                    "suggestion": build_admin_suggestion(latest_row["label"]),
                    "sourceBreakdown": {
                        "card": max(0, int(round(float(latest_row["total_confirm_uv"]) * 0.28))),
                        "detail": max(0, int(round(float(latest_row["total_confirm_uv"]) * 0.14))),
                        "tryon_result": max(0, int(round(float(latest_row["total_confirm_uv"]) * 0.26))),
                        "ai_recommend": max(0, int(round(float(latest_row["total_confirm_uv"]) * 0.18))),
                        "want_list": max(
                            0,
                            int(latest_row["total_confirm_uv"])
                            - max(0, int(round(float(latest_row["total_confirm_uv"]) * 0.28)))
                            - max(0, int(round(float(latest_row["total_confirm_uv"]) * 0.14)))
                            - max(0, int(round(float(latest_row["total_confirm_uv"]) * 0.26)))
                            - max(0, int(round(float(latest_row["total_confirm_uv"]) * 0.18)))
                        ),
                    },
                    "generationSuccessRate": round(0.9 + min(0.08, float(latest_row["hot_score"]) * 0.05), 2),
                    "avgLatencySec": round(7.4 + (1 - float(latest_row["hot_score"])) * 5.2, 1),
                    "resultViewDurationSec": max(12, int(round(18 + float(latest_row["want_rate"]) * 90))),
                }
            else:
                admin_row["metrics"]["trendLabel"] = "Untested"
                admin_row["metrics"]["sampleStatus"] = "low_sample"

        mapping_records.append({
            "style_id": style_id,
            "style_name": style.get("marketingTitle") or style["name"],
            "recommend_bucket": bucket_for_style(style),
            "mapped_sim_style_id": sim_style_id,
            "mapped_label": latest_row["label"],
            "mapped_true_state": sim_meta["true_state"],
        })

        xhs_style_rows.append({
            "style_id": style_id,
            "style_name": style.get("marketingTitle") or style["name"],
            "category": (style.get("primaryTag") or sim_meta["category"])[:32],
            "price_level": level,
            "true_state": sim_meta["true_state"],
            "base_popularity": float(sim_meta["base_popularity"]),
            "recommend_bucket": bucket_for_style(style),
            "mapped_sim_style_id": sim_style_id,
        })

    xhs_style_df = pd.DataFrame(xhs_style_rows)
    xhs_daily_df = pd.concat(xhs_daily_parts, ignore_index=True)
    xhs_weekly_df = pd.concat(xhs_weekly_parts, ignore_index=True)

    xhs_style_df.to_csv(XHS_STYLE_TABLE_PATH, index=False, encoding="utf-8-sig")
    xhs_daily_df.to_csv(XHS_DAILY_PATH, index=False, encoding="utf-8-sig")
    xhs_weekly_df.to_csv(XHS_WEEKLY_PATH, index=False, encoding="utf-8-sig")

    latest_xhs_week = xhs_weekly_df[xhs_weekly_df["week_idx"] == xhs_weekly_df["week_idx"].max()].copy()

    hot_candidates = select_hot_candidates(latest_xhs_week)
    cold_candidates = select_cold_candidates(latest_xhs_week)
    potential_candidates = select_potential_candidates(latest_xhs_week)

    summary = {
        "seed": base_summary.get("seed", SEED),
        "n_styles": int(xhs_style_df["style_id"].nunique()),
        "n_days": int(xhs_daily_df["date"].nunique()),
        "n_daily_rows": int(len(xhs_daily_df)),
        "n_weekly_rows": int(len(xhs_weekly_df)),
        "latest_week": int(latest_xhs_week["week_idx"].max()),
        "true_state_distribution": xhs_style_df["true_state"].value_counts().to_dict(),
        "latest_label_distribution": latest_xhs_week["label"].value_counts().to_dict(),
        "latest_3class_distribution": latest_xhs_week["label_3class"].value_counts().to_dict(),
        "model_report_3class": base_summary.get("model_report_3class"),
        "model_report_true_3class": base_summary.get("model_report_true_3class"),
        "model_report_multiclass": base_summary.get("model_report_multiclass"),
        "top_hot": hot_candidates[[
            "style_id", "category", "price_level", "true_state", "view_uv", "tryon_uv", "want_uv", "total_confirm_uv",
            "tryon_confirm_rate", "want_to_confirm_rate", "hot_score", "cold_risk_score", "growth_score", "label"
        ]].to_dict("records"),
        "top_cold": cold_candidates[[
            "style_id", "category", "price_level", "true_state", "view_uv", "tryon_uv", "want_uv", "total_confirm_uv",
            "tryon_confirm_rate", "want_to_confirm_rate", "hot_score", "cold_risk_score", "growth_score", "label"
        ]].to_dict("records"),
        "top_potential": potential_candidates[[
            "style_id", "category", "price_level", "true_state", "view_uv", "tryon_uv", "want_uv", "total_confirm_uv",
            "tryon_confirm_rate", "want_to_confirm_rate", "hot_score", "cold_risk_score", "growth_score", "label"
        ]].to_dict("records"),
        "paths": {
            "styles": str(XHS_STYLE_TABLE_PATH.relative_to(ROOT)),
            "daily": str(XHS_DAILY_PATH.relative_to(ROOT)),
            "weekly": str(XHS_WEEKLY_PATH.relative_to(ROOT)),
        },
    }

    dump_json(XHS_SUMMARY_PATH, summary)
    dump_json(MAPPING_PATH, mapping_records)
    build_trend_snapshot(dataset_styles, xhs_daily_df, xhs_weekly_df, summary)
    return xhs_daily_df, xhs_weekly_df, summary


def build_trend_snapshot(dataset_styles, xhs_daily_df, xhs_weekly_df, summary):
    style_lookup = {item["id"]: item for item in dataset_styles}
    daily_sorted = xhs_daily_df.sort_values(["style_id", "date"]).copy()
    weekly_sorted = xhs_weekly_df.sort_values(["style_id", "week_idx"]).copy()

    series_by_style = {}
    for style_id, group in daily_sorted.groupby("style_id"):
        style = style_lookup.get(style_id, {})
        series_by_style[style_id] = {
            "styleId": style_id,
            "styleName": style.get("marketingTitle") or style.get("name") or style_id,
            "image": style.get("image", ""),
            "primaryTag": style.get("primaryTag", ""),
            "secondaryTag": style.get("secondaryTag", ""),
            "daily": [
                {
                    "date": row["date"],
                    "view_uv": int(row["view_uv"]),
                    "tryon_uv": int(row["tryon_uv"]),
                    "tryon_result_uv": int(row["tryon_result_uv"]),
                    "want_uv": int(row["want_uv"]),
                    "total_confirm_uv": int(row["total_confirm_uv"]),
                }
                for _, row in group.iterrows()
            ],
        }

    weekly_by_style = {}
    for style_id, group in weekly_sorted.groupby("style_id"):
        weekly_by_style[style_id] = [
            {
                "week_idx": int(row["week_idx"]),
                "label": row["label"],
                "hot_score": round(float(row["hot_score"]) * 100, 1),
                "cold_risk_score": round(float(row["cold_risk_score"]) * 100, 1),
                "growth_score": round(float(row["growth_score"]) * 100, 1),
                "view_uv": int(row["view_uv"]),
                "tryon_uv": int(row["tryon_uv"]),
                "want_uv": int(row["want_uv"]),
                "total_confirm_uv": int(row["total_confirm_uv"]),
            }
            for _, row in group.iterrows()
        ]

    latest_hot_ids = [item["style_id"] for item in summary.get("top_hot", [])[:12]]
    latest_cold_ids = [item["style_id"] for item in summary.get("top_cold", [])[:12]]
    latest_potential_ids = [item["style_id"] for item in summary.get("top_potential", [])[:12]]

    payload = {
        "updatedAt": datetime.utcnow().isoformat() + "Z",
        "dateRange": {
            "startDate": daily_sorted["date"].min(),
            "endDate": daily_sorted["date"].max(),
            "days": int(daily_sorted["date"].nunique()),
        },
        "weeklyRange": {
            "startWeek": int(weekly_sorted["week_idx"].min()),
            "endWeek": int(weekly_sorted["week_idx"].max()),
        },
        "latestHotIds": latest_hot_ids,
        "latestColdIds": latest_cold_ids,
        "latestPotentialIds": latest_potential_ids,
        "styles": [
            {
                **series_by_style[style_id],
                "weekly": weekly_by_style.get(style_id, []),
            }
            for style_id in series_by_style.keys()
        ],
    }
    dump_json(XHS_TREND_SNAPSHOT_PATH, payload)


def make_user_pool():
    return [f"xhs_user_{index + 1:05d}" for index in range(USER_COUNT)]


def make_timestamp(day_str, rng, min_hour=9, max_hour=22):
    day = datetime.fromisoformat(day_str)
    return (day + timedelta(hours=rng.randint(min_hour, max_hour), minutes=rng.randint(0, 59), seconds=rng.randint(0, 59))).isoformat() + "Z"


def sample_count(count):
    count = max(0, int(count))
    if count == 0:
        return 0
    estimate = int(round(count * EVENT_SAMPLE_RATE))
    if estimate > 0:
        return estimate
    return 1 if count >= 80 else 0


def pick_confirm_source(rng):
    points = [
        ("card", 0.22),
        ("detail", 0.14),
        ("tryon_result", 0.32),
        ("ai_recommend", 0.12),
        ("want_list", 0.20),
    ]
    cursor = 0
    roll = rng.random()
    for name, weight in points:
        cursor += weight
        if roll <= cursor:
            return name
    return "want_list"


def build_mock_analytics(dataset_styles, xhs_daily_df):
    rng = random.Random(SEED)
    style_lookup = {item["id"]: item for item in dataset_styles}
    users = make_user_pool()
    events = []
    try_on_jobs = []
    intents = []
    orders = []

    for row in xhs_daily_df.to_dict("records"):
        style_id = row["style_id"]
        style = style_lookup.get(style_id)
        if not style:
            continue
        style_name = style.get("marketingTitle") or style["name"]
        day = row["date"]
        impression_count = sample_count(max(int(row["view_uv"]), int(row["view_uv"] * 2.6)))
        view_count = sample_count(int(row["view_uv"]))
        candidate_count = sample_count(int(row["tryon_uv"]))
        tryon_count = sample_count(int(row["tryon_result_uv"]))
        result_view_count = sample_count(int(row["tryon_result_uv"] * 0.86))
        intent_count = sample_count(int(row["want_uv"]))
        confirm_count = sample_count(int(row["total_confirm_uv"]))

        for position in range(impression_count):
            user_id = rng.choice(users)
            events.append({
                "id": f"evt_{uuid.uuid4().hex[:12]}",
                "store_id": STORE_ID,
                "created_at": make_timestamp(day, rng, 8, 23),
                "event_name": "style_impression",
                "event_type": "style_impression",
                "user_id": user_id,
                "style_id": style_id,
                "entity_id": None,
                "is_valid_impression": True,
                "properties": {
                    "style_name": style_name,
                    "page": "catalog",
                    "position": (position % 8) + 1,
                    "visible_type": "full_visible" if (position % 8) < 4 else "half_visible"
                }
            })

        for _ in range(view_count):
            user_id = rng.choice(users)
            events.append({
                "id": f"evt_{uuid.uuid4().hex[:12]}",
                "store_id": STORE_ID,
                "created_at": make_timestamp(day, rng, 9, 23),
                "event_name": "style_view",
                "event_type": "style_view",
                "user_id": user_id,
                "style_id": style_id,
                "entity_id": None,
                "is_valid_view": True,
                "properties": {"style_name": style_name, "source": "catalog"}
            })

        for _ in range(candidate_count):
            user_id = rng.choice(users)
            events.append({
                "id": f"evt_{uuid.uuid4().hex[:12]}",
                "store_id": STORE_ID,
                "created_at": make_timestamp(day, rng, 9, 23),
                "event_name": "tryon_candidate_add",
                "event_type": "tryon_click",
                "user_id": user_id,
                "style_id": style_id,
                "entity_id": None,
                "properties": {"style_name": style_name, "source": "catalog"}
            })

        tryon_users = []
        for _ in range(tryon_count):
            user_id = rng.choice(users)
            tryon_users.append(user_id)
            job_id = f"tryon_{uuid.uuid4().hex[:12]}"
            created_at = make_timestamp(day, rng, 10, 23)
            try_on_jobs.append({
                "id": job_id,
                "store_id": STORE_ID,
                "created_at": created_at,
                "finished_at": created_at,
                "user_id": user_id,
                "style_id": style_id,
                "style_name": style_name,
                "status": "succeeded",
                "mode": "normal",
                "result_url": f"/mock/results/{job_id}.jpg"
            })

        for _ in range(result_view_count):
            user_id = rng.choice(tryon_users or users)
            events.append({
                "id": f"evt_{uuid.uuid4().hex[:12]}",
                "store_id": STORE_ID,
                "created_at": make_timestamp(day, rng, 10, 23),
                "event_name": "tryon_result_view",
                "event_type": "tryon_result_view",
                "user_id": user_id,
                "style_id": style_id,
                "entity_id": None,
                "properties": {"style_name": style_name, "source": "tryon_result"}
            })

        for _ in range(intent_count):
            user_id = rng.choice(tryon_users or users)
            source = "tryon_result" if rng.random() < 0.52 else ("detail" if rng.random() < 0.5 else "card")
            intent_id = f"intent_{uuid.uuid4().hex[:12]}"
            created_at = make_timestamp(day, rng, 10, 23)
            events.append({
                "id": f"evt_{uuid.uuid4().hex[:12]}",
                "store_id": STORE_ID,
                "created_at": created_at,
                "event_name": "style_intent_click",
                "event_type": "want_click",
                "user_id": user_id,
                "style_id": style_id,
                "entity_id": intent_id,
                "properties": {"style_name": style_name, "intent_source": source}
            })
            intents.append({
                "id": intent_id,
                "store_id": STORE_ID,
                "created_at": created_at,
                "user_id": user_id,
                "style_id": style_id,
                "style_name": style_name,
                "try_on_job_id": None,
                "intent_type": "want_to_do"
            })

        for _ in range(confirm_count):
            source = pick_confirm_source(rng)
            user_id = rng.choice(tryon_users or users)
            order_id = f"order_{uuid.uuid4().hex[:12]}"
            created_at = make_timestamp(day, rng, 10, 23)
            events.append({
                "id": f"evt_{uuid.uuid4().hex[:12]}",
                "store_id": STORE_ID,
                "created_at": created_at,
                "event_name": "style_confirm_click",
                "event_type": "confirm_click",
                "user_id": user_id,
                "style_id": style_id,
                "entity_id": order_id,
                "properties": {"style_name": style_name, "confirm_source": source}
            })
            orders.append({
                "id": order_id,
                "store_id": STORE_ID,
                "ordered_at": created_at,
                "source": source,
                "user_id": user_id,
                "style_id": style_id,
                "style_name": style_name,
                "try_on_job_id": None,
                "amount": 168,
                "status": "confirmed"
            })

    payload = {
        "events": sorted(events, key=lambda item: item["created_at"]),
        "try_on_jobs": sorted(try_on_jobs, key=lambda item: item["created_at"]),
        "intents": sorted(intents, key=lambda item: item["created_at"]),
        "orders": sorted(orders, key=lambda item: item["ordered_at"]),
    }
    dump_json(MOCK_DB_PATH, payload)


def main():
    random.seed(SEED)
    dataset_path = ENRICHED_DATASET_PATH if ENRICHED_DATASET_PATH.exists() else DATASET_PATH
    dataset = load_json(dataset_path)
    base_dataset = load_json(DATASET_PATH)
    admin_seed = load_json(ADMIN_SEED_PATH)
    sim_styles = pd.read_csv(SIM_DIR / "simulated_nail_style_table.csv")
    sim_daily = pd.read_csv(SIM_DIR / "simulated_nail_style_daily_metrics.csv")
    sim_weekly = pd.read_csv(SIM_DIR / "simulated_nail_style_weekly_metrics.csv")
    base_summary = load_json(SUMMARY_PATH)

    xhs_daily_df, _, _ = build_xhs_simulation_files(dataset["styles"], admin_seed, sim_styles, sim_daily, sim_weekly, base_summary)

    base_lookup = {item["id"]: item for item in dataset["styles"]}
    for item in base_dataset["styles"]:
        if item["id"] in base_lookup:
            item["businessMetrics"] = base_lookup[item["id"]]["businessMetrics"]
    dump_json(DATASET_PATH, base_dataset)
    dump_json(dataset_path, dataset)
    dump_json(ADMIN_SEED_PATH, admin_seed)
    build_mock_analytics(dataset["styles"], xhs_daily_df)
    print(f"Built aligned XHS simulation for {len(dataset['styles'])} styles")
    print(f"- {XHS_STYLE_TABLE_PATH}")
    print(f"- {XHS_DAILY_PATH}")
    print(f"- {XHS_WEEKLY_PATH}")
    print(f"- {XHS_SUMMARY_PATH}")
    print(f"- {MOCK_DB_PATH}")


if __name__ == "__main__":
    main()
