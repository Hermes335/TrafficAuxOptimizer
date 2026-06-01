"""
Field test comparison: Manual ICTTMO vs Optimized deployment.

Compares manual assignments (imported via CSV) against optimized assignments
for the Diversion Road + Jaro test district.

Usage:
    python manage.py field_test_compare --shift afternoon
"""
from collections import defaultdict

from django.core.management.base import BaseCommand

from core.models import Bottleneck, Deployment


TEST_DISTRICT = "Diversion Road + Jaro"


class Command(BaseCommand):
    help = "Compare manual vs optimized deployments for field test"

    def add_arguments(self, parser):
        parser.add_argument("--shift", type=str, default="afternoon", help="Shift to compare")

    def handle(self, *args, **options):
        shift = options["shift"]

        # Get test district bottlenecks
        bottlenecks = list(Bottleneck.objects.filter(
            is_deleted=False, district=TEST_DISTRICT
        ).values("id", "name", "latitude", "longitude", "tsi", "road_priority_weight"))

        if not bottlenecks:
            self.stdout.write(self.style.ERROR(f"No bottlenecks found in district: {TEST_DISTRICT}"))
            return

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("=" * 60))
        self.stdout.write(self.style.SUCCESS(f"FIELD TEST COMPARISON - {TEST_DISTRICT}"))
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
        self.stdout.write("TRAFFIC SEVERITY (TSI)")
        self.stdout.write("-" * 40)

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
            self.stdout.write(self.style.WARNING("  No manual deployments found for this district/shift."))
            self.stdout.write("  Import manual data with: python manage.py import_icttmo_schedule --csv path/to/file.csv")
        elif opt_count == 0:
            self.stdout.write(self.style.WARNING(""))
            self.stdout.write(self.style.WARNING("  No optimized deployments found."))
            self.stdout.write("  Run optimization and publish results first.")

        self.stdout.write("")
