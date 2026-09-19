from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0007_bottleneck_max_officers_allowed_and_more"),
    ]

    operations = [
        migrations.AddField("trafficdata", "source", models.CharField(default="unknown", max_length=40)),
        migrations.AddField("trafficdata", "data_status", models.CharField(default="unknown", max_length=20)),
        migrations.AddField("trafficdata", "is_synthetic", models.BooleanField(default=False)),
        migrations.AddField("trafficdata", "is_stale", models.BooleanField(default=False)),
        migrations.AddField("trafficdata", "fetched_at", models.DateTimeField(blank=True, null=True)),
        migrations.AddField("trafficdata", "observed_at", models.DateTimeField(blank=True, null=True)),
        migrations.AddField("weatherdata", "source", models.CharField(default="unknown", max_length=40)),
        migrations.AddField("weatherdata", "data_status", models.CharField(default="unknown", max_length=20)),
        migrations.AddField("weatherdata", "is_synthetic", models.BooleanField(default=False)),
        migrations.AddField("weatherdata", "is_stale", models.BooleanField(default=False)),
        migrations.AddField("weatherdata", "fetched_at", models.DateTimeField(blank=True, null=True)),
        migrations.AddField("weatherdata", "observed_at", models.DateTimeField(blank=True, null=True)),
    ]