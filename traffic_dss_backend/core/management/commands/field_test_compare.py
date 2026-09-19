"""
Field test comparison: Manual ICTTMO vs Optimized deployment.

 Compares manual assignments (imported via CSV) against optimized assignments
 for an explicitly selected bottleneck name or district.

Usage:
    python manage.py field_test_compare --location "Atrium Rotonda" --shift afternoon
"""
import csv
from collections import defaultdict
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db.models import Q

from core.models import Bottleneck, Deployment


class Command(BaseCommand):
    help = "Compare manual vs optimized deployments for field test"

    def add_arguments(self, parser):
        parser.add_argument("--location", type=str, required=True, help="Exact bottleneck name or district to compare")
        parser.add_argument("--shift", type=str, default="afternoon", help="Shift to compare")
        parser.add_argument(
            "--observations-csv",
            type=str,
            default="",
            help="Optional field observations CSV; raw TSI values are checked but never normalized or compared",
        )

    def handle(self, *args, **options):
        location = options["location"].strip()
        shift = options["shift"]
        observations_csv = options["observations_csv"]

        # Match either an explicitly selected bottleneck name or district.
        bottlenecks = list(Bottleneck.objects.filter(
            Q(name__iexact=location) | Q(district__iexact=location),
            is_deleted=False,
        ).values("id", "name", "latitude", "longitude", "tsi", "road_priority_weight"))

        if not bottlenecks:
            self.stdout.write(self.style.ERROR(f"No bottlenecks found for location: {location}"))
            return

        self._report_observation_tsi(observations_csv)

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("=" * 60))
        self.stdout.write(self.style.SUCCESS(f"FIELD TEST COMPARISON - {location}"))
        self.stdout.write(self.style.SUCCESS("=" * 60))
        self.stdout.write("")

        bn_ids = [b["id"] for b in bottlenecks]

        self.stdout.write(f"Test District Bottlenecks ({len(bottlenecks)}):")
        for b in bottlenecks:
            self.stdout.write(f"  * {b['name']}")

        # Manual (ICTTMO) Stats
        manual_deployments = Deployment.objects.filter(
            bottleneck_id__in=bn_ids,
            shift=shift,
            source="manual",
            is_deleted=False,
        )

        manual_count = manual_deployments.count()
        manual_covered = manual_deployments.values("bottleneck_id").distinct().count()
        manual_officers = manual_deployments.values("officer_id").distinct().count()

        self.stdout.write("")
        self.stdout.write("-" * 40)
        self.stdout.write(self.style.WARNING("MANUAL (ICTTMO) DEPLOYMENT"))
        self.stdout.write("-" * 40)
        self.stdout.write(f"  Total assignments: {manual_count}")
        self.stdout.write(f"  Officers deployed: {manual_officers}")
        self.stdout.write(f"  Bottlenecks covered: {manual_covered}/{len(bottlenecks)} ({manual_covered/len(bottlenecks)*100:.0f}%)")

        manual_per_bn = defaultdict(list)
        for d in manual_deployments.select_related("officer"):
            manual_per_bn[d.bottleneck_id].append(d.officer.name if d.officer else "Unknown")

        self.stdout.write("")
        self.stdout.write("  Per-bottleneck assignments:")
        for bn in bottlenecks:
            officers = manual_per_bn.get(bn["id"], [])
            status = f"{len(officers)} officer(s)" if officers else "UNCOVERED"
            self.stdout.write(f"    {bn['name'][:45]:45s} {status}")

        # Optimized Stats
        opt_deployments = Deployment.objects.filter(
            bottleneck_id__in=bn_ids,
            shift=shift,
            source="optimized",
            is_deleted=False,
        )

        opt_count = opt_deployments.count()
        opt_covered = opt_deployments.values("bottleneck_id").distinct().count()
        opt_officers = opt_deployments.values("officer_id").distinct().count()

        self.stdout.write("")
        self.stdout.write("-" * 40)
        self.stdout.write(self.style.SUCCESS("OPTIMIZED (GA) DEPLOYMENT"))
        self.stdout.write("-" * 40)
        self.stdout.write(f"  Total assignments: {opt_count}")
        self.stdout.write(f"  Officers deployed: {opt_officers}")
        self.stdout.write(f"  Bottlenecks covered: {opt_covered}/{len(bottlenecks)} ({opt_covered/len(bottlenecks)*100:.0f}%)")

        opt_per_bn = defaultdict(list)
        for d in opt_deployments.select_related("officer"):
            opt_per_bn[d.bottleneck_id].append(d.officer.name if d.officer else "Unknown")

        self.stdout.write("")
        self.stdout.write("  Per-bottleneck assignments:")
        for bn in bottlenecks:
            officers = opt_per_bn.get(bn["id"], [])
            status = f"{len(officers)} officer(s)" if officers else "UNCOVERED"
            self.stdout.write(f"    {bn['name'][:45]:45s} {status}")

        # TSI Comparison
        self.stdout.write("")
        self.stdout.write("-" * 40)
        self.stdout.write("APPLICATION TRAFFIC SEVERITY (NORMALIZED TSI)")
        self.stdout.write("-" * 40)
        self.stdout.write("Database TSI values below use the application-normalized [0,1] scale.")
        self.stdout.write("No quantitative comparison with raw field-observation TSI is performed.")

        for bn in bottlenecks:
            tsi = bn.get("tsi", 0) or 0
            tsi_pct = round(tsi * 100, 1)
            filled = int(tsi_pct / 5)
            bar = "#" * filled + "." * (20 - filled)
            self.stdout.write(f"  {bn['name'][:40]:40s} [{bar}] {tsi_pct}%")

        # Summary
        self.stdout.write("")
        self.stdout.write("=" * 60)
        self.stdout.write("COMPARISON SUMMARY")
        self.stdout.write("=" * 60)

        if manual_count > 0 and opt_count > 0:
            coverage_delta = opt_covered - manual_covered
            officers_delta = opt_officers - manual_officers
            sign_c = "+" if coverage_delta >= 0 else ""
            sign_o = "+" if officers_delta >= 0 else ""
            self.stdout.write(f"  Coverage:  Manual {manual_covered}/{len(bottlenecks)} -> Optimized {opt_covered}/{len(bottlenecks)} ({sign_c}{coverage_delta})")
            self.stdout.write(f"  Officers:  Manual {manual_officers} -> Optimized {opt_officers} ({sign_o}{officers_delta})")
        elif manual_count == 0:
            self.stdout.write(self.style.WARNING(""))
            self.stdout.write(self.style.WARNING("  No manual deployments found for this location/shift."))
            self.stdout.write("  Import manual data with: python manage.py import_icttmo_schedule --csv path/to/file.csv")
        elif opt_count == 0:
            self.stdout.write(self.style.WARNING(""))
            self.stdout.write(self.style.WARNING("  No optimized deployments found."))
            self.stdout.write("  Run optimization and publish results first.")

        self.stdout.write("")

    def _report_observation_tsi(self, observations_csv: str):
        if not observations_csv:
            return

        try:
            with Path(observations_csv).open(newline="", encoding="utf-8-sig") as handle:
                rows = list(csv.DictReader(handle))
        except OSError as exc:
            self.stdout.write(self.style.WARNING(f"Could not read field observations CSV: {exc}"))
            return

        raw_values = []
        for row in rows:
            try:
                raw_values.append(float(row["TSI"]))
            except (KeyError, TypeError, ValueError):
                continue

        if any(value < 0 or value > 1 for value in raw_values):
            self.stdout.write(self.style.WARNING(
                "Field observation TSI is not comparable to application TSI: "
                "values fall outside the documented [0,1] range. No conversion was applied."
            ))
        else:
            self.stdout.write("Field observation TSI values are within [0,1]; source semantics still require confirmation.")
