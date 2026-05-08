import random
from django.core.management.base import BaseCommand
from django.utils import timezone
from core.models import Bottleneck, Officer, TrafficData, Deployment

class Command(BaseCommand):
    help = 'Seeds realistic traffic and deployment data to populate the dashboard.'

    def handle(self, *args, **kwargs):
        now = timezone.now()
        
        # 1. Seed Traffic Data
        bottlenecks = Bottleneck.objects.filter(is_deleted=False)
        
        if TrafficData.objects.exists():
            self.stdout.write("Traffic data already exists. Generating new active snapshots...")
        
        for b in bottlenecks:
            # Random TSI skewed a bit so we get a mix of normal, warning, critical
            tsi = random.uniform(0.1, 0.95)
            # Speed inversely proportional to TSI
            speed = 60.0 * (1 - tsi) 
            TrafficData.objects.create(
                bottleneck=b,
                timestamp=now,
                traffic_severity_index=tsi,
                vehicle_count=int(tsi * 200),
                avg_speed=max(5.0, speed)
            )
        
        self.stdout.write(self.style.SUCCESS(f"Seeded traffic data snapshot for {bottlenecks.count()} bottlenecks."))
        
        # 2. Seed Deployments
        # Set all officers to available first
        Officer.objects.update(status="available")
        Deployment.objects.filter(status="assigned").update(status="completed", end_time=now)
        
        # Prefer afternoon shift for this demo, fallback to others
        officers = list(Officer.objects.filter(is_deleted=False, shift="afternoon"))
        if not officers:
            officers = list(Officer.objects.filter(is_deleted=False))
        
        deployed_count = 0
        for b in bottlenecks:
            # 60% chance to assign 1 or 2 officers to a bottleneck
            if random.random() < 0.6 and len(officers) > 0:
                num_to_assign = random.choice([1, 2])
                for _ in range(num_to_assign):
                    if not officers:
                        break
                    officer = officers.pop(0)
                    officer.status = "deployed"
                    officer.save(update_fields=['status'])
                    
                    Deployment.objects.create(
                        officer=officer,
                        bottleneck=b,
                        shift=officer.shift,
                        start_time=now - timezone.timedelta(hours=1),
                        end_time=now + timezone.timedelta(hours=7),
                        assignment_type="static",
                        status="assigned"
                    )
                    deployed_count += 1
        
        self.stdout.write(self.style.SUCCESS(f"Deployed {deployed_count} officers to active bottlenecks."))
