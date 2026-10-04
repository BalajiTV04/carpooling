"""Train + compare rankers (Module 16).

Models: logistic regression -> random forest -> XGBoost.
Metric: ROC-AUC on a stratified 80/20 split (seed 7).

The DEPLOYED ranker is logistic regression exported as plain JSON weights
(`ml/artifacts/ranker.json`) — a sigmoid over the 4 features — so the backend
serves it with stdlib only. RF/XGBoost run for the comparison table (report
evidence), not for serving.

Usage (from repo root):
    python ml/make_dataset.py --n 4000 --seed 7
    python ml/train_ranker.py [--csv ml/data/matches.csv]

Writes ml/artifacts/ranker.json:
    {"features": [...], "weights": [...], "bias": b0,
     "auc": {"logreg":..,"rf":..,"xgb":..}, "baseline_weights": {...},
     "trained_at": iso, "n_rows": N}
"""
import datetime
import json
import os
import sys

FEATURES = ("overlap01", "pickup01", "dropoff01", "time01")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_CSV = os.path.join(REPO_ROOT, "ml", "data", "matches.csv")
DEFAULT_OUT = os.path.join(REPO_ROOT, "ml", "artifacts", "ranker.json")


def load_csv(path):
    import pandas as pd
    df = pd.read_csv(path)
    missing = [c for c in list(FEATURES) + ["label"] if c not in df.columns]
    if missing:
        raise SystemExit("csv missing columns: {}".format(missing))
    return df


def main():
    csv = sys.argv[sys.argv.index("--csv") + 1] if "--csv" in sys.argv else DEFAULT_CSV
    if not os.path.isabs(csv):
        cand = os.path.join(REPO_ROOT, csv)
        if os.path.exists(cand):
            csv = cand
    if not os.path.exists(csv):
        if os.path.exists(DEFAULT_CSV):
            csv = DEFAULT_CSV
        else:
            raise SystemExit("dataset not found: {} (run python ml/make_dataset.py first)".format(csv))
    df = load_csv(csv)
    X = df[list(FEATURES)].values
    y = df["label"].values

    from sklearn.ensemble import RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import roc_auc_score
    from sklearn.model_selection import train_test_split

    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=7, stratify=y)

    logreg = LogisticRegression(max_iter=1000)
    logreg.fit(Xtr, ytr)
    auc_lr = float(roc_auc_score(yte, logreg.predict_proba(Xte)[:, 1]))

    rf = RandomForestClassifier(n_estimators=200, random_state=7, n_jobs=-1)
    rf.fit(Xtr, ytr)
    auc_rf = float(roc_auc_score(yte, rf.predict_proba(Xte)[:, 1]))

    try:
        from xgboost import XGBClassifier
        xgb = XGBClassifier(n_estimators=200, max_depth=3, learning_rate=0.1,
                            subsample=0.9, colsample_bytree=0.9, random_state=7,
                            n_jobs=-1, eval_metric="logloss")
        xgb.fit(Xtr, ytr)
        auc_xgb = float(roc_auc_score(yte, xgb.predict_proba(Xte)[:, 1]))
    except Exception as exc:  # keep the pipeline green without xgboost
        print("xgboost skipped: {}".format(exc))
        auc_xgb = None

    weights = [round(float(c), 4) for c in logreg.coef_[0]]
    bias = round(float(logreg.intercept_[0]), 4)
    artifact = {
        "features": list(FEATURES),
        "weights": weights,
        "bias": bias,
        "auc": {"logreg": round(auc_lr, 4), "rf": round(auc_rf, 4), "xgb": auc_xgb if auc_xgb is None else round(auc_xgb, 4)},
        "baseline_weights": {"overlap": 0.45, "pickup": 0.25, "dropoff": 0.15, "time": 0.15},
        "trained_at": datetime.datetime.utcnow().isoformat() + "Z",
        "n_rows": int(len(df)),
    }
    os.makedirs(os.path.dirname(DEFAULT_OUT), exist_ok=True)
    with open(DEFAULT_OUT, "w") as f:
        json.dump(artifact, f, indent=2)
    table = "logreg AUC={:.3f} | rf AUC={:.3f}".format(auc_lr, auc_rf)
    if auc_xgb is not None:
        table += " | xgb AUC={:.3f}".format(auc_xgb)
    print(table)
    print("wrote {} weights={} bias={}".format(DEFAULT_OUT, weights, bias))


if __name__ == "__main__":
    main()
