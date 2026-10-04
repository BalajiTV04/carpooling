"""AI ranker (Module 16): learned re-ranking over feasible matches only.

DESIGN (viva): hard gates NEVER move (Module 9). The model only RE-ORDERS
feasible candidates. Serving is stdlib-only: training (sklearn/XGBoost)
exports plain JSON weights (ml/artifacts/ranker.json); this module applies a
sigmoid. Missing artifact -> rule-baseline fallback so search never breaks.
"""
import json
import math
from pathlib import Path
from typing import Dict, List, Optional

FEATURES = ("overlap01", "pickup01", "dropoff01", "time01")
TIME_WINDOW_MIN = 120.0
BLEND_RULE = 0.5
BASELINE_W = (0.45, 0.25, 0.15, 0.15)

_cached: Dict = {}
_cached_mtime: float = -2.0


def _artifact_path() -> Path:
    root = Path(__file__).resolve().parents[3]
    return root / "ml" / "artifacts" / "ranker.json"


def load_artifact() -> Optional[Dict]:
    global _cached, _cached_mtime
    try:
        mtime = _artifact_path().stat().st_mtime
    except OSError:
        return None
    if _cached and _cached_mtime == mtime:
        return _cached
    try:
        doc = json.loads(_artifact_path().read_text())
        if not isinstance(doc.get("weights"), list) or len(doc["weights"]) != 4:
            return None
        _cached = doc
        _cached_mtime = mtime
        return doc
    except (OSError, ValueError, KeyError):
        return None


def model_info() -> Dict:
    art = load_artifact()
    if art is None:
        return {"model": "rule-fallback", "features": list(FEATURES),
                "weights": None, "bias": None, "auc": None}
    return {"model": "logreg", "features": list(art.get("features", FEATURES)),
            "weights": list(art["weights"]), "bias": art.get("bias"),
            "auc": art.get("auc"), "trained_at": art.get("trained_at"),
            "n_rows": art.get("n_rows")}


def time_to_feature(time_diff_min: Optional[float]) -> float:
    if time_diff_min is None:
        return 0.6
    try:
        t = float(time_diff_min)
    except (TypeError, ValueError):
        return 0.6
    if t < 0:
        t = 0.0
    return max(0.0, 1.0 - min(1.0, t / TIME_WINDOW_MIN))


def extract_features(overlap_pct=0.0, pickup_km=0.0, dropoff_km=0.0,
                     time_diff_min=None, max_pickup_km=3.0,
                     max_detour_km=5.0) -> Dict[str, float]:
    try:
        o = max(0.0, min(1.0, float(overlap_pct) / 100.0))
    except (TypeError, ValueError):
        o = 0.0
    try:
        p = max(0.0, min(1.0, 1.0 - float(pickup_km) / float(max_pickup_km)))
    except (TypeError, ValueError, ZeroDivisionError):
        p = 0.0
    try:
        d = max(0.0, min(1.0, 1.0 - float(dropoff_km) / float(max_detour_km)))
    except (TypeError, ValueError, ZeroDivisionError):
        d = 0.0
    return {"overlap01": round(o, 4), "pickup01": round(p, 4),
            "dropoff01": round(d, 4),
            "time01": round(time_to_feature(time_diff_min), 4)}


def _sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


def ai_score_from_features(feats: Dict[str, float],
                           weights: Optional[List[float]] = None,
                           bias: Optional[float] = None) -> float:
    if weights is None or bias is None:
        art = load_artifact()
        if art is not None:
            weights = list(art["weights"])
            bias = float(art.get("bias", 0.0))
    if weights is None:
        s = sum(w * float(feats.get(f, 0.0)) for w, f in zip(BASELINE_W, FEATURES))
        return round(s * 100.0, 1)
    z = float(bias) + sum(float(w) * float(feats.get(f, 0.0))
                          for w, f in zip(weights, FEATURES))
    return round(_sigmoid(z) * 100.0, 1)


def contributions(feats: Dict[str, float],
                  weights: Optional[List[float]] = None) -> Dict[str, float]:
    if weights is None:
        art = load_artifact()
        weights = list(art["weights"]) if art is not None else list(BASELINE_W)
    return {f: round(float(w) * float(feats.get(f, 0.0)), 3)
            for w, f in zip(weights, FEATURES)}


def score_match(overlap_pct=0.0, pickup_km=0.0, dropoff_km=0.0,
                time_diff_min=None, rule_score=None,
                max_pickup_km=3.0, max_detour_km=5.0) -> Dict:
    feats = extract_features(overlap_pct, pickup_km, dropoff_km, time_diff_min,
                             max_pickup_km, max_detour_km)
    ai = ai_score_from_features(feats)
    info = model_info()
    out: Dict = {"features": feats, "ai_score": ai,
                 "contributions": contributions(feats),
                 "model": info["model"], "auc": info.get("auc")}
    if rule_score is not None:
        try:
            r = float(rule_score)
        except (TypeError, ValueError):
            r = 0.0
        out["rule_score"] = round(r, 1)
        out["blended"] = round(BLEND_RULE * r + (1.0 - BLEND_RULE) * ai, 1)
    return out


def enrich_match(m: Dict, max_pickup_km=3.0, max_detour_km=5.0) -> Dict:
    """Attach AI fields to a Module 9 match dict. Gated rides stay None."""
    if not m.get("feasible"):
        m["ai_score"] = None
        m["ai_model"] = model_info()["model"]
        return m
    s = score_match(m.get("overlap_pct", 0.0), m.get("pickup_km", 0.0),
                    m.get("dropoff_km", 0.0), m.get("time_diff_min"),
                    rule_score=m.get("score"), max_pickup_km=max_pickup_km,
                    max_detour_km=max_detour_km)
    m["ai_score"] = s["ai_score"]
    m["ai_features"] = s["features"]
    m["ai_contributions"] = s["contributions"]
    m["ai_model"] = s["model"]
    m["blended"] = s.get("blended")
    return m

