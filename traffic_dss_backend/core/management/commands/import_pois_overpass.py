import json
import urllib.request
from django.core.management.base import BaseCommand, CommandError

from core.models import POI


CATEGORY_MAP = {
    "hospital": "hospital",
    "doctors": "hospital",
    "clinic": "hospital",
    "pharmacy": "hospital",
    "fire_station": "fire_station",
    "police": "police_station",
    "school": "school",
    "university": "school",
    "college": "school",
    "marketplace": "market",
    "townhall": "other",
}


class Command(BaseCommand):
    help = "Import POIs from OpenStreetMap Overpass API for a given bounding box."

    def add_arguments(self, parser):
        parser.add_argument(
            "--bbox",
            type=str,
            required=True,
            help="Bounding box: minLon,minLat,maxLon,maxLat (e.g., 122.5,10.6,122.6,10.8)",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Clear existing POIs before importing",
        )

    def handle(self, *args, **options):
        bbox_str = options.get("bbox")
        clear_existing = options.get("clear", False)

        try:
            minLon, minLat, maxLon, maxLat = map(float, bbox_str.split(","))
        except ValueError:
            raise CommandError("Invalid bbox format. Use: minLon,minLat,maxLon,maxLat")

        if clear_existing:
            count = POI.objects.filter(is_deleted=False).update(is_deleted=True)
            self.stdout.write(f"Soft-deleted {count} existing POIs")

        # Overpass QL query for important POIs
        overpass_url = "https://overpass-api.de/api/interpreter"
        query = f"""
[out:json][timeout:60];
(
  node["amenity"~"hospital|clinic|doctors|pharmacy|fire_station|police|school|university|college|marketplace"]({minLat},{minLon},{maxLat},{maxLon});
  way["amenity"~"hospital|clinic|doctors|pharmacy|fire_station|police|school|university|college|marketplace"]({minLat},{minLon},{maxLat},{maxLon});
);
out center;
"""

        self.stdout.write(f"Fetching POIs from Overpass for bbox: {bbox_str}...")

        try:
            with urllib.request.urlopen(overpass_url, data=query.encode("utf-8"), timeout=120) as response:
                data = json.loads(response.read().decode("utf-8"))
        except Exception as e:
            raise CommandError(f"Failed to fetch from Overpass: {e}")

        elements = data.get("elements", [])
        self.stdout.write(f"Found {len(elements)} elements from Overpass")

        created = 0
        updated = 0

        for element in elements:
            element_type = element.get("type")
            osm_id = element.get("id")
            poi_id = f"osm-{element_type}-{osm_id}"

            # Get coordinates
            if element_type == "node":
                lat = element.get("lat")
                lon = element.get("lon")
            elif element_type == "way":
                center = element.get("center", {})
                lat = center.get("lat")
                lon = center.get("lon")
            else:
                continue

            if not lat or not lon:
                continue

            # Get tags
            tags = element.get("tags", {})
            name = tags.get("name", "Unnamed")
            amenity = tags.get("amenity", "other")

            # Map amenity to category
            category = CATEGORY_MAP.get(amenity, "other")

            # Determine icon URL (placeholder - can be customized)
            icon_url = ""
            if category == "hospital":
                icon_url = "https://icons.example.com/hospital.png"
            elif category == "fire_station":
                icon_url = "https://icons.example.com/fire.png"
            elif category == "police_station":
                icon_url = "https://icons.example.com/police.png"
            elif category == "school":
                icon_url = "https://icons.example.com/school.png"

            # Priority boost: hospitals and fire stations get higher boost
            priority_boost = {
                "hospital": 2.0,
                "fire_station": 1.8,
                "police_station": 1.5,
                "school": 1.3,
                "market": 1.2,
            }.get(category, 1.0)

            defaults = {
                "name": name[:255],
                "category": category,
                "latitude": lat,
                "longitude": lon,
                "icon_url": icon_url,
                "is_active": True,
                "is_deleted": False,
                "priority_boost": priority_boost,
            }

            poi, created_flag = POI.objects.update_or_create(
                poi_id=poi_id,
                defaults=defaults,
            )

            if created_flag:
                created += 1
            else:
                updated += 1

        self.stdout.write(self.style.SUCCESS(f"POIs created: {created}, updated: {updated}"))
        self.stdout.write(self.style.SUCCESS(f"Total POIs in database: {POI.objects.filter(is_deleted=False, is_active=True).count()}"))