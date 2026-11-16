"""Cost calculation engine for minimum-detour travel contributions.

Complies with non-commercial ride-sharing guidelines:
- Never label as "taxi fare" -> always "Estimated Travel Contribution"
- Split policies: EQUAL_SPLIT or FULL_PASSENGER_SHARE
- Optional detour fuel cost inclusion via INCLUDE_DETOUR_COST
"""
from typing import Dict, Optional


def compute_detour_contribution(
    passenger_distance_km: float,
    detour_km: float = 0.0,
    mileage_kmpl: Optional[float] = 15.0,
    fuel_price_per_litre: float = 100.0,
    occupants: int = 2,
    policy: str = "EQUAL_SPLIT",
    include_detour_cost: bool = False,
) -> Dict:
    """Compute the passenger's travel contribution based on shared fuel.

    Formula:
      fuel_litres  = passenger_distance_km / vehicle.mileage_kmpl
      fuel_cost    = fuel_litres * FUEL_PRICE_PER_LITRE
      contribution = fuel_cost / occupants (EQUAL_SPLIT)
                   = fuel_cost             (FULL_PASSENGER_SHARE)

    If include_detour_cost=True, detour fuel cost is added to the fuel_cost.
    Rounded to 2 decimal places / nearest rupee.
    Label: "Estimated Travel Contribution", never "taxi fare".

    Example:
      12 km @ 20 kmpl @ Rs 100/l -> fuel_cost = Rs 60;
      2 occupants (EQUAL_SPLIT) -> Rs 30.
    """
    km = float(passenger_distance_km or 0.0)
    mileage = float(mileage_kmpl) if mileage_kmpl and float(mileage_kmpl) > 0 else 15.0
    price = float(fuel_price_per_litre)
    litres = km / mileage if mileage > 0 else 0.0
    fuel_cost = round(litres * price, 2)

    if include_detour_cost and detour_km:
        detour_litres = float(detour_km) / mileage if mileage > 0 else 0.0
        fuel_cost = round(fuel_cost + detour_litres * price, 2)

    occupants = max(int(occupants), 1)
    if str(policy).upper() == "FULL_PASSENGER_SHARE":
        share = fuel_cost
    else:  # EQUAL_SPLIT
        share = round(fuel_cost / occupants, 2)

    return {
        "passenger_distance_km": round(km, 2),
        "detour_km": round(float(detour_km), 2),
        "mileage_kmpl": round(mileage, 2),
        "fuel_price_per_litre": price,
        "fuel_litres": round(litres, 2),
        "fuel_cost": fuel_cost,
        "include_detour_cost": include_detour_cost,
        "policy": str(policy).upper(),
        "occupants": occupants,
        "estimated_contribution": round(share, 2),
        "label": "Estimated Travel Contribution",
    }
