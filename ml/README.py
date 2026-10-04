"""ML feature set (Module 16): the explainable bridge between rules and learning.

4 normalised features in [0, 1], all "higher = better ride":

  overlap01   = overlap_pct / 100            (route share the rider uses)
  pickup01    = max(0, 1 - pickup_km / max_pickup_km)
  dropoff01   = max(0, 1 - dropoff_km / max_detour_km)
  time01      = 1 - min(1, time_diff_min / 120)  (0.6 when no time given)

Mirrored 1:1 in backend/app/services/ranker.py (stdlib-only) so training and
serving can never drift. Keep both files in sync when adding a feature.
"""
FEATURES = ("overlap01", "pickup01", "dropoff01", "time01")

TIME_WINDOW_MIN = 120.0


def time_to_feature(time_diff_min):
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
                     time_diff_min=None, max_pickup_km=3.0, max_detour_km=5.0):
    try:
        overlap01 = max(0.0, min(1.0, float(overlap_pct) / 100.0))
    except (TypeError, ValueError):
        overlap01 = 0.0
    try:
        pickup01 = max(0.0, 1.0 - float(pickup_km) / float(max_pickup_km))
    except (TypeError, ValueError, ZeroDivisionError):
        pickup01 = 0.0
    try:
        dropoff01 = max(0.0, 1.0 - float(dropoff_km) / float(max_detour_km))
    except (TypeError, ValueError, ZeroDivisionError):
        dropoff01 = 0.0
    pickup01 = max(0.0, min(1.0, pickup01))
    dropoff01 = max(0.0, min(1.0, dropoff01))
    return {
        "overlap01": round(overlap01, 4),
        "pickup01": round(pickup01, 4),
        "dropoff01": round(dropoff01, 4),
        "time01": round(time_to_feature(time_diff_min), 4),
    }

