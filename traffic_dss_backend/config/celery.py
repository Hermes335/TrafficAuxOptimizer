import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("traffic_dss_backend")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

app.conf.beat_schedule = {
    "deployment-lifecycle": {"task": "core.tasks.deployment_lifecycle", "schedule": 60.0},
    "fetch-traffic-data-every-5-minutes": {
        "task": "external.tasks.fetch_traffic_data",
        "schedule": 300.0,
    },
    "fetch-weather-data-every-15-minutes": {
        "task": "external.tasks.fetch_weather_data",
        "schedule": 900.0,
    },
    "cleanup-old-data-daily": {
        "task": "external.tasks.cleanup_old_data",
        "schedule": 86400.0,
    },
    # Incident lifecycle - resolve stale incidents after 4 hours
    "incident-lifecycle-every-5-minutes": {
        "task": "core.tasks.incident_lifecycle",
        "schedule": 300.0,
    },
    # Incident archiving - archive resolved incidents after 24 hours
    "incident-archive-daily": {
        "task": "core.tasks.incident_archive",
        "schedule": 86400.0,  # Run once daily
    },
    # Heatmap TSI computation - 5 min during peak, 15 min off-peak
    "compute-heatmap-tsi-every-5-minutes": {
        "task": "core.tasks.compute_heatmap_tsi",
        "schedule": 300.0,
    },
}
