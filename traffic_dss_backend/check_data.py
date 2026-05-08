#!/usr/bin/env python
import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from core.models import Officer, Bottleneck, TrafficData
import json

print("=== OFFICER DATA ===")
officers = Officer.objects.filter(is_deleted=False, status__in=['available', 'deployed']).values('badge_number', 'current_latitude', 'current_longitude', 'status')[:5]
for o in officers:
    print(json.dumps(o, indent=2, default=str))
print(f"Total officers: {Officer.objects.filter(is_deleted=False).count()}")

missing_coords = Officer.objects.filter(is_deleted=False, status__in=['available', 'deployed']).filter(current_latitude__isnull=True)
print(f"Officers missing coordinates: {missing_coords.count()}")

print("\n=== BOTTLENECK DATA ===")
bottlenecks = Bottleneck.objects.filter(is_deleted=False).values('id', 'name', 'road_priority_weight')[:5]
for b in bottlenecks:
    print(json.dumps(b, indent=2, default=str))
print(f"Total bottlenecks: {Bottleneck.objects.filter(is_deleted=False).count()}")

print("\n=== TRAFFIC DATA ===")
traffic_count = TrafficData.objects.filter(is_deleted=False).count()
print(f"Total traffic records: {traffic_count}")
if traffic_count > 0:
    latest = TrafficData.objects.filter(is_deleted=False).order_by('-timestamp').values('bottleneck_id', 'traffic_severity_index', 'timestamp')[:3]
    for t in latest:
        print(json.dumps(t, indent=2, default=str))

print("\n=== TRAFFIC DATA BY BOTTLENECK ===")
from django.db.models import Count
traffic_per_bn = TrafficData.objects.filter(is_deleted=False).values('bottleneck_id').annotate(count=Count('id')).order_by('-count')[:5]
for t in traffic_per_bn:
    print(json.dumps(t, indent=2, default=str))

print("\n=== DISTRIBUTION OF TSI VALUES ===")
tsi_stats = TrafficData.objects.filter(is_deleted=False).values('traffic_severity_index').annotate(count=Count('id')).order_by('traffic_severity_index')
for stat in tsi_stats:
    print(json.dumps(stat, indent=2, default=str))
