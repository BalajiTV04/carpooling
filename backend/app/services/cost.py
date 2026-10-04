"""Cost estimation engine (Module 12): fuel-based totals + share policies.

PRINCIPLE (from the project brief): cost sharing must never turn the driver
into a business — the SUM of passenger shares can never exceed the actual
trip cost. Every policy below satisfies that cap by construction.

Total trip cost (fuel model):
    total = distance_km / mileage_kmpl × fuel_price
mileage comes from the vehicle (fallback DEFAULT_MILEAGE_KMPL); fuel price
from the trip's price_policy, else the per-fuel-type default in Settings.

Share policies (policy.mode on the trip):
- split_equal  (default): total / (1 + n_passengers). Everyone (driver
  included) pays an equal slice; the driver simply isn't collected. More
  passengers → everyone pays less. The classic carpool split.
- per_seat:    total × booking_seats / seats_offered. Price the seats, not
  the people: predictable for passengers, driver absorbs unsold seats.
- split_riders: total × booking_seats / total_confirmed_seats. Passengers
  split everything among themselves; small groups pay more.

Rounding: shares round to 2 dp (paise); the LAST confirmed booking absorbs
the rounding residue so Σ shares == round(total shares base, 2).
"""
from typing import Dict, List, Optional

from app.core.config import get_settings

POLICY_MODES = ("split_equal", "per_seat", "split_riders")


def resolve_fuel_price(fuel_type: Optional[str], policy: Optional[Dict]) -> float:
    """Trip policy price wins; else per-fuel default from Settings."""
    settings = get_settings()
    if policy and isinstance(policy.get("fuel_price"), (int, float)) \
            and policy["fuel_price"] > 0:
        return round(float(policy["fuel_price"]), 2)
    table = {
        "petrol": settings.FUEL_PRICE_PETROL,
        "diesel": settings.FUEL_PRICE_DIESEL,
        "cng": settings.FUEL_PRICE_CNG,
        "ev": settings.FUEL_PRICE_EV,
        "hybrid": settings.FUEL_PRICE_HYBRID,
    }
    return round(float(table.get((fuel_type or "petrol").lower(),
                                 settings.FUEL_PRICE_PETROL)), 2)


def total_fuel_cost(distance_km: Optional[float], mileage_kmpl: Optional[float],
                    fuel_price: float) -> Dict:
    """Fuel-only trip cost. Missing mileage -> project default (documented)."""
    settings = get_settings()
    km = float(distance_km or 0.0)
    mileage = float(mileage_kmpl) if mileage_kmpl else settings.DEFAULT_MILEAGE_KMPL
    litres = km / mileage if mileage > 0 else 0.0
    total = round(litres * fuel_price, 2)
    return {
        "distance_km": round(km, 2),
        "mileage_kmpl": mileage,
        "fuel_price": fuel_price,
        "litres": round(litres, 2),
        "total_cost": total,
        "per_km": round(total / km, 2) if km > 0 else 0.0,
    }


def _split_equal(total: float, n_passengers: int) -> float:
    """Equal slices among driver + passengers; driver's slice not collected."""
    if n_passengers <= 0:
        return 0.0
    return round(total / (1 + n_passengers), 2)


def _per_seat(total: float, seats_offered: int, booking_seats: int) -> float:
    if seats_offered <= 0:
        return 0.0
    return round(total * booking_seats / seats_offered, 2)


def _split_riders(total: float, booking_seats: int, confirmed_seats: int) -> float:
    if confirmed_seats <= 0:
        return 0.0
    return round(total * booking_seats / confirmed_seats, 2)


def passenger_share(mode: str, total_cost: float, seats_offered: int,
                    booking_seats: int, confirmed_seats: int,
                    n_passengers: int) -> float:
    """One booking's share under the policy. Caps at total_cost (no profit)."""
    if booking_seats <= 0 or total_cost <= 0:
        return 0.0
    if mode == "per_seat":
        share = _per_seat(total_cost, seats_offered, booking_seats)
    elif mode == "split_riders":
        share = _split_riders(total_cost, booking_seats, confirmed_seats)
    else:  # split_equal is the default
        share = _split_equal(total_cost, n_passengers)
    return round(min(share, round(total_cost, 2)), 2)


def distribute(mode: str, total_cost: float, seats_offered: int,
               confirmed: List[Dict]) -> Dict[str, float]:
    """Shares for every confirmed booking {booking_id: share}, with the last
    booking absorbing rounding residue so the sum is exact under
    split_riders/per_seat (split_equal sums below total by design)."""
    confirmed_seats = sum(int(b.get("seats", 0)) for b in confirmed)
    n = len(confirmed)
    out: Dict[str, float] = {}
    if not confirmed:
        return out
    raw = [passenger_share(mode, total_cost, seats_offered,
                           int(b.get("seats", 0)), confirmed_seats, n)
           for b in confirmed]
    if mode in ("per_seat", "split_riders"):
        target = round(min(total_cost, sum(raw)), 2)
        drift = round(target - sum(raw), 2)
        if abs(drift) >= 0.01:
            raw[-1] = round(raw[-1] + drift, 2)
    for b, share in zip(confirmed, raw):
        out[str(b.get("id"))] = share
    return out