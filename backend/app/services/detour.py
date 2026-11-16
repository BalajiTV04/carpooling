"""Minimum-detour pickup optimisation for ride search (Facade/Service).

Delegates to app.modules.optimization for the core algorithm and geo calculations.
Maintained here for backward compatibility across existing services and tests.
"""
from app.modules.optimization.service import (
    DetourConfig,
    DetourDrop,
    DetourPickup,
    DetourResult,
    _empty_result,
    _minutes,
    evaluate_detour,
)
from app.modules.optimization.geo_utils import sub_polyline as _sub_polyline
from app.services.routing import osrm_route

__all__ = [
    "DetourConfig",
    "DetourDrop",
    "DetourPickup",
    "DetourResult",
    "evaluate_detour",
    "osrm_route",
    "_empty_result",
    "_sub_polyline",
    "_minutes",
]
