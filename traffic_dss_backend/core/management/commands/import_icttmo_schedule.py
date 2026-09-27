"""
Import ICTTMO officer deployment schedule from CSV.

Supports two CSV schemas:

  field_test (default) - the Week 1 baseline template:
    Date,Shift,Officer_Name,Officer_Badge,Bottleneck_Name,Bottleneck_ID,Start_Time,End_Time,Notes
    Bottlenecks are matched by their Bottleneck_ID. Officer columns may be empty
    (the template is filled in by hand during the field test).

  legacy - the older ICTTMO roster export:
    Name,Area of Assignment,Badge Number,Relief,District,Coordinates
    Bottlenecks are matched by district keyword.

Usage:
  python manage.py import_icttmo_schedule path/to/schedule.csv
  python manage.py import_icttmo_schedule path/to/schedule.csv --schema legacy
"""

import csv
from datetime import datetime, time

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core.models import Bottleneck, Deployment, Officer
from core.operational_time import MANILA, operational_date, shift_window


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
            "--schema",
            choices=["field_test", "legacy"],
            default="field_test",
            help="CSV schema to expect (default: field_test)",
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

        # Pre-load bottlenecks grouped by district
        all_bottlenecks = list(Bottleneck.objects.filter(is_deleted=False))
        district_map = self._build_district_map(all_bottlenecks)

        with open(csv_path, encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            headers = set(reader.fieldnames or [])
            schema = options["schema"]
            if schema == "auto":
                schema = "field_test" if "Bottleneck_ID" in headers else "legacy"
            self.stdout.write(f"Detected schema: {schema}")

            for row_num, row in enumerate(reader, start=2):
                if schema == "field_test":
                    name = row.get("Officer_Name", "").strip().strip('"')
                    badge = row.get("Officer_Badge", "").strip().strip('"')
                    bottleneck_id = row.get("Bottleneck_ID", "").strip().strip('"')
                    area = row.get("Bottleneck_Name", "").strip()
                    district_raw = ""
                    relief = ""
                    date_raw = row.get("Date", "").strip()
                else:
                    name = row.get("Name", "").strip().strip('"')
                    badge = row.get("Badge Number", "").strip().strip('"')
                    bottleneck_id = ""
                    area = row.get("Area of Assignment", "").strip()
                    district_raw = row.get("District", "").strip()
                    relief = row.get("Relief", "").strip()
                    date_raw = ""

                # Skip rows that have no officer AND no bottleneck - these are the
                # unfilled Week 1 template placeholders and must not become deployments.
                if not badge and not bottleneck_id:
                    skipped += 1
                    continue

                if not badge:
                    errors.append(f"Row {row_num}: Missing officer badge number")
                    skipped += 1
                    continue

                if not bottleneck_id:
                    errors.append(f"Row {row_num}: Missing bottleneck ID")
                    skipped += 1
                    continue

                # Resolve shift: explicit column > --shift override > Relief column
                if shift_override != "auto":
                    shift = shift_override
                elif schema == "field_test":
                    shift = row.get("Shift", "").strip().lower() or "afternoon"
                elif "1st" in relief:
                    shift = "morning"
                elif "2nd" in relief:
                    shift = "afternoon"
                else:
                    shift = "morning"  # default

                if shift not in ("morning", "afternoon"):
                    errors.append(f"Row {row_num}: Invalid shift '{shift}'")
                    skipped += 1
                    continue

                # Set times based on shift (use the CSV date when present, else today)
                day = operational_date()
                if date_raw:
                    try:
                        day = datetime.strptime(date_raw, "%Y-%m-%d").date()
                    except ValueError:
                        errors.append(f"Row {row_num}: Invalid operational date '{date_raw}'")
                        skipped += 1
                        continue
                start_time, end_time = shift_window(shift, day)
                if row.get("Start_Time") or row.get("End_Time"):
                    try:
                        start_time = datetime.combine(day, time.fromisoformat(row["Start_Time"].strip()), MANILA)
                        end_time = datetime.combine(day, time.fromisoformat(row["End_Time"].strip()), MANILA)
                        shift_start, shift_end = shift_window(shift, day)
                        if not shift_start <= start_time < end_time <= shift_end:
                            raise ValueError("outside shift")
                    except (ValueError, KeyError):
                        errors.append(f"Row {row_num}: Invalid shift time window")
                        skipped += 1
                        continue

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

                # Find matching bottleneck
                if bottleneck_id:
                    bottleneck = Bottleneck.objects.filter(id=bottleneck_id, is_deleted=False).first()
                    if not bottleneck:
                        errors.append(f"Row {row_num}: Bottleneck '{bottleneck_id}' not found")
                        skipped += 1
                        continue
                else:
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
