import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

try:
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import accuracy_score, classification_report
    SKLEARN_AVAILABLE = True
except Exception:
    RandomForestClassifier = None
    accuracy_score = None
    classification_report = None
    SKLEARN_AVAILABLE = False


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "outputs" / "simulation"
OUT_DIR.mkdir(parents=True, exist_ok=True)

SEED = 42
N_STYLES = 300
N_DAYS = 120
START_DATE = "2026-01-01"

STATES = [
    "HotUp",
    "Stable",
    "Cold_FirstLook",
    "Cold_Detail",
    "Cold_AfterTryon",
    "Cold_AfterWant",
    "ColdDown",
    "Potential",
    "Untested",
]

STATE_PROBS = [0.12, 0.32, 0.12, 0.10, 0.12, 0.08, 0.08, 0.04, 0.02]
CATEGORIES = ["cat_eye", "french", "gradient", "solid", "rhinestone", "handpaint"]
PRICE_LEVELS = ["low", "mid", "high"]

RATE_CONFIG = {
    "HotUp": dict(detail=0.30, tryon=0.30, want=0.22, tryon_want=0.35, direct_confirm=0.08, tryon_confirm=0.22, want_confirm=0.28),
    "Stable": dict(detail=0.22, tryon=0.16, want=0.12, tryon_want=0.18, direct_confirm=0.03, tryon_confirm=0.08, want_confirm=0.15),
    "Cold_FirstLook": dict(detail=0.06, tryon=0.04, want=0.03, tryon_want=0.10, direct_confirm=0.005, tryon_confirm=0.04, want_confirm=0.08),
    "Cold_Detail": dict(detail=0.35, tryon=0.08, want=0.05, tryon_want=0.10, direct_confirm=0.006, tryon_confirm=0.04, want_confirm=0.08),
    "Cold_AfterTryon": dict(detail=0.22, tryon=0.30, want=0.08, tryon_want=0.04, direct_confirm=0.015, tryon_confirm=0.015, want_confirm=0.08),
    "Cold_AfterWant": dict(detail=0.22, tryon=0.16, want=0.24, tryon_want=0.12, direct_confirm=0.015, tryon_confirm=0.05, want_confirm=0.03),
    "ColdDown": dict(detail=0.18, tryon=0.12, want=0.10, tryon_want=0.10, direct_confirm=0.015, tryon_confirm=0.04, want_confirm=0.08),
    "Potential": dict(detail=0.25, tryon=0.28, want=0.18, tryon_want=0.35, direct_confirm=0.06, tryon_confirm=0.20, want_confirm=0.25),
    "Untested": dict(detail=0.15, tryon=0.10, want=0.08, tryon_want=0.10, direct_confirm=0.01, tryon_confirm=0.03, want_confirm=0.05),
}

AGG_COLS = [
    "view_uv",
    "detail_uv",
    "tryon_uv",
    "tryon_result_uv",
    "want_uv",
    "want_after_tryon_uv",
    "confirm_direct_uv",
    "confirm_detail_uv",
    "confirm_after_tryon_uv",
    "confirm_from_want_uv",
    "total_confirm_uv",
]

FEATURE_COLS = [
    "view_uv",
    "detail_uv",
    "tryon_uv",
    "tryon_result_uv",
    "want_uv",
    "total_confirm_uv",
    "detail_rate",
    "tryon_rate",
    "want_rate",
    "direct_confirm_rate",
    "detail_confirm_rate",
    "tryon_want_rate",
    "tryon_confirm_rate",
    "want_to_confirm_rate",
    "total_confirm_rate",
    "view_uv_growth",
    "detail_uv_growth",
    "tryon_uv_growth",
    "want_uv_growth",
    "total_confirm_uv_growth",
    "confirm_after_tryon_uv_growth",
    "hot_score",
    "cold_risk_score",
    "growth_score",
]


def safe_div(a, b):
    return np.where(b > 0, a / b, 0.0)


def clamp_rate(x):
    return float(np.clip(x, 0.001, 0.95))


def noisy_rate(base, sigma=0.20):
    return clamp_rate(base * np.random.lognormal(mean=0, sigma=sigma))


def trend_factor(state, day):
    if state == "HotUp":
        return 0.7 + 0.012 * day
    if state == "ColdDown":
        return max(0.2, 1.3 - 0.010 * day)
    if state == "Potential":
        return 0.35 + 0.002 * day
    if state == "Untested":
        return 0.08
    return 1.0 + 0.05 * math.sin(day / 7)


def merge_label(label):
    if label == "HotUp":
        return "HotUp"
    if label.startswith("Cold"):
        return "ColdRisk"
    return "Normal"


def generate_styles():
    rows = []
    for index in range(N_STYLES):
        state = np.random.choice(STATES, p=STATE_PROBS)
        category = np.random.choice(CATEGORIES)
        price = np.random.choice(PRICE_LEVELS, p=[0.25, 0.55, 0.20])
        base_popularity = np.random.gamma(shape=3.0, scale=40.0)

        if state == "Untested":
            base_popularity *= 0.08
        elif state == "Potential":
            base_popularity *= 0.25

        rows.append({
            "style_id": f"S{index + 1:04d}",
            "style_name": f"Nail Style {index + 1:04d}",
            "category": category,
            "price_level": price,
            "true_state": state,
            "base_popularity": round(base_popularity, 3),
        })
    return pd.DataFrame(rows)


def generate_daily(styles_df):
    dates = pd.date_range(START_DATE, periods=N_DAYS, freq="D")
    rows = []

    for _, style in styles_df.iterrows():
        cfg = RATE_CONFIG[style["true_state"]]
        style_rates = {key: noisy_rate(value, sigma=0.25) for key, value in cfg.items()}

        for day_idx, date in enumerate(dates):
            tf = trend_factor(style["true_state"], day_idx)
            weekend = 1.15 if date.weekday() in [5, 6] else 1.0
            noise = np.random.lognormal(mean=0, sigma=0.25)
            expected_view = style["base_popularity"] * tf * weekend * noise
            view_uv = np.random.poisson(max(expected_view, 0.1))

            detail_uv = np.random.binomial(view_uv, noisy_rate(style_rates["detail"], 0.10))
            tryon_uv = np.random.binomial(view_uv, noisy_rate(style_rates["tryon"], 0.10))
            tryon_result_uv = np.random.binomial(tryon_uv, 0.90)
            want_from_view_uv = np.random.binomial(view_uv, noisy_rate(style_rates["want"], 0.10))
            want_after_tryon_uv = np.random.binomial(tryon_result_uv, noisy_rate(style_rates["tryon_want"], 0.10))
            want_uv = min(view_uv, want_from_view_uv + want_after_tryon_uv)

            confirm_direct_uv = np.random.binomial(view_uv, noisy_rate(style_rates["direct_confirm"], 0.10))
            confirm_detail_uv = np.random.binomial(detail_uv, noisy_rate(style_rates["direct_confirm"] * 1.2, 0.10))
            confirm_after_tryon_uv = np.random.binomial(tryon_result_uv, noisy_rate(style_rates["tryon_confirm"], 0.10))
            confirm_from_want_uv = np.random.binomial(want_uv, noisy_rate(style_rates["want_confirm"], 0.10))
            total_confirm_uv = min(
                view_uv,
                confirm_direct_uv + confirm_detail_uv + confirm_after_tryon_uv + confirm_from_want_uv,
            )

            rows.append({
                "date": date.date().isoformat(),
                "style_id": style["style_id"],
                "category": style["category"],
                "price_level": style["price_level"],
                "true_state": style["true_state"],
                "view_uv": view_uv,
                "detail_uv": detail_uv,
                "tryon_uv": tryon_uv,
                "tryon_result_uv": tryon_result_uv,
                "want_uv": want_uv,
                "want_after_tryon_uv": want_after_tryon_uv,
                "confirm_direct_uv": confirm_direct_uv,
                "confirm_detail_uv": confirm_detail_uv,
                "confirm_after_tryon_uv": confirm_after_tryon_uv,
                "confirm_from_want_uv": confirm_from_want_uv,
                "total_confirm_uv": total_confirm_uv,
            })

    return pd.DataFrame(rows)


def build_weekly(daily_df):
    daily_df = daily_df.copy()
    daily_df["date"] = pd.to_datetime(daily_df["date"])
    daily_df["week_idx"] = ((daily_df["date"] - daily_df["date"].min()).dt.days // 7).astype(int)

    week_df = (
        daily_df
        .groupby(["style_id", "category", "price_level", "true_state", "week_idx"], as_index=False)[AGG_COLS]
        .sum()
    )

    week_df["detail_rate"] = safe_div(week_df["detail_uv"], week_df["view_uv"])
    week_df["tryon_rate"] = safe_div(week_df["tryon_uv"], week_df["view_uv"])
    week_df["want_rate"] = safe_div(week_df["want_uv"], week_df["view_uv"])
    week_df["direct_confirm_rate"] = safe_div(week_df["confirm_direct_uv"], week_df["view_uv"])
    week_df["detail_confirm_rate"] = safe_div(week_df["confirm_detail_uv"], week_df["detail_uv"])
    week_df["tryon_want_rate"] = safe_div(week_df["want_after_tryon_uv"], week_df["tryon_result_uv"])
    week_df["tryon_confirm_rate"] = safe_div(week_df["confirm_after_tryon_uv"], week_df["tryon_result_uv"])
    week_df["want_to_confirm_rate"] = safe_div(week_df["confirm_from_want_uv"], week_df["want_uv"])
    week_df["total_confirm_rate"] = safe_div(week_df["total_confirm_uv"], week_df["view_uv"])

    week_df = week_df.sort_values(["style_id", "week_idx"])
    for col in ["view_uv", "detail_uv", "tryon_uv", "want_uv", "total_confirm_uv", "confirm_after_tryon_uv"]:
        last = week_df.groupby("style_id")[col].shift(1)
        week_df[f"{col}_growth"] = ((week_df[col] + 1) / (last + 1)).fillna(1.0)

    pct_cols = [
        "detail_rate",
        "tryon_rate",
        "want_rate",
        "direct_confirm_rate",
        "detail_confirm_rate",
        "tryon_want_rate",
        "tryon_confirm_rate",
        "want_to_confirm_rate",
        "total_confirm_rate",
        "view_uv_growth",
        "detail_uv_growth",
        "tryon_uv_growth",
        "want_uv_growth",
        "total_confirm_uv_growth",
        "confirm_after_tryon_uv_growth",
    ]
    for col in pct_cols:
        week_df[f"{col}_pct"] = (
            week_df.groupby(["category", "price_level", "week_idx"])[col]
            .rank(pct=True)
            .fillna(0.5)
        )

    week_df["hot_score"] = (
        0.15 * week_df["detail_rate_pct"]
        + 0.15 * week_df["want_rate_pct"]
        + 0.15 * week_df["tryon_rate_pct"]
        + 0.15 * week_df["direct_confirm_rate_pct"]
        + 0.25 * week_df["tryon_confirm_rate_pct"]
        + 0.15 * week_df["want_to_confirm_rate_pct"]
    )

    week_df["cold_risk_score"] = (
        0.15 * (1 - week_df["detail_rate_pct"])
        + 0.15 * (1 - week_df["want_rate_pct"])
        + 0.15 * (1 - week_df["tryon_rate_pct"])
        + 0.15 * (1 - week_df["direct_confirm_rate_pct"])
        + 0.25 * (1 - week_df["tryon_confirm_rate_pct"])
        + 0.15 * (1 - week_df["want_to_confirm_rate_pct"])
    )

    week_df["growth_score"] = (
        0.15 * week_df["view_uv_growth_pct"]
        + 0.15 * week_df["detail_uv_growth_pct"]
        + 0.20 * week_df["tryon_uv_growth_pct"]
        + 0.20 * week_df["want_uv_growth_pct"]
        + 0.30 * week_df["total_confirm_uv_growth_pct"]
    )

    week_df["label"] = week_df.apply(assign_label, axis=1)
    week_df["label_3class"] = week_df["label"].map(merge_label)
    week_df["true_group"] = week_df["true_state"].map(merge_label)
    week_df["next_label"] = week_df.groupby("style_id")["label"].shift(-1)
    week_df["next_label_3class"] = week_df.groupby("style_id")["label_3class"].shift(-1)
    week_df["next_true_group"] = week_df.groupby("style_id")["true_group"].shift(-1)
    return week_df


def assign_label(row):
    b_min, d_min, t_min, w_min = 100, 30, 30, 20

    if row["view_uv"] < b_min:
        if row["tryon_confirm_rate_pct"] >= 0.80 or row["total_confirm_rate_pct"] >= 0.80:
            return "Potential"
        return "Untested"

    if row["hot_score"] >= 0.70 and row["growth_score"] >= 0.70:
        return "HotUp"

    if (
        row["detail_rate_pct"] <= 0.30
        and row["want_rate_pct"] <= 0.30
        and row["tryon_rate_pct"] <= 0.30
        and row["direct_confirm_rate_pct"] <= 0.30
    ):
        return "Cold_FirstLook"

    if row["detail_uv"] >= d_min and row["detail_confirm_rate_pct"] <= 0.30 and row["detail_rate_pct"] >= 0.50:
        return "Cold_Detail"

    if row["tryon_result_uv"] >= t_min and row["tryon_confirm_rate_pct"] <= 0.30 and row["tryon_want_rate_pct"] <= 0.30:
        return "Cold_AfterTryon"

    if row["want_uv"] >= w_min and row["want_to_confirm_rate_pct"] <= 0.30:
        return "Cold_AfterWant"

    if row["cold_risk_score"] >= 0.70 and row["growth_score"] <= 0.30:
        return "ColdDown"

    return "Stable"


def nearest_centroid_report(model_df, label_col):
    model_df = model_df.dropna(subset=[label_col]).copy()
    max_week = int(model_df["week_idx"].max())
    train_df = model_df[model_df["week_idx"] <= int(max_week * 0.70)]
    test_df = model_df[model_df["week_idx"] > int(max_week * 0.70)]

    x_train = train_df[FEATURE_COLS].fillna(0.0).to_numpy(dtype=float)
    y_train = train_df[label_col].to_numpy()
    x_test = test_df[FEATURE_COLS].fillna(0.0).to_numpy(dtype=float)
    y_test = test_df[label_col].to_numpy()

    mean = x_train.mean(axis=0)
    std = x_train.std(axis=0)
    std[std == 0] = 1
    x_train = (x_train - mean) / std
    x_test = (x_test - mean) / std

    classes = sorted(pd.Series(y_train).dropna().unique().tolist())
    centroids = np.vstack([x_train[y_train == klass].mean(axis=0) for klass in classes])
    distances = ((x_test[:, None, :] - centroids[None, :, :]) ** 2).sum(axis=2)
    pred = np.array([classes[index] for index in distances.argmin(axis=1)])

    rows = []
    for klass in classes:
        tp = int(((pred == klass) & (y_test == klass)).sum())
        fp = int(((pred == klass) & (y_test != klass)).sum())
        fn = int(((pred != klass) & (y_test == klass)).sum())
        support = int((y_test == klass).sum())
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
        rows.append({
            "label": klass,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "support": support,
        })

    accuracy = float((pred == y_test).mean()) if len(y_test) else 0.0
    macro_f1 = float(np.mean([row["f1"] for row in rows])) if rows else 0.0
    return {
        "model": "NearestCentroid",
        "target": label_col,
        "train_rows": int(len(train_df)),
        "test_rows": int(len(test_df)),
        "accuracy": round(accuracy, 4),
        "macro_f1": round(macro_f1, 4),
        "class_report": rows,
    }


def random_forest_report(model_df, label_col):
    if not SKLEARN_AVAILABLE:
        return nearest_centroid_report(model_df, label_col)

    model_df = model_df.dropna(subset=[label_col]).copy()
    max_week = int(model_df["week_idx"].max())
    train_df = model_df[model_df["week_idx"] <= int(max_week * 0.70)]
    test_df = model_df[model_df["week_idx"] > int(max_week * 0.70)]

    x_train = train_df[FEATURE_COLS].fillna(0.0)
    y_train = train_df[label_col]
    x_test = test_df[FEATURE_COLS].fillna(0.0)
    y_test = test_df[label_col]

    clf = RandomForestClassifier(
        n_estimators=300,
        max_depth=12,
        min_samples_leaf=5,
        class_weight="balanced",
        random_state=SEED,
        n_jobs=-1,
    )
    clf.fit(x_train, y_train)
    pred = clf.predict(x_test)
    report = classification_report(y_test, pred, output_dict=True, zero_division=0)

    labels = sorted(y_train.dropna().unique().tolist())
    rows = []
    for label in labels:
        item = report.get(label, {})
        rows.append({
            "label": label,
            "precision": round(float(item.get("precision", 0.0)), 4),
            "recall": round(float(item.get("recall", 0.0)), 4),
            "f1": round(float(item.get("f1-score", 0.0)), 4),
            "support": int(item.get("support", 0)),
        })

    return {
        "model": "RandomForestClassifier",
        "target": label_col,
        "train_rows": int(len(train_df)),
        "test_rows": int(len(test_df)),
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        "macro_f1": round(float(report.get("macro avg", {}).get("f1-score", 0.0)), 4),
        "class_report": rows,
    }


def make_leaderboards(week_df):
    latest_week = int(week_df["week_idx"].max())
    latest = week_df[week_df["week_idx"] == latest_week].copy()

    hot = latest.sort_values(["hot_score", "growth_score", "total_confirm_uv"], ascending=False).head(20)
    cold = latest.sort_values(["cold_risk_score", "growth_score"], ascending=[False, True]).head(20)
    potential = (
        latest[(latest["view_uv"] < 100) & ((latest["tryon_confirm_rate_pct"] >= 0.80) | (latest["total_confirm_rate_pct"] >= 0.80))]
        .sort_values(["tryon_confirm_rate", "total_confirm_rate"], ascending=False)
        .head(20)
    )

    cols = [
        "style_id",
        "category",
        "price_level",
        "true_state",
        "view_uv",
        "tryon_uv",
        "want_uv",
        "total_confirm_uv",
        "tryon_confirm_rate",
        "want_to_confirm_rate",
        "hot_score",
        "cold_risk_score",
        "growth_score",
        "label",
    ]
    return hot[cols], cold[cols], potential[cols]


def main():
    np.random.seed(SEED)
    styles_df = generate_styles()
    daily_df = generate_daily(styles_df)
    week_df = build_weekly(daily_df)
    hot_df, cold_df, potential_df = make_leaderboards(week_df)

    model_df = week_df.dropna(subset=["next_label", "next_label_3class", "next_true_group"]).copy()
    report_true_3class = random_forest_report(model_df, "next_true_group")
    report_multi = random_forest_report(model_df, "next_label")
    report_3class = random_forest_report(model_df, "next_label_3class")

    styles_path = OUT_DIR / "simulated_nail_style_table.csv"
    daily_path = OUT_DIR / "simulated_nail_style_daily_metrics.csv"
    weekly_path = OUT_DIR / "simulated_nail_style_weekly_metrics.csv"
    hot_path = OUT_DIR / "hot_trend_leaderboard.csv"
    cold_path = OUT_DIR / "cold_risk_leaderboard.csv"
    potential_path = OUT_DIR / "potential_leaderboard.csv"

    styles_df.to_csv(styles_path, index=False, encoding="utf-8-sig")
    daily_df.to_csv(daily_path, index=False, encoding="utf-8-sig")
    week_df.to_csv(weekly_path, index=False, encoding="utf-8-sig")
    hot_df.to_csv(hot_path, index=False, encoding="utf-8-sig")
    cold_df.to_csv(cold_path, index=False, encoding="utf-8-sig")
    potential_df.to_csv(potential_path, index=False, encoding="utf-8-sig")

    latest = week_df[week_df["week_idx"] == week_df["week_idx"].max()]
    summary = {
        "seed": SEED,
        "n_styles": N_STYLES,
        "n_days": N_DAYS,
        "n_daily_rows": int(len(daily_df)),
        "n_weekly_rows": int(len(week_df)),
        "latest_week": int(week_df["week_idx"].max()),
        "true_state_distribution": styles_df["true_state"].value_counts().to_dict(),
        "latest_label_distribution": latest["label"].value_counts().to_dict(),
        "latest_3class_distribution": latest["label_3class"].value_counts().to_dict(),
        "model_report_3class": report_3class,
        "model_report_true_3class": report_true_3class,
        "model_report_multiclass": report_multi,
        "top_hot": hot_df.head(10).to_dict(orient="records"),
        "top_cold": cold_df.head(10).to_dict(orient="records"),
        "top_potential": potential_df.head(10).to_dict(orient="records"),
        "files": {
            "styles": str(styles_path.relative_to(ROOT)),
            "daily": str(daily_path.relative_to(ROOT)),
            "weekly": str(weekly_path.relative_to(ROOT)),
            "hot": str(hot_path.relative_to(ROOT)),
            "cold": str(cold_path.relative_to(ROOT)),
            "potential": str(potential_path.relative_to(ROOT)),
        },
    }

    summary_path = OUT_DIR / "summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({
        "summary": str(summary_path.relative_to(ROOT)),
        "accuracy_true_3class": report_true_3class["accuracy"],
        "macro_f1_true_3class": report_true_3class["macro_f1"],
        "accuracy_rule_3class": report_3class["accuracy"],
        "macro_f1_rule_3class": report_3class["macro_f1"],
        "latest_label_distribution": summary["latest_label_distribution"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
