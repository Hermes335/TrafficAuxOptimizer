from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0013_public_incident_reports")]

    operations = [
        migrations.AddField(
            model_name="officer",
            name="current_location_recorded_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
