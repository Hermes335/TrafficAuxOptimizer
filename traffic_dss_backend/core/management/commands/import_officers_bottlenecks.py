from __future__ import annotations

import csv
import hashlib
from pathlib import Path
from typing import Optional

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import Bottleneck, Officer


def _short_hash(text: str, length: int = 10) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:length]


def _map_relief_to_shift(relief: Optional[str]) -> str:
    if not relief:
        return "morning"
    r = relief.lower()
    if "1st" in r or "1" in r:
        return "morning"
    if "2nd" in r or "2" in r:
        return "afternoon"
    if "3rd" in r or "3" in r:
        return "night"
    return "morning"


class Command(BaseCommand):
    help = "Import officers and bottlenecks from a CSV file."

    def add_arguments(self, parser):
        parser.add_argument(
            "csv_path",
            nargs="?",
            help="Path to CSV file",
            default=str(
                Path(settings.BASE_DIR).parent
                / "Traffic Officer Assignments and Badge Numbers - Traffic Officer Assignments and Badge Numbers.csv"
            ),
        )

    def handle(self, *args, **options):
        csv_path = Path(options.get("csv_path"))
        if not csv_path.exists():
            self.stderr.write(f"CSV file not found: {csv_path}")
            return

        default_lat = getattr(settings, "ILOILO_LATITUDE", 10.7202)
        default_lon = getattr(settings, "ILOILO_LONGITUDE", 122.5621)

        created_b = 0
        updated_b = 0
        created_o = 0
        updated_o = 0

        with open(csv_path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            with transaction.atomic():
                for row in reader:
                    name = (row.get("Area of Assignment") or "").strip()
                    person_name = (row.get("Name") or "").strip()
                    badge = (row.get("Badge Number") or "").strip()
                    relief = (row.get("Relief") or "").strip()
                    district = (row.get("District") or "").strip()

                    bottleneck_obj = None
                    if name:
                        # generate short id from area name
                        candidate_id = f"bn-{_short_hash(name, 10)}"
                        candidate_id = candidate_id[:20]
                        bottleneck_obj, created = Bottleneck.objects.get_or_create(
                            id=candidate_id,
                            defaults={
                                "name": name[:255],
                                "latitude": float(default_lat),
                                "longitude": float(default_lon),
                                "road_priority_weight": 1.0,
                                "district": district[:120] if district else "",
                                "bottleneck_type": "other",
                            },
                        )
                        if created:
                            created_b += 1
                        else:
                            changed = False
                            if district and bottleneck_obj.district != district:
                                bottleneck_obj.district = district[:120]
                                changed = True
                            if changed:
                                bottleneck_obj.save(update_fields=["district"])
                                updated_b += 1

                    # create/update officer
                    if badge:
                        officer, created = Officer.objects.get_or_create(
                            badge_number=badge,
                            defaults={
                                "name": person_name[:255],
                                "shift": _map_relief_to_shift(relief),
                                "status": "available",
                            },
                        )
                        if created:
                            created_o += 1
                        else:
                            changed = False
                            if person_name and officer.name != person_name:
                                officer.name = person_name[:255]
                                changed = True
                            if officer.is_deleted:
                                officer.is_deleted = False
                                changed = True
                            if changed:
                                officer.save()
                                updated_o += 1

        self.stdout.write(self.style.SUCCESS(f"Bottlenecks created: {created_b}  updated: {updated_b}"))
        self.stdout.write(self.style.SUCCESS(f"Officers created: {created_o}  updated: {updated_o}"))
