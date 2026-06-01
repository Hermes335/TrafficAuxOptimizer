"""
Import ICTTMO officer deployment schedule from CSV.

CSV format:
  Name,Area of Assignment,Badge Number,Relief,District,Coordinates

Usage:
  python manage.py import_icttmo_schedule path/to/schedule.csv
"""

import csv
from datetime import datetime, time

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core.models import Bottleneck, Deployment, Officer


class Command(BaseCommand):
    help = "Import ICTTMO officer deployment schedule from CSV"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._import_counter = 0

    def add_arguments(self, parser):
        parser.add_argument("csv_path", help="Path to the ICTTMO schedule CSV file")
        parser.add_argument(
            "--shift",
            choices=["morning", "afternoon", "auto"],
            default="auto",
            help="Override shift (default: auto-detect from Relief column)",
        )
        parser.add_argument(
            "--clear-existing",
            action="store_true",
            help="Clear existing manual deployments before importing",
        )

    def handle(self, *args, **options):
        csv_path = options["csv_path"]
        shift_override = options["shift"]
        clear_existing = options["clear_existing"]

        if clear_existing:
            count = Deployment.objects.filter(source="manual", is_deleted=False).update(
                is_deleted=True, updated_at=timezone.now()
            )
            self.stdout.write(f"Cleared {count} existing manual deployments")

        created = 0
        skipped = 0
        errors = []

        # Get or create the "bottleneck" for supervisor/roving positions
        unassigned_bn, _ = Bottleneck.objects.get_or_create(
            id="BN-UNASSIGNED",
            defaults={
                "name": "Unassigned / Roving",
                "latitude": 10.7202,
                "longitude": 122.5621,
                "road_priority_weight": 0.1,
            },
        )

        now = timezone.now()
        morning_start = now.replace(hour=6, minute=0, second=0, microsecond=0)
        morning_end = now.replace(hour=14, minute=0, second=0, microsecond=0)
        afternoon_start = now.replace(hour=14, minute=0, second=0, microsecond=0)
        afternoon_end = now.replace(hour=22, minute=0, second=0, microsecond=0)

        # Pre-load bottlenecks grouped by district
        all_bottlenecks = list(Bottleneck.objects.filter(is_deleted=False))
        district_map = self._build_district_map(all_bottlenecks)

        with open(csv_path, encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row_num, row in enumerate(reader, start=2):
                name = row.get("Name", "").strip().strip('"')
                area = row.get("Area of Assignment", "").strip()
                badge = row.get("Badge Number", "").strip()
                relief = row.get("Relief", "").strip()
                district_raw = row.get("District", "").strip()

                if not name or not badge:
                    errors.append(f"Row {row_num}: Missing name or badge number")
                    skipped += 1
                    continue

                # Parse shift from Relief column
                if shift_override != "auto":
                    shift = shift_override
                elif "1st" in relief:
                    shift = "morning"
                elif "2nd" in relief:
                    shift = "afternoon"
                else:
                    shift = "morning"  # default

                # Set times based on shift
                if shift == "morning":
                    start_time = morning_start
                    end_time = morning_end
                else:
                    start_time = afternoon_start
                    end_time = afternoon_end

                # Find officer by badge number
                officer = Officer.objects.filter(badge_number=badge, is_deleted=False).first()
                if not officer:
                    # Create officer if not exists
                    first_name = name.split(", ")[-1] if ", " in name else name
                    last_name = name.split(", ")[0] if ", " in name else ""
                    officer = Officer.objects.create(
                        name=f"{first_name} {last_name}".strip(),
                        badge_number=badge,
                        shift=shift,
                        status="available",
                        skills=[],
                    )
                    self.stdout.write(f"  Created officer: {officer.name} ({badge})")

                # Skip supervisors and roving officers
                area_upper = area.upper()
                if "SUPERVISOR" in area_upper or "ROVING" in area_upper or "UNASSIGNED" in area_upper:
                    skipped += 1
                    continue

                # Find matching bottleneck by district
                # NOTE: Coordinates in the CSV are randomized and NOT used
                bottleneck = self._find_bottleneck_by_district(
                    district_raw, area, district_map
                )

                # Create deployment
                Deployment.objects.create(
                    officer=officer,
                    bottleneck=bottleneck,
                    shift=shift,
                    start_time=start_time,
                    end_time=end_time,
                    assignment_type="static",
                    status="assigned",
                    source="manual",
                )
                created += 1

        self.stdout.write(self.style.SUCCESS(f"\nImport complete:"))
        self.stdout.write(f"  Created: {created} deployments")
        self.stdout.write(f"  Skipped: {skipped} (supervisors/roving/missing data)")
        if errors:
            self.stdout.write(self.style.WARNING(f"  Errors: {len(errors)}"))
            for err in errors[:10]:
                self.stdout.write(f"    {err}")

    def _build_district_map(self, bottlenecks):
        """Group bottlenecks by district keyword for matching."""
        district_keywords = {
            "Jaro": [],
            "City Proper": [],
            "Lapaz": [],
            "La Paz": [],
            "Molo": [],
            "Mandurriao": [],
            "Mandurriao-TDZ": [],
            "Arevalo": [],
        }

        for bn in bottlenecks:
            name_lower = bn.name.lower()
            for district in district_keywords:
                if district.lower() in name_lower:
                    district_keywords[district].append(bn)

        # Merge La Paz and Lapaz
        district_keywords["Lapaz"] = district_keywords.get("Lapaz", []) + district_keywords.get("La Paz", [])

        return district_keywords

    def _find_bottleneck_by_district(self, district_raw, area, district_map):
        """Find a bottleneck in the given district, distributing officers evenly."""
        if not district_raw:
            return self._get_unassigned()

        # Normalize district name
        district = district_raw.strip()
        district_lower = district.lower()

        # Try exact match first
        candidates = district_map.get(district, [])

        # Try fuzzy match
        if not candidates:
            for key, bns in district_map.items():
                if district_lower in key.lower() or key.lower() in district_lower:
                    candidates = bns
                    break

        if not candidates:
            return self._get_unassigned()

        # Distribute officers evenly across bottlenecks in this district
        idx = self._import_counter % len(candidates)
        self._import_counter += 1
        return candidates[idx]

    def _get_unassigned(self):
        """Get or create the unassigned bottleneck."""
        unassigned_bn, _ = Bottleneck.objects.get_or_create(
            id="BN-UNASSIGNED",
            defaults={
                "name": "Unassigned / Roving",
                "latitude": 10.7202,
                "longitude": 122.5621,
                "road_priority_weight": 0.1,
            },
        )
        return unassigned_bn
