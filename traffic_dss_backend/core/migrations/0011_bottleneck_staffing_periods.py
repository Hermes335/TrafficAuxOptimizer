from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0010_publication_history_and_run_health")]
    operations = [
        migrations.AddField(model_name="bottleneck", name="area_name", field=models.CharField(blank=True, max_length=120)),
        migrations.AddField(model_name="bottleneck", name="signal_status", field=models.CharField(max_length=20, default="unknown", choices=[
            ("unknown", "Unknown"), ("working", "Working traffic lights"), ("none", "No traffic lights"), ("out_of_order", "Traffic lights out of order")])),
        migrations.AddField(model_name="bottleneck", name="staffing_periods", field=models.JSONField(default=list, blank=True)),
    ]
