"""Receive selected records over SSH stdin; plan by default, add only with --apply."""
import json
import math
import os
from pathlib import Path
import sys
from collections import Counter


FIELDS = {
    'officers': ('badge_number', 'name', 'shift', 'status', 'skills'),
    'junctions': ('id', 'name', 'latitude', 'longitude', 'district', 'bottleneck_type',
                  'road_priority_weight', 'min_officers_required', 'max_officers_allowed',
                  'area_name', 'signal_status', 'staffing_periods', 'is_archived'),
    'markers': ('poi_id', 'name', 'category', 'latitude', 'longitude', 'icon_url',
                'is_active', 'priority_boost'),
}


def main():
    apply = '--apply' in sys.argv
    payload = json.load(sys.stdin)
    if set(payload) != set(FIELDS):
        raise ValueError('Expected only officers, junctions, and markers.')
    app = Path('/opt/trafficaux/app')
    os.chdir(app)
    sys.path.insert(0, str(app))
    for line in Path('/etc/trafficaux/backend.env').read_text().splitlines():
        key, _, value = line.partition('=')
        os.environ[key] = json.loads(value)
    import django
    django.setup()
    from django.contrib.auth import get_user_model
    from django.core import serializers
    from django.core.exceptions import ValidationError
    from django.db import connection, transaction
    from django.utils import timezone
    from core.models import Officer, Bottleneck, POI, Deployment, Incident
    from core.utils import write_audit_log
    from deployments.services import lock_schedule

    models = {'officers': Officer, 'junctions': Bottleneck, 'markers': POI}
    keys = {'officers': 'badge_number', 'junctions': 'id', 'markers': 'poi_id'}
    summary = {}
    with transaction.atomic():
        if apply:
            lock_schedule()
        else:
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
        candidates = {}
        for group, model in models.items():
            existing = list(model.objects.all())
            seen = {str(getattr(row, keys[group])).casefold() for row in existing}
            places = {(row.name.strip().casefold(), round(row.latitude, 5), round(row.longitude, 5))
                      for row in existing} if group != 'officers' else set()
            rows = []
            duplicates = invalid = 0
            validation_errors = Counter()
            for source in payload[group]:
                if set(source) != set(FIELDS[group]):
                    raise ValueError('Unexpected record fields in ' + group)
                identity = str(source[keys[group]]).casefold()
                if not identity.strip():
                    invalid += 1
                    continue
                place = None
                if group != 'officers':
                    lat, lng = source['latitude'], source['longitude']
                    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (lat, lng)) or not (-90 <= lat <= 90 and -180 <= lng <= 180):
                        invalid += 1
                        continue
                    place = (source['name'].strip().casefold(), round(lat, 5), round(lng, 5))
                if identity in seen or (place is not None and place in places):
                    duplicates += 1
                    continue
                row = model(**source)
                try:
                    row.full_clean()
                except ValidationError as error:
                    invalid += 1
                    for field, errors in error.error_dict.items():
                        for detail in errors:
                            validation_errors[field + ':' + str(detail.code)] += 1
                    continue
                seen.add(identity)
                if place is not None:
                    places.add(place)
                rows.append(row)
            candidates[group] = rows
            summary[group] = {'source': len(payload[group]), 'new': len(rows),
                              'existing_or_duplicate_skipped': duplicates, 'invalid': invalid,
                              'active_before': model.objects.filter(is_deleted=False).count()}
            if validation_errors:
                summary[group]['validation_errors'] = dict(validation_errors)
        if any(row['invalid'] for row in summary.values()):
            print(json.dumps({'mode': 'blocked_invalid_records', 'summary': summary}))
            raise SystemExit(2)
        if apply:
            backup_dir = Path('/opt/trafficaux/backups') / ('selected-records-' + timezone.now().strftime('%Y%m%dT%H%M%S%fZ'))
            backup_dir.mkdir(parents=True, mode=0o700)
            backup = backup_dir / 'existing-selected-records.json'
            with backup.open('x', encoding='utf-8') as stream:
                backup.chmod(0o600)
                serializers.serialize('json', list(Officer.objects.all()) + list(Bottleneck.objects.all()) + list(POI.objects.all()), stream=stream)
            receipt = {}
            for group, rows in candidates.items():
                receipt[group] = []
                for row in rows:
                    row.save(force_insert=True)
                    receipt[group].append(row.pk)
            actor = get_user_model().objects.get(username='demo_admin', is_superuser=True)
            write_audit_log(actor, 'import_selected_local_records', 'data_import',
                            {'counts': {group: len(rows) for group, rows in candidates.items()},
                             'policy': 'add-only; preserve existing; no accounts, coordinates of officers, incidents or schedules'})
            receipt_path = backup_dir / 'created-record-ids.json'
            with receipt_path.open('x', encoding='utf-8') as stream:
                receipt_path.chmod(0o600)
                json.dump(receipt, stream)
            for group, model in models.items():
                summary[group]['active_after'] = model.objects.filter(is_deleted=False).count()
            print('Backup and import receipt: ' + str(backup_dir))
        print(json.dumps({'mode': 'applied' if apply else 'plan', 'summary': summary,
                          'existing_deployments': Deployment.objects.filter(is_deleted=False).count(),
                          'existing_incidents': Incident.objects.filter(is_deleted=False).count()}))


if __name__ == '__main__':
    main()
