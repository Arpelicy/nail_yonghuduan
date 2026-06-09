"""
nail trend XGBoost predictor
============================
三阶段逻辑自洽的趋势预测模块。

设计逻辑
--------
预测链路分三阶段，下一阶段的输入依赖上一阶段的输出：

  阶段 1 —— XGBoost_clf（当前状态分类器）
    输入：当前周 24 个原始指标（单周快照）
    目标：true_state（9 类细粒度标签）
    意义：这款现在处于什么状态？

  阶段 2 —— XGBoost_pred（趋势预测分类器，week+1 / week+2）
    输入：过去 4 周 × (24 原始指标 + 阶段1状态标签) + 斜率 + 加速度 = 148 维
    目标：next_true_state（下 1 周 / 下 2 周的 true_state）
    意义：基于状态转移轨迹，预测下周会是什么状态？

  阶段 3 —— XGBoost_reg（指标值回归器，week+1 / week+2）
    输入：同阶段2的 148 维特征
          + 阶段2输出的各状态预测概率（9维）← 关键：分类结果喂给回归
    目标：view_uv / want_uv / total_confirm_uv / tryon_result_uv 的下周值
    意义：知道方向（分类），再预测量级（回归），两者共享状态信息

为什么阶段3要把阶段2的概率作为特征？
  分类器已经学到了"4周轨迹 → 状态方向"的映射，
  这个概率（如 P(HotUp)=0.7）是对未来趋势强度的高度压缩表达，
  直接喂给回归器能帮助它区分：
    同样曝光量的款式，走热的下周会放量，走冷的会继续萎缩。

为什么不用简单线性外推预测指标？
  线性外推只看斜率，无法捕捉状态转折点。
  比如一款从 Stable 转向 HotUp 的款式，线性外推会低估放量幅度；
  而回归器知道 P(HotUp)=0.7，会相应调高预测值。

依赖
----
pip install xgboost scikit-learn pandas numpy

用法
----
# 先生成模拟数据
python scripts/simulate_nail_trends.py

# 再运行本预测脚本
python scripts/predict_trends_xgb.py

输出
----
outputs/simulation/xgb_trend_predictions.json
  per_style[style_id]:
    current_clf_label     阶段1：当前状态
    week1/week2:
      pred_label          阶段2：预测状态标签
      proba               阶段2：各状态概率分布
      direction/confidence 聚合方向和置信度
      metric_forecast:
        view_uv           阶段3：预测浏览量（周级）
        want_uv           阶段3：预测想做量
        total_confirm_uv  阶段3：预测确认量
        tryon_result_uv   阶段3：预测试戴成功量
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# ── 依赖检查 ─────────────────────────────────────────────────────────────────

try:
    import xgboost as xgb
    XGB_AVAILABLE = True
except ImportError:
    XGB_AVAILABLE = False

try:
    from sklearn.metrics import (
        accuracy_score, classification_report,
        mean_absolute_error, r2_score,
    )
    from sklearn.preprocessing import LabelEncoder
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False

if not XGB_AVAILABLE or not SKLEARN_AVAILABLE:
    print(
        "[predict_trends_xgb] 缺少依赖，请先执行：\n"
        "  pip install xgboost scikit-learn\n",
        file=sys.stderr,
    )
    sys.exit(1)

# ── 路径 ─────────────────────────────────────────────────────────────────────

ROOT    = Path(__file__).resolve().parents[1]
SIM_DIR = ROOT / "outputs" / "simulation"
WEEKLY_CSV = SIM_DIR / "simulated_nail_style_weekly_metrics.csv"
OUT_JSON   = SIM_DIR / "xgb_trend_predictions.json"

# ── 超参数 ───────────────────────────────────────────────────────────────────

WINDOW      = 4     # 历史窗口：4 周
HORIZON_1   = 1     # 短期预测：week+1
HORIZON_2   = 2     # 中期预测：week+2
TRAIN_RATIO = 0.70  # 时间顺序切分，防止标签泄漏
SEED        = 42

# 9 类细粒度标签（与 simulate_nail_trends.py 的 STATES 一致）
ALL_LABELS = [
    "HotUp", "Stable",
    "Cold_FirstLook", "Cold_Detail", "Cold_AfterTryon",
    "Cold_AfterWant", "ColdDown",
    "Potential", "Untested",
]

# 需要做回归预测的指标
METRIC_TARGETS = [
    "view_uv",
    "want_uv",
    "total_confirm_uv",
    "tryon_result_uv",
]

# 分类 / 回归共用的 XGBoost 基础超参
_XGB_CLF_BASE = dict(
    objective="multi:softprob",
    eval_metric="mlogloss",
    n_estimators=400,
    max_depth=6,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    min_child_weight=3,
    gamma=0.1,
    reg_alpha=0.1,
    reg_lambda=1.0,
    use_label_encoder=False,
    random_state=SEED,
    n_jobs=-1,
)

_XGB_REG_BASE = dict(
    objective="reg:squarederror",
    eval_metric="rmse",
    n_estimators=400,
    max_depth=6,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    min_child_weight=3,
    gamma=0.1,
    reg_alpha=0.1,
    reg_lambda=1.0,
    random_state=SEED,
    n_jobs=-1,
)

# 单周 24 个基础特征
BASE_FEATURE_COLS = [
    "view_uv", "detail_uv", "tryon_uv", "tryon_result_uv",
    "want_uv", "total_confirm_uv",
    "detail_rate", "tryon_rate", "want_rate",
    "direct_confirm_rate", "detail_confirm_rate",
    "tryon_want_rate", "tryon_confirm_rate",
    "want_to_confirm_rate", "total_confirm_rate",
    "view_uv_growth", "detail_uv_growth", "tryon_uv_growth",
    "want_uv_growth", "total_confirm_uv_growth",
    "confirm_after_tryon_uv_growth",
    "hot_score", "cold_risk_score", "growth_score",
]

# "冷门"标签集合，用于聚合方向
COLD_LABELS = {
    "Cold_FirstLook", "Cold_Detail",
    "Cold_AfterTryon", "Cold_AfterWant", "ColdDown",
}


# ── 工具函数 ──────────────────────────────────────────────────────────────────

def _safe(v) -> float:
    return float(v) if (v is not None and pd.notna(v)) else 0.0


def lin_slope(values: list) -> float:
    """最小二乘线性斜率，values 按时间升序（旧→新）。"""
    n = len(values)
    if n < 2:
        return 0.0
    xm = (n - 1) / 2
    ym = sum(values) / n
    num = sum((i - xm) * (v - ym) for i, v in enumerate(values))
    den = sum((i - xm) ** 2 for i in range(n))
    return num / den if den else 0.0


def acceleration(values: list) -> float:
    """近 2 步变化 vs 旧 2 步变化的差，需至少 4 个点。"""
    if len(values) < 4:
        return 0.0
    return (values[-1] - values[-2]) - (values[1] - values[0])


def time_split(df: pd.DataFrame, ratio: float = TRAIN_RATIO):
    """按 week_idx 时间顺序切分，保证测试集在训练集之后。"""
    max_w = int(df["week_idx"].max())
    split = int(max_w * ratio)
    return df[df["week_idx"] <= split], df[df["week_idx"] > split]


# ── 阶段 1：XGBoost_clf 当前状态分类器 ───────────────────────────────────────

def train_clf(week_df: pd.DataFrame):
    """
    输入：当前周 24 个原始指标
    目标：true_state
    返回：model, label_encoder, 带预测列的 week_df
    """
    df = week_df.dropna(subset=["true_state"]).copy()
    train_df, test_df = time_split(df)

    le = LabelEncoder()
    le.fit(ALL_LABELS)

    x_tr = train_df[BASE_FEATURE_COLS].fillna(0.0).to_numpy(dtype=float)
    x_te = test_df[BASE_FEATURE_COLS].fillna(0.0).to_numpy(dtype=float)
    y_tr = le.transform(train_df["true_state"])
    y_te = le.transform(test_df["true_state"])

    clf = xgb.XGBClassifier(num_class=len(le.classes_), **_XGB_CLF_BASE)
    clf.fit(x_tr, y_tr, eval_set=[(x_te, y_te)], verbose=False)

    y_pred = clf.predict(x_te)
    acc = accuracy_score(y_te, y_pred)
    rpt = classification_report(
        y_te, y_pred,
        labels=list(range(len(le.classes_))),
        target_names=le.classes_.tolist(),
        output_dict=True, zero_division=0,
    )
    report = {
        "model": "XGBoost_clf",
        "target": "true_state",
        "train_rows": len(train_df), "test_rows": len(test_df),
        "accuracy": round(float(acc), 4),
        "macro_f1": round(float(rpt.get("macro avg", {}).get("f1-score", 0)), 4),
        "per_label": [
            {"label": lbl,
             "precision": round(float(rpt.get(lbl, {}).get("precision", 0)), 4),
             "recall":    round(float(rpt.get(lbl, {}).get("recall", 0)), 4),
             "f1":        round(float(rpt.get(lbl, {}).get("f1-score", 0)), 4),
             "support":   int(rpt.get(lbl, {}).get("support", 0))}
            for lbl in le.classes_
        ],
    }

    # 全量预测，用于阶段2特征
    x_all = df[BASE_FEATURE_COLS].fillna(0.0).to_numpy(dtype=float)
    df = df.copy()
    df["clf_pred_label"] = le.inverse_transform(clf.predict(x_all))

    return clf, le, df, report


# ── 特征构建：4 周滚动窗口（阶段2和阶段3共用）────────────────────────────────

def build_rolling_features(clf_df: pd.DataFrame, le: LabelEncoder) -> pd.DataFrame:
    """
    特征构成（148 维）：
      ① 24 指标 × 4 周 lag = 96 维
      ② XGBoost_clf 状态标签 × 4 周 lag（编码为整数）= 4 维  ← 状态序列
      ③ 24 指标线性斜率 = 24 维
      ④ 24 指标近 2 步加速度 = 24 维

    训练目标：
      target_w1 / target_w2 = true_state 在 t+1 / t+2（分类目标）
      metric_w1_{col} / metric_w2_{col} = 各指标在 t+1 / t+2 的周级值（回归目标）
    """
    records = []

    for style_id, grp in clf_df.groupby("style_id", sort=False):
        grp = grp.sort_values("week_idx").reset_index(drop=True)
        n = len(grp)
        true_states = grp["true_state"].tolist()

        for i in range(WINDOW - 1, n):
            win = grp.iloc[i - WINDOW + 1: i + 1]
            cur = grp.iloc[i]

            feat: dict = {
                "style_id": style_id,
                "week_idx": int(cur["week_idx"]),
                "category": cur["category"],
                "price_level": cur["price_level"],
                "true_state": cur["true_state"],
                "current_clf_label": cur["clf_pred_label"],
            }

            # ① 24 指标 × 4 周 lag
            for lag in range(WINDOW):
                row = win.iloc[WINDOW - 1 - lag]
                for col in BASE_FEATURE_COLS:
                    feat[f"{col}_lag{lag}"] = _safe(row.get(col))

            # ② 状态序列（编码为整数，捕捉状态转移路径）
            for lag in range(WINDOW):
                row = win.iloc[WINDOW - 1 - lag]
                lbl = row.get("clf_pred_label", "Stable")
                feat[f"state_lag{lag}"] = int(
                    le.transform([lbl])[0]
                    if lbl in le.classes_
                    else le.transform(["Stable"])[0]
                )

            # ③ 4 周线性斜率
            for col in BASE_FEATURE_COLS:
                vals = [_safe(win.iloc[j].get(col)) for j in range(WINDOW)]
                feat[f"{col}_slope"] = lin_slope(vals)

            # ④ 近 2 步加速度
            for col in BASE_FEATURE_COLS:
                vals = [_safe(win.iloc[j].get(col)) for j in range(WINDOW)]
                feat[f"{col}_accel"] = acceleration(vals)

            # 分类目标
            feat["target_w1"] = true_states[i + 1] if i + 1 < n else None
            feat["target_w2"] = true_states[i + 2] if i + 2 < n else None

            # 回归目标（各指标下 1/2 周的绝对值）
            for col in METRIC_TARGETS:
                feat[f"metric_w1_{col}"] = (
                    _safe(grp.iloc[i + 1].get(col)) if i + 1 < n else None
                )
                feat[f"metric_w2_{col}"] = (
                    _safe(grp.iloc[i + 2].get(col)) if i + 2 < n else None
                )

            records.append(feat)

    return pd.DataFrame(records)


# ── 阶段 2：XGBoost_pred 趋势预测分类器 ──────────────────────────────────────

def train_pred(feature_df, target_col, le, feature_cols):
    """
    输入：148 维滚动窗口特征
    目标：next_true_state（t+1 或 t+2）
    返回：model, report, 全量概率矩阵（用于阶段3特征）
    """
    df = feature_df.dropna(subset=[target_col]).copy()
    train_df, test_df = time_split(df)

    x_tr = train_df[feature_cols].fillna(0.0).to_numpy(dtype=float)
    x_te = test_df[feature_cols].fillna(0.0).to_numpy(dtype=float)
    y_tr = le.transform(train_df[target_col])
    y_te = le.transform(test_df[target_col])

    model = xgb.XGBClassifier(num_class=len(le.classes_), **_XGB_CLF_BASE)
    model.fit(x_tr, y_tr, eval_set=[(x_te, y_te)], verbose=False)

    y_pred = model.predict(x_te)
    acc = accuracy_score(y_te, y_pred)
    rpt = classification_report(
        y_te, y_pred,
        labels=list(range(len(le.classes_))),
        target_names=le.classes_.tolist(),
        output_dict=True, zero_division=0,
    )
    horizon = target_col[-1]
    report = {
        "model": f"XGBoost_pred_w{horizon}",
        "target": target_col,
        "train_rows": len(train_df), "test_rows": len(test_df),
        "accuracy": round(float(acc), 4),
        "macro_f1": round(float(rpt.get("macro avg", {}).get("f1-score", 0)), 4),
        "per_label": [
            {"label": lbl,
             "precision": round(float(rpt.get(lbl, {}).get("precision", 0)), 4),
             "recall":    round(float(rpt.get(lbl, {}).get("recall", 0)), 4),
             "f1":        round(float(rpt.get(lbl, {}).get("f1-score", 0)), 4),
             "support":   int(rpt.get(lbl, {}).get("support", 0))}
            for lbl in le.classes_
        ],
    }

    # 全量概率矩阵，用于阶段3的特征
    x_all = df[feature_cols].fillna(0.0).to_numpy(dtype=float)
    proba_all = model.predict_proba(x_all)   # shape: (n_samples, n_classes)

    return model, report, df.index, proba_all


# ── 阶段 3：XGBoost_reg 指标值回归器 ────────────────────────────────────────

def train_regressors(
    feature_df: pd.DataFrame,
    feature_cols: list,
    pred_w1_idx, proba_w1: np.ndarray,
    pred_w2_idx, proba_w2: np.ndarray,
    le: LabelEncoder,
):
    """
    输入：148 维窗口特征 + 阶段2输出的状态概率（9维）= 157 维
    目标：view_uv / want_uv / total_confirm_uv / tryon_result_uv 的周级值
    返回：{metric: {w1: model, w2: model}}, reg_reports

    把阶段2的预测概率作为特征的原因：
      分类器已压缩了"4周轨迹→趋势方向"的信息，
      回归器直接复用这个压缩表达，而不是从原始特征重新学一遍，
      可以有效提升对趋势转折点的量级估计精度。
    """
    class_names = le.classes_.tolist()

    # 把阶段2概率矩阵对齐到 feature_df 的行（行索引一致）
    # pred_w1_idx / pred_w2_idx 是 train_pred 返回的 df.index
    proba_w1_df = pd.DataFrame(
        proba_w1, index=pred_w1_idx,
        columns=[f"pred_w1_p_{c}" for c in class_names],
    )
    proba_w2_df = pd.DataFrame(
        proba_w2, index=pred_w2_idx,
        columns=[f"pred_w2_p_{c}" for c in class_names],
    )

    models = {}
    reports = {}

    for metric in METRIC_TARGETS:
        models[metric] = {}
        reports[metric] = {}

        for horizon, target_col, proba_df, proba_cols in [
            (1, f"metric_w1_{metric}", proba_w1_df,
             [f"pred_w1_p_{c}" for c in class_names]),
            (2, f"metric_w2_{metric}", proba_w2_df,
             [f"pred_w2_p_{c}" for c in class_names]),
        ]:
            # 合并概率特征（inner join，只保留有概率的行）
            df = (
                feature_df
                .dropna(subset=[target_col])
                .join(proba_df, how="inner")
            )
            if df.empty:
                continue

            reg_feature_cols = feature_cols + proba_cols
            train_df, test_df = time_split(df)

            x_tr = train_df[reg_feature_cols].fillna(0.0).to_numpy(dtype=float)
            x_te = test_df[reg_feature_cols].fillna(0.0).to_numpy(dtype=float)
            y_tr = train_df[target_col].to_numpy(dtype=float)
            y_te = test_df[target_col].to_numpy(dtype=float)

            reg = xgb.XGBRegressor(**_XGB_REG_BASE)
            reg.fit(x_tr, y_tr, eval_set=[(x_te, y_te)], verbose=False)

            y_pred = reg.predict(x_te)
            mae = mean_absolute_error(y_te, y_pred)
            r2  = r2_score(y_te, y_pred)

            models[metric][f"w{horizon}"] = reg
            reports[metric][f"w{horizon}"] = {
                "model":      f"XGBoost_reg_w{horizon}_{metric}",
                "target":     target_col,
                "train_rows": len(train_df),
                "test_rows":  len(test_df),
                "mae":        round(float(mae), 2),
                "r2":         round(float(r2), 4),
            }

    return models, reports


# ── 推断：生成每款完整预测结果 ───────────────────────────────────────────────

def predict_per_style(
    feature_df: pd.DataFrame,
    clf,
    model_w1, model_w2,
    reg_models: dict,
    le: LabelEncoder,
    feature_cols: list,
) -> dict:
    """
    每款取最新 4 周完整历史的那一行，输出：
      current_clf_label   阶段1：当前状态
      week1 / week2:
        pred_label        阶段2：预测状态标签
        proba             阶段2：各状态概率
        direction         聚合方向
        confidence        最大类概率
        metric_forecast:
          view_uv / want_uv / total_confirm_uv / tryon_result_uv
                            阶段3：XGBoost 回归预测的指标值
    """
    latest = (
        feature_df
        .sort_values("week_idx")
        .groupby("style_id", sort=False)
        .last()
        .reset_index()
    )

    x = latest[feature_cols].fillna(0.0).to_numpy(dtype=float)
    proba_w1 = model_w1.predict_proba(x)
    proba_w2 = model_w2.predict_proba(x)
    classes  = le.classes_.tolist()

    # 用当前特征 + 阶段2概率 做回归推断
    proba_w1_df = pd.DataFrame(
        proba_w1, columns=[f"pred_w1_p_{c}" for c in classes]
    )
    proba_w2_df = pd.DataFrame(
        proba_w2, columns=[f"pred_w2_p_{c}" for c in classes]
    )
    reg_x_w1 = np.hstack([x, proba_w1_df.to_numpy()])
    reg_x_w2 = np.hstack([x, proba_w2_df.to_numpy()])

    def metric_forecast(reg_x, horizon_key):
        fc = {}
        for metric in METRIC_TARGETS:
            m = reg_models.get(metric, {}).get(horizon_key)
            if m is not None:
                preds = m.predict(reg_x)
                fc[metric] = [max(0, round(float(v))) for v in preds]
            else:
                fc[metric] = [0] * len(latest)
        return fc

    fc_w1 = metric_forecast(reg_x_w1, "w1")
    fc_w2 = metric_forecast(reg_x_w2, "w2")

    def build_horizon(proba_row, fc_by_metric, row_idx):
        proba_dict = {cls: round(float(p), 4) for cls, p in zip(classes, proba_row)}
        pred_label = classes[int(np.argmax(proba_row))]
        confidence = round(float(np.max(proba_row)), 4)
        p_hot       = float(proba_dict.get("HotUp", 0))
        p_cold      = sum(proba_dict.get(l, 0) for l in COLD_LABELS)
        p_potential = float(proba_dict.get("Potential", 0))
        p_stable    = float(proba_dict.get("Stable", 0)) + float(proba_dict.get("Untested", 0))
        direction   = max(
            [("hot", p_hot), ("cold", p_cold),
             ("potential", p_potential), ("stable", p_stable)],
            key=lambda t: t[1],
        )[0]
        return {
            "pred_label":   pred_label,
            "confidence":   confidence,
            "direction":    direction,
            "p_hot":        round(p_hot, 4),
            "p_cold":       round(p_cold, 4),
            "p_potential":  round(p_potential, 4),
            "p_stable":     round(p_stable, 4),
            "proba":        proba_dict,
            # 阶段3：XGBoost 回归预测的周级指标值
            "metric_forecast": {
                metric: fc_by_metric[metric][row_idx]
                for metric in METRIC_TARGETS
            },
        }

    result = {}
    for i, row in latest.iterrows():
        idx = latest.index.get_loc(i)
        result[row["style_id"]] = {
            "current_week":      int(row["week_idx"]),
            "current_clf_label": row["current_clf_label"],
            "true_state":        row["true_state"],
            "category":          row["category"],
            "price_level":       row["price_level"],
            "week1":             build_horizon(proba_w1[idx], fc_w1, idx),
            "week2":             build_horizon(proba_w2[idx], fc_w2, idx),
        }

    return result


# ── 主流程 ────────────────────────────────────────────────────────────────────

def main():
    if not WEEKLY_CSV.exists():
        print(
            f"[predict_trends_xgb] 找不到 {WEEKLY_CSV}\n"
            "请先运行：python scripts/simulate_nail_trends.py",
            file=sys.stderr,
        )
        sys.exit(1)

    # 1. 读数据
    print("[1/6] 读取 weekly metrics...")
    week_df = pd.read_csv(WEEKLY_CSV)
    print(f"      {len(week_df)} 行 | "
          f"{week_df['style_id'].nunique()} 款 | "
          f"{week_df['week_idx'].nunique()} 周")

    # 2. 阶段1：训练当前状态分类器
    print("\n[2/6] 阶段1 XGBoost_clf — 当前状态分类（目标: true_state）...")
    clf, le, clf_df, report_clf = train_clf(week_df)
    print(f"      accuracy={report_clf['accuracy']:.4f}  "
          f"macro_f1={report_clf['macro_f1']:.4f}")

    # 3. 构建 4 周滚动窗口特征
    print("\n[3/6] 构建 4 周滚动窗口特征（148维 + 回归目标）...")
    feature_df = build_rolling_features(clf_df, le)
    feature_cols = [
        c for c in feature_df.columns
        if c not in {
            "style_id", "week_idx", "category", "price_level",
            "true_state", "current_clf_label",
            "target_w1", "target_w2",
        } and not c.startswith("metric_w")
    ]
    print(f"      特征维度：{len(feature_cols)} | 样本数：{len(feature_df)}")

    # 4. 阶段2：训练趋势预测分类器（week+1 / week+2）
    print("\n[4/6] 阶段2 XGBoost_pred — 趋势预测分类（目标: next_true_state）...")
    model_w1, report_w1, idx_w1, proba_w1 = train_pred(
        feature_df, "target_w1", le, feature_cols
    )
    model_w2, report_w2, idx_w2, proba_w2 = train_pred(
        feature_df, "target_w2", le, feature_cols
    )
    print(f"      week+1: accuracy={report_w1['accuracy']:.4f}  "
          f"macro_f1={report_w1['macro_f1']:.4f}")
    print(f"      week+2: accuracy={report_w2['accuracy']:.4f}  "
          f"macro_f1={report_w2['macro_f1']:.4f}")

    # 5. 阶段3：训练指标值回归器（用阶段2概率作为特征）
    print("\n[5/6] 阶段3 XGBoost_reg — 指标回归（特征含阶段2状态概率）...")
    reg_models, reg_reports = train_regressors(
        feature_df, feature_cols,
        idx_w1, proba_w1,
        idx_w2, proba_w2,
        le,
    )
    for metric in METRIC_TARGETS:
        for h in ["w1", "w2"]:
            rpt = reg_reports.get(metric, {}).get(h, {})
            print(f"      {metric} {h}: MAE={rpt.get('mae', '-'):.1f}  "
                  f"R²={rpt.get('r2', '-'):.4f}")

    # 6. 推断并写出
    print("\n[6/6] 推断每款预测结果并写出...")
    per_style = predict_per_style(
        feature_df, clf, model_w1, model_w2, reg_models, le, feature_cols
    )

    dir_w1 = {"hot": 0, "cold": 0, "potential": 0, "stable": 0}
    dir_w2 = {"hot": 0, "cold": 0, "potential": 0, "stable": 0}
    for v in per_style.values():
        dir_w1[v["week1"]["direction"]] += 1
        dir_w2[v["week2"]["direction"]] += 1

    flat_reg_reports = {
        f"{m}_{h}": reg_reports[m][h]
        for m in METRIC_TARGETS
        for h in ["w1", "w2"]
        if h in reg_reports.get(m, {})
    }

    output = {
        "generated_at": pd.Timestamp.now().isoformat(),
        "design": {
            "pipeline": "XGBoost_clf → rolling_features(状态序列) → XGBoost_pred → XGBoost_reg(含pred概率)",
            "label_source": "true_state（三个阶段标签来源一致）",
            "window_weeks": WINDOW,
            "horizon_weeks": [HORIZON_1, HORIZON_2],
            "clf_feature_dims": len(BASE_FEATURE_COLS),
            "pred_feature_dims": len(feature_cols),
            "reg_feature_dims": len(feature_cols) + len(ALL_LABELS),
            "metric_targets": METRIC_TARGETS,
        },
        "model_report_clf":  report_clf,
        "model_report_w1":   report_w1,
        "model_report_w2":   report_w2,
        "model_report_reg":  flat_reg_reports,
        "week1_direction_counts": dir_w1,
        "week2_direction_counts": dir_w2,
        "per_style": per_style,
    }

    SIM_DIR.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"\n✓ 写出到：{OUT_JSON.relative_to(ROOT)}")
    print(json.dumps({
        "clf_accuracy":        report_clf["accuracy"],
        "clf_macro_f1":        report_clf["macro_f1"],
        "pred_w1_accuracy":    report_w1["accuracy"],
        "pred_w1_macro_f1":    report_w1["macro_f1"],
        "pred_w2_accuracy":    report_w2["accuracy"],
        "pred_w2_macro_f1":    report_w2["macro_f1"],
        "week1_direction_counts": dir_w1,
        "week2_direction_counts": dir_w2,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
