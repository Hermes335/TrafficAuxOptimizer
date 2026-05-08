from __future__ import annotations

import csv
import hashlib
import re
from pathlib import Path
from typing import Optional, Tuple

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone
from django.db import transaction

from core.models import Bottleneck, Officer, Deployment


def _short_hash(text: str, length: int = 10) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:length]


def _parse_coords(coords_raw: str) -> Optional[Tuple[float, float]]:
    if not coords_raw:
        return None
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
        "Re-reads the V2 CSV and creates deterministic Deployments mapping "
        "Officers to the specific Bottlenecks based on the coordinates defined in the CSV."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "csv_path",
            nargs="?",
            help="Path to CSV file",
            default=str(
                Path(settings.BASE_DIR).parent
                / "Traffic Officer Assignments and Badge Numbers V2 - Traffic Officer Assignments and Badge Numbers V2.csv"
            ),
        )

    def handle(self, *args, **options):
        csv_path = Path(options.get("csv_path"))
        if not csv_path.exists():
            self.stderr.write(f"CSV file not found: {csv_path}")
            return

        now = timezone.now()

        # Clear existing 'assigned' deployments and reset officers
        assignments_cleared = Deployment.objects.filter(status="assigned").update(status="completed", end_time=now)
        Officer.objects.filter(is_deleted=False).update(status="available")

        assigned_count = 0
        missing_bottlenecks = set()
        missing_officers = set()

        with open(csv_path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            with transaction.atomic():
                for row in reader:
                    badge = (row.get("Badge Number") or "").strip()
                    coords_raw = (row.get("Coordinates") or "").strip()

                    if not badge or not coords_raw:
                        continue

                    parsed = _parse_coords(coords_raw)
                    if not parsed:
                        continue

                    lat, lon = parsed
                    # Look up bottleneck by coordinate hash
                    candidate_id = f"bn-{_short_hash(f'{lat:.6f}:{lon:.6f}', 10)}"[:20]

                    bottleneck = Bottleneck.objects.filter(id=candidate_id, is_deleted=False).first()
                    officer = Officer.objects.filter(badge_number=badge, is_deleted=False).first()

                    if not bottleneck:
                        missing_bottlenecks.add(candidate_id)
                        continue
                    if not officer:
                        missing_officers.add(badge)
                        continue

                    # Deploy officer
                    officer.status = "deployed"
                    officer.save(update_fields=['status'])

                    Deployment.objects.create(
                        officer=officer,
                        bottleneck=bottleneck,
                        shift=officer.shift,
                        start_time=now - timezone.timedelta(hours=1),
                        end_time=now + timezone.timedelta(hours=7),
                        assignment_type="static",
                        status="assigned"
                    )
                    assigned_count += 1

        self.stdout.write(self.style.SUCCESS(f"Cleared {assignments_cleared} previous deployments."))
        self.stdout.write(self.style.SUCCESS(f"Successfully mapped {assigned_count} officers to their specific bottlenecks."))
        if missing_bottlenecks:
            self.stdout.write(self.style.WARNING(f"Missing active bottlenecks for {len(missing_bottlenecks)} hashes."))
        if missing_officers:
            self.stdout.write(self.style.WARNING(f"Missing active officers for {len(missing_officers)} badges."))
