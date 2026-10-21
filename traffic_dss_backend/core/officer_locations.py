"""Shared planning coordinates; HQ is an assumption, never a measured position."""
from collections.abc import Mapping
from math import isfinite


TTMO_HQ_LATITUDE = 10.689327
TTMO_HQ_LONGITUDE = 122.581486
TTMO_HQ_NAME = "TTMO HQ"


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
    """Use an officer's valid planning coordinates, otherwise assume TTMO HQ.

    Both captured dictionaries and roster-like objects are supported. The caller
    remains responsible for selecting a served post or daily initial position.
    No coordinate or departure-time record is created here.
    """
    if isinstance(officer, Mapping):
        latitude = officer.get("current_latitude")
        longitude = officer.get("current_longitude")
    else:
        latitude = getattr(officer, "current_latitude", None)
        longitude = getattr(officer, "current_longitude", None)
    if valid_coordinates(latitude, longitude):
        return float(latitude), float(longitude)
    return TTMO_HQ_LATITUDE, TTMO_HQ_LONGITUDE
