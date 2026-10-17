import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def populate_references(apps, schema_editor):
    incident = apps.get_model("core", "Incident")
    for pk in incident.objects.using(schema_editor.connection.alias).values_list("pk", flat=True).iterator():
        incident.objects.using(schema_editor.connection.alias).filter(pk=pk).update(reference=uuid.uuid4())


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("core", "0012_deployment_override_reason_officertimeblock_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="incident", name="reported_by",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                    related_name="reported_incidents", to=settings.AUTH_USER_MODEL),
        ),
        migrations.AlterField(
            model_name="incident", name="status",
            field=models.CharField(choices=[("pending", "Pending review"), ("rejected", "Rejected"),
                                            ("active", "Active"), ("investigating", "Investigating"),
                                            ("resolved", "Resolved"), ("archived", "Archived")],
                                   db_index=True, default="active", max_length=20),
        ),
        migrations.AddField(model_name="incident", name="photo_path", field=models.CharField(blank=True, max_length=255)),
        migrations.AddField(model_name="incident", name="source", field=models.CharField(
            choices=[("staff", "Staff"), ("public", "Public")], default="staff", max_length=12)),
        # Populate per row before adding the unique constraint on existing data.
        migrations.AddField(model_name="incident", name="reference", field=models.UUIDField(null=True, editable=False)),
        migrations.RunPython(populate_references, migrations.RunPython.noop),
        migrations.AlterField(model_name="incident", name="reference", field=models.UUIDField(default=uuid.uuid4, unique=True, editable=False)),
        migrations.AddField(model_name="incident", name="submission_key", field=models.UUIDField(blank=True, null=True, unique=True, editable=False)),
        migrations.AddField(model_name="incident", name="submission_fingerprint", field=models.CharField(blank=True, max_length=64, editable=False)),
        migrations.AddField(model_name="incident", name="reviewed_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="incident", name="reviewed_by", field=models.ForeignKey(
            blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
            related_name="reviewed_incidents", to=settings.AUTH_USER_MODEL)),
    ]
