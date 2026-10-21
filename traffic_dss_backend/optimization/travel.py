"""Transfer time excludes breaks; reservations never invent a new location."""
from datetime import datetime


def _breaks(officer):
    spans = sorted((datetime.fromisoformat(row["start_time"]), datetime.fromisoformat(row["end_time"]))
                   for row in officer.get("time_blocks", []) if row.get("kind") == "break")
    merged = []
    for left, right in spans:
        if merged and left <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(right, merged[-1][1]))
        else:
            merged.append((left, right))
    return merged


def transfer_seconds_available(officer, release, arrival):
    duration = max(0, (arrival-release).total_seconds())
    return max(0, duration-sum(max(0, (min(arrival, right)-max(release, left)).total_seconds())
                              for left, right in _breaks(officer)))


