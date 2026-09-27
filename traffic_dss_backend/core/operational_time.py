from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

MANILA = ZoneInfo("Asia/Manila")


def operational_date(value=None):
    return timezone.localtime(value or timezone.now(), MANILA).date()


def shift_window(shift, day=None):
    if shift not in {"morning", "afternoon"}:
        raise ValueError("Unknown operational shift.")
    start = datetime.combine(day or operational_date(), time(6 if shift == "morning" else 14), MANILA)
    return start, start + timedelta(hours=8)


def is_peak_hour(moment=None):
    hour = timezone.localtime(moment or timezone.now(), MANILA).hour
    return 7 <= hour <= 9 or 17 <= hour <= 19
