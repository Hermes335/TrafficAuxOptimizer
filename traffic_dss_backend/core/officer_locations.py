"""Shared validation for recorded planning coordinates; unknown origins stay unknown."""
from collections.abc import Mapping
from math import isfinite


MISSING_LOCATION_DISTANCE_KM = 3.0


def valid_coordinates(latitude, longitude):
    """Accept only a complete, finite latitude/longitude pair in geographic range."""
    try:
        return (
            latitude is not None and longitude is not None
            and not isinstance(latitude, bool) and not isinstance(longitude, bool)
            and isfinite(float(latitude)) and isfinite(float(longitude))
            and -90 <= float(latitude) <= 90
            and -180 <= float(longitude) <= 180
        )
    except (TypeError, ValueError, OverflowError):
        return False


def officer_coordinates(officer):
    """Return valid recorded coordinates, or None when no position is known.

    Both captured dictionaries and roster-like objects are supported. The caller
    selects any served post before scoring. No position or departure record is
    created when coordinates are missing.
    """
    if isinstance(officer, Mapping):
        latitude = officer.get("current_latitude")
        longitude = officer.get("current_longitude")
    else:
        latitude = getattr(officer, "current_latitude", None)
        longitude = getattr(officer, "current_longitude", None)
    if valid_coordinates(latitude, longitude):
        return float(latitude), float(longitude)
    return None
