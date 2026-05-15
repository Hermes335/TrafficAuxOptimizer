from __future__ import annotations

import csv
import hashlib
import re
from pathlib import Path
from typing import Dict, Tuple, List, Optional

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import Bottleneck


def _short_hash(text: str, length: int = 10) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:length]


def _parse_coords(coords_raw: str) -> Optional[Tuple[float, float]]:
    if not coords_raw:
        return None
    # find two floats in the string
    nums = re.findall(r"[-+]?\d*\.\d+|[-+]?\d+", coords_raw)
    if len(nums) < 2:
        return None
    try:
        lat = float(nums[0])
        lon = float(nums[1])
        return lat, lon
    except ValueError:
        return None


class Command(BaseCommand):
    help = (
        "Replace all Bottleneck rows using coordinates from a CSV. "
        "Soft-deletes existing bottlenecks, then creates/updates new ones."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "csv_path",
            nargs="?",
            help="Path to CSV file",
            default=str(
                Path(settings.BASE_DIR).parent
                / "iloilo_city_traffic_bottlenecks.csv"
            ),
        )
        parser.add_argument(
            "--format",
            type=str,
            default="new",
            choices=["new", "legacy"],
            help="CSV format: 'new' (ID,Bottleneck Area,Latitude,Longitude) or 'legacy' (Area of Assignment,Coordinates,District)",
        )

    def handle(self, *args, **options):
        csv_path = Path(options.get("csv_path"))
        csv_format = options.get("format", "new")
        if not csv_path.exists():
            self.stderr.write(f"CSV file not found: {csv_path}")
            return

        # Soft-delete active bottlenecks
        active_qs = Bottleneck.objects.filter(is_deleted=False)
        active_count = active_qs.count()
        if active_count:
            active_qs.update(is_deleted=True)
        self.stdout.write(f"Soft-deleted {active_count} existing bottlenecks")

        # Aggregate by coordinates (rounded to 6 decimal places)
        coords_map: Dict[Tuple[float, float], Dict[str, object]] = {}

        with open(csv_path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)

            if csv_format == "new":
                # New format: ID, Bottleneck Area, Latitude, Longitude
                for row in reader:
                    area = (row.get("Bottleneck Area") or "").strip()
                    try:
                        lat = float(row.get("Latitude", "").strip())
                        lon = float(row.get("Longitude", "").strip())
                    except (ValueError, TypeError):
                        continue

                    if not (lat and lon):
                        continue

                    key = (round(lat, 6), round(lon, 6))
                    entry = coords_map.get(key)
                    if not entry:
                        entry = {"names": [], "names_set": set(), "districts": set()}
                        coords_map[key] = entry
                    if area and area not in entry["names_set"]:
                        entry["names"].append(area)
                        entry["names_set"].add(area)
            else:
                # Legacy format: Area of Assignment, Coordinates, District
                for row in reader:
                    area = (row.get("Area of Assignment") or "").strip()
                    coords_raw = (row.get("Coordinates") or "").strip()
                    district = (row.get("District") or "").strip()

                    parsed = _parse_coords(coords_raw)
                    if not parsed:
                        continue
                    lat, lon = parsed
                    key = (round(lat, 6), round(lon, 6))
                    entry = coords_map.get(key)
                    if not entry:
                        entry = {"names": [], "names_set": set(), "districts": set()}
                        coords_map[key] = entry
                    if area and area not in entry["names_set"]:
                        entry["names"].append(area)
                        entry["names_set"].add(area)
                    if district:
                        entry["districts"].add(district)

        created = 0
        updated = 0
        with transaction.atomic():
            for (lat, lon), entry in coords_map.items():
                names_list: List[str] = entry["names"]
                if not names_list:
                    continue
                combined_name = " & ".join(names_list)
                district = next(iter(entry["districts"])) if entry["districts"] else ""
                candidate_id = f"bn-{_short_hash(f'{lat:.6f}:{lon:.6f}', 10)}"[:20]

                defaults = {
                    "name": combined_name[:255],
                    "latitude": float(lat),
                    "longitude": float(lon),
                    "road_priority_weight": 1.0,
                    "district": district[:120] if district else "Iloilo City",
                    "bottleneck_type": "other",
                    "is_deleted": False,
                }

                obj, created_flag = Bottleneck.objects.update_or_create(id=candidate_id, defaults=defaults)
                if created_flag:
                    created += 1
                else:
                    updated += 1

        self.stdout.write(self.style.SUCCESS(f"Unique coordinate groups: {len(coords_map)}"))
        self.stdout.write(self.style.SUCCESS(f"Bottlenecks created: {created}  updated: {updated}"))
