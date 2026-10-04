"""Impact analytics (Module 24): pure, no DB, no network.

Closes the last two unbuilt items in the synopsis's PROPOSED SYSTEM list —
Demand Forecasting and Sustainability Analytics — plus the Model Evaluation
metrics it asks for (MAE/RMSE, and precision/recall/F1 "where matching
outcomes can be labelled"). Three independent jobs, all pure so the report and
the console can never quote different numbers.

1. SUSTAINABILITY — the counterfactual is *this rider would otherwise have
   travelled alone over their own leg*. Using the Module 13 `segments` (which
   already say which bookings occupy which leg) we can measure that per rider:

       solo_km   = Σ rider_km(b)          # n separate solo journeys
       shared_km = actual driven distance # 1 shared journey
       km_avoided = solo_km - shared_km

   This is deliberately NOT clamped, and the awkward cases stay visible:
   a single rider with a pickup detour yields vehicles_avoided = 0 and a
   NEGATIVE km_avoided — the driver really did drive further for no vehicle
   removed. Reporting that honestly is the point. `unfavourable_rides` counts
   riders whose share cost MORE than going alone, which is the fairness check.

   CO2 factors are indicative direct-emission figures (kg CO2 per vehicle-km)
   and live here as constants, exactly like SPEED_LIMIT_KMPH (M18) and
   OFF_ROUTE_M (M17) live in their own modules. EV is 0.0 because this counts
   TAILPIPE emissions only; grid intensity is a different question and is
   called out in docs/module-24-analytics.md rather than silently mixed in.

2. DEMAND — trips are bucketed by (weekday, hour of day) and predicted with a
   Laplace-shrunk mean toward the global average, so a bucket seen twice cannot
   claim certainty. Honest baseline, not a trained model: with a small demo
   dataset anything fancier would be theatre.

3. EVALUATION — Module 16 ranked matches on a synthetic dataset; this measures
   whether ranking actually correlated with rides happening, on REAL bookings.
   A booking is a positive when the ride occurred (completed/confirmed) and a
   negative when it fell through (rejected/cancelled). AUC via the rank-sum
   (Mann-Whitney) identity, so there is no new dependency.
"""
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

# Indicative direct CO2 emissions, kg per vehicle-kilometre.
CO2_KG_PER_KM = {
    "petrol": 0.171,
    "diesel": 0.168,
    "cng": 0.054,
    "hybrid": 0.100,
    "ev": 0.0,  # tailpipe only; grid intensity deliberately excluded
}
DEFAULT_MILEAGE_KMPL = 15.0
DEFAULT_FUEL_PRICE = 104.5
# Laplace shrinkage strength: a bucket with n observations is pulled toward the
# global mean by k pseudo-observations. k=3 means "3 rides is half a belief".
SHRINK_K = 3.0
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
# A ride "happened" for evaluation purposes.
POSITIVE_STATUSES = ("completed", "confirmed")
NEGATIVE_STATUSES = ("rejected", "cancelled")


def _num(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return float(default)
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _round(value: float, places: int = 2) -> float:
    return round(float(value), places)


# --------------------------------------------------------------------------
# 1. sustainability
# --------------------------------------------------------------------------

def ride_impact(ride: Dict) -> Dict:
    """One completed trip -> its own impact row. Pure.

    `ride` is prepared by the API: {fuel_type, mileage_kmpl, fuel_price,
    actual_km, riders:[{booking_id, rider_km, seats, cost_share}], route_km,
    detour_km}. Actual distance comes from the segments sum; a fallback to
    pickup->dropoff distance is applied by the caller.
    """
    riders = list(ride.get("riders") or [])
    mileage = _num(ride.get("mileage_kmpl"), 0.0) or DEFAULT_MILEAGE_KMPL
    fuel_price = _num(ride.get("fuel_price"), 0.0) or DEFAULT_FUEL_PRICE
    fuel_type = str(ride.get("fuel_type") or "petrol").lower()
    factor = CO2_KG_PER_KM.get(fuel_type, CO2_KG_PER_KM["petrol"])
    actual_km = _num(ride.get("actual_km"), 0.0)

    solo_km = 0.0
    solo_cost = 0.0
    paid = 0.0
    seats = 0
    unfavourable = 0
    per_rider = []
    for r in riders:
        leg = _num(r.get("rider_km"), 0.0)
        share = _num(r.get("cost_share"), 0.0)
        seat_count = int(_num(r.get("seats"), 1) or 1)
        alone_cost = leg / mileage * fuel_price if mileage > 0 else 0.0
        saved = alone_cost - share
        solo_km += leg
        solo_cost += alone_cost
        paid += share
        seats += seat_count
        if saved < -0.01:  # allow a paisa of rounding
            unfavourable += 1
        per_rider.append({
            "booking_id": r.get("booking_id"),
            "rider_km": _round(leg, 2),
            "seats": seat_count,
            "cost_share": _round(share, 2),
            "solo_cost": _round(alone_cost, 2),
            "saved": _round(saved, 2),
        })

    n_riders = len(riders)
    # The driver's own journey happens in BOTH worlds, so it cancels out.
    # What sharing actually changes:
    #   - it removes each rider's SEPARATE car (one less vehicle per rider);
    #   - it adds only the pickup detours to the driver's trip.
    # So the honest comparison is riders' solo km against the EXTRA distance the
    # shared trip costs, not against the whole driven route. Clamping the extra
    # distance at 0 guards fixtures where actual < route (a shortcut).
    route_km = _num(ride.get("route_km"), 0.0)
    extra_km = _num(ride.get("detour_km"), 0.0)
    if extra_km <= 0:
        extra_km = max(0.0, actual_km - route_km)
    km_avoided = solo_km - extra_km
    return {
        "trip_id": ride.get("trip_id"),
        "fuel_type": fuel_type,
        "route_km": _round(route_km, 2),
        "actual_km": _round(actual_km, 2),
        "extra_km": _round(extra_km, 2),   # the cost of doing the pickups
        "detour_km": _round(_num(ride.get("detour_km"), 0.0), 2),
        "riders": n_riders,
        "seats_shared": seats,
        "solo_km": _round(solo_km, 2),
        "shared_km": _round(actual_km, 2),
        "km_avoided": _round(km_avoided, 2),
        # one solo vehicle eliminated per rider (0 riders -> 0 cars)
        "vehicles_avoided": n_riders,
        "fuel_saved_l": _round(km_avoided / mileage, 2) if mileage > 0 else 0.0,
        "co2_avoided_kg": _round(km_avoided * factor, 2),
        "solo_cost": _round(solo_cost, 2),
        "paid": _round(paid, 2),
        "cost_saved": _round(solo_cost - paid, 2),
        "unfavourable_riders": unfavourable,
        "riders_detail": per_rider,
    }


def sustainability(rides: Iterable[Dict]) -> Dict:
    """Platform totals + per-fuel breakdown over every completed ride."""
    rows = [ride_impact(r) for r in (rides or [])]
    by_fuel: Dict[str, Dict] = {}
    for row in rows:
        bucket = by_fuel.setdefault(row["fuel_type"], {
            "trips": 0, "km_avoided": 0.0, "co2_avoided_kg": 0.0,
            "vehicles_avoided": 0, "cost_saved": 0.0})
        bucket["trips"] += 1
        bucket["km_avoided"] = _round(bucket["km_avoided"] + row["km_avoided"])
        bucket["co2_avoided_kg"] = _round(
            bucket["co2_avoided_kg"] + row["co2_avoided_kg"])
        bucket["vehicles_avoided"] += row["vehicles_avoided"]
        bucket["cost_saved"] = _round(bucket["cost_saved"] + row["cost_saved"])

    def total(field):
        return _round(sum(r[field] for r in rows))

    total_km = total("km_avoided")
    return {
        "trips": len(rows),
        "riders": sum(r["riders"] for r in rows),
        "seats_shared": sum(r["seats_shared"] for r in rows),
        "solo_km": total("solo_km"),
        "shared_km": total("shared_km"),
        "km_avoided": total_km,
        "vehicles_avoided": sum(r["vehicles_avoided"] for r in rows),
        "fuel_saved_l": total("fuel_saved_l"),
        "co2_avoided_kg": total("co2_avoided_kg"),
        "cost_saved": total("cost_saved"),
        "paid_total": total("paid"),
        "solo_cost_total": total("solo_cost"),
        "unfavourable_riders": sum(r["unfavourable_riders"] for r in rows),
        "by_fuel": by_fuel,
        "emission_basis": "direct (tailpipe) CO2 only; EV = 0 by construction",
        "note": "Counterfactual: each rider would have travelled alone over their "
                "own leg. A negative km_avoided is real — a pickup detour can "
                "make one shared trip cost more distance than it saves.",
    }


# --------------------------------------------------------------------------
# 2. demand
# --------------------------------------------------------------------------

def bucket_key(when) -> Optional[str]:
    """(weekday, hour) -> 'Mon-09'. None when the date is unusable."""
    if when is None:
        return None
    try:
        return "{}-{:02d}".format(WEEKDAYS[int(when.weekday())], int(when.hour))
    except (AttributeError, IndexError, TypeError, ValueError):
        return None


def all_buckets() -> List[str]:
    return ["{}-{:02d}".format(d, h) for d in WEEKDAYS for h in range(24)]


def _counts(keys: Sequence[str]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for k in keys:
        if k:
            out[k] = out.get(k, 0) + 1
    return out


def predict_bucket(count: int, global_mean: float,
                   k: float = SHRINK_K) -> float:
    """Shrunk mean: (n + k·μ) / (n + k). The core of the forecast."""
    n = _num(count, 0.0)
    return (n + k * global_mean) / (n + k)


def demand_forecast(depart_times: Iterable, horizon_days: int = 14,
                    k: float = SHRINK_K) -> Dict:
    """Predicted trips per (weekday, hour) slot over the next `horizon_days`.

    Returns the busiest and quietest slots so the console can say "supply is
    thin here" — which is the actionable half of forecasting.
    """
    keys = [b for b in (bucket_key(t) for t in depart_times or []) if b]
    counts = _counts(keys)
    n = len(keys)
    global_mean = (n / 168.0) if n else 0.0
    rows = []
    for b in all_buckets():
        observed = counts.get(b, 0)
        per_day = predict_bucket(observed, global_mean, k)
        rows.append({
            "bucket": b, "weekday": b.split("-")[0],
            "hour": int(b.split("-")[1]),
            "observed": observed,
            "per_day": round(per_day, 3),
            "horizon_total": round(per_day * horizon_days, 1),
        })
    ranked = sorted(rows, key=lambda r: (-r["observed"], r["bucket"]))
    return {
        "samples": n,
        "horizon_days": horizon_days,
        "shrink_k": k,
        "global_mean_per_bucket": round(global_mean, 4),
        "busiest": ranked[:8],
        "quietest": sorted(rows, key=lambda r: (r["observed"], r["bucket"]))[:8],
        "buckets": rows,
        "method": "Laplace-shrunk (weekday, hour) mean toward the global "
                  "average — a transparent baseline, not a trained model.",
    }


def backtest(depart_times: Iterable, holdout: float = 0.25,
             k: float = SHRINK_K) -> Dict:
    """Time-split MAE/RMSE: train on the earlier days, predict the later ones.

    The split is by DAY (never randomly) so no future information leaks
    backwards — the whole point of the MAE/RMSE the synopsis asks for.
    """
    times = sorted(t for t in (depart_times or []) if t is not None)
    if len(times) < 4:
        return {"n_train": len(times), "n_test": 0, "mae": None, "rmse": None,
                "note": "not enough history to backtest (need 4+ departures)"}
    n_test_days = max(1, int(round(len({t.date() for t in times}) * holdout)))
    all_days = sorted({t.date() for t in times})
    cutoff = all_days[min(n_test_days, len(all_days) - 1)]
    train = [t for t in times if t.date() < cutoff]
    test = [t for t in times if t.date() >= cutoff]
    if not train or not test:
        return {"n_train": len(train), "n_test": len(test),
                "mae": None, "rmse": None,
                "note": "degenerate split — widen the date range"}
    train_days = len({t.date() for t in train})
    test_days = len({t.date() for t in test})
    train_counts = _counts([b for b in (bucket_key(t) for t in train) if b])
    global_mean = (len(train) / 168.0) if train else 0.0
    test_counts = _counts([b for b in (bucket_key(t) for t in test) if b])
    errors = []
    for b in all_buckets():
        rate = predict_bucket(train_counts.get(b, 0), global_mean, k) * test_days
        actual = test_counts.get(b, 0)
        errors.append(rate - actual)
    out = regression_metrics(errors)
    out["n_train"] = len(train)
    out["n_test"] = len(test)
    out["train_days"] = train_days
    out["test_days"] = test_days
    out["cutoff"] = cutoff.isoformat()
    return out


# --------------------------------------------------------------------------
# 3. evaluation
# --------------------------------------------------------------------------

def regression_metrics(errors: Iterable[float]) -> Dict:
    """MAE / RMSE from a list of errors. Empty input -> None, never a crash."""
    vals = [_num(e) for e in (errors or [])]
    if not vals:
        return {"n": 0, "mae": None, "rmse": None, "n_train": 0, "n_test": 0}
    n = len(vals)
    mae = sum(abs(v) for v in vals) / n
    mse = sum(v * v for v in vals) / n
    return {"n": n, "n_train": n, "n_test": n,
            "mae": round(mae, 3), "rmse": round(mse ** 0.5, 3)}


def auc_score(pairs: Iterable[Tuple[float, bool]]) -> Optional[float]:
    """ROC-AUC by the rank-sum (Mann-Whitney) identity, ties averaged.

    0.5 = no better than chance, 1.0 = perfect ordering. Returns None when one
    class is missing, because an AUC is then meaningless rather than 0 or 1.
    """
    items = [(_num(s), bool(l)) for s, l in (pairs or [])]
    pos = sum(1 for _, l in items if l)
    neg = len(items) - pos
    if not pos or not neg:
        return None
    # average ranks over ties
    order = sorted(range(len(items)), key=lambda i: items[i][0])
    ranks = [0.0] * len(items)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and items[order[j + 1]][0] == items[order[i]][0]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        for t in range(i, j + 1):
            ranks[order[t]] = avg
        i = j + 1
    rank_sum = sum(r for r, (_, l) in zip(ranks, items) if l)
    return round((rank_sum - pos * (pos + 1) / 2.0) / (pos * neg), 4)


def confusion(pairs: Iterable[Tuple[float, bool]], threshold: float) -> Dict:
    """TP/FP/FN/TN at one threshold, plus precision/recall/F1/accuracy."""
    tp = fp = fn = tn = 0
    for score, label in pairs or []:
        predicted = _num(score) >= threshold
        if predicted and label:
            tp += 1
        elif predicted and not label:
            fp += 1
        elif not predicted and label:
            fn += 1
        else:
            tn += 1
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    total = tp + fp + fn + tn
    return {"threshold": round(_num(threshold), 3), "tp": tp, "fp": fp,
            "fn": fn, "tn": tn,
            "precision": round(precision, 4), "recall": round(recall, 4),
            "f1": round(f1, 4),
            "accuracy": round((tp + tn) / total, 4) if total else 0.0}


def _median(values: List[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def label_bookings(bookings: Iterable[Dict]) -> List[Tuple[bool, str]]:
    """(is_positive, status) for bookings that actually reached an outcome."""
    out = []
    for b in bookings or []:
        status = str(b.get("status") or "")
        if status in POSITIVE_STATUSES:
            out.append((True, status))
        elif status in NEGATIVE_STATUSES:
            out.append((False, status))
    return out


def matching_metrics(bookings: Iterable[Dict], field: str = "match_score") -> Dict:
    """Precision/recall/F1 + AUC for ONE score field on real booking outcomes.

    Threshold defaults to the median score, so the operating point is derived
    from the data rather than hand-picked to flatter the model.
    """
    rows = [b for b in (bookings or []) if b.get(field) is not None
            and str(b.get("status") or "") in POSITIVE_STATUSES
            + NEGATIVE_STATUSES]
    pairs = [(_num(b.get(field)), str(b.get("status")) in POSITIVE_STATUSES)
             for b in rows]
    if not pairs:
        return {"field": field, "n": 0, "auc": None, "f1": None,
                "note": "no scored bookings with a known outcome yet"}
    positives = sum(1 for _, l in pairs if l)
    out = confusion(pairs, _median([s for s, _ in pairs]))
    out.update({"field": field, "n": len(pairs), "positives": positives,
                "negatives": len(pairs) - positives, "auc": auc_score(pairs)})
    return out


def evaluation(bookings: Iterable[Dict]) -> Dict:
    """Rule score (M9) vs AI score (M16) head to head, on the same bookings."""
    rows = list(bookings or [])
    rule = matching_metrics(rows, "match_score")
    ai = matching_metrics(rows, "ai_score")
    comparison = None
    if rule.get("auc") is not None and ai.get("auc") is not None:
        winner = "ai" if ai["auc"] > rule["auc"] else (
            "rule" if rule["auc"] > ai["auc"] else "tie")
        comparison = {"winner": winner,
                      "delta_auc": round(ai["auc"] - rule["auc"], 4)}
    from app.services.ranker import model_info

    info = model_info()
    return {
        "samples": len(rows),
        "labelled": rule.get("n", 0) or ai.get("n", 0),
        "rule_score": rule,
        "ai_score": ai,
        "comparison": comparison,
        "offline_ranker_auc": info.get("auc"),
        "deployed_model": info.get("model"),
        "label_definition": "positive = the ride happened (completed/confirmed); "
                            "negative = it fell through (rejected/cancelled)",
        "caveat": "Retrospective and selection-biased: we only observe outcomes "
                  "for matches that were actually booked, so this measures "
                  "'did good-looking matches survive?', not 'did the ranker "
                  "cause the ride?'. Compare with the offline AUC, which is "
                  "measured on the labelled synthetic set instead.",
    }


