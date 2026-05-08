import hashlib
from django.core.management.base import BaseCommand
from django.utils import timezone
from core.models import Officer, Bottleneck, Deployment


class Command(BaseCommand):
    help = "Deterministically assign available officers to bottlenecks (safe, idempotent)."

    def handle(self, *args, **options):
        now = timezone.now()
        bottlenecks = list(Bottleneck.objects.filter(is_deleted=False).order_by('id'))
        if not bottlenecks:
            self.stdout.write(self.style.WARNING('No active bottlenecks found.'))
            return

        officers = Officer.objects.filter(is_deleted=False).order_by('badge_number')
        assigned = 0
        skipped = 0

        for officer in officers:
            # skip officers already assigned
            if officer.deployments.filter(is_deleted=False, status='assigned').exists():
                skipped += 1
                continue

            # deterministic mapping using md5 of badge_number
            badge = (officer.badge_number or officer.name or str(officer.pk)).encode('utf-8')
            h = int(hashlib.md5(badge).hexdigest(), 16)
            idx = h % len(bottlenecks)
            target = bottlenecks[idx]

            Deployment.objects.create(
                officer=officer,
                bottleneck=target,
                shift=officer.shift or 'afternoon',
                start_time=now,
                end_time=now + timezone.timedelta(hours=8),
                assignment_type='static',
                status='assigned',
            )

            officer.status = 'deployed'
            officer.save(update_fields=['status'])
            assigned += 1

        self.stdout.write(self.style.SUCCESS(f'Assigned {assigned} officers; skipped {skipped} (already assigned).'))
