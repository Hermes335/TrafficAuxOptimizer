import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("traffic_dss_backend")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

app.conf.beat_schedule = {
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
}
