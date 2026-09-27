from django.db import migrations


def roles(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    for name in ("supervisor", "dispatcher"):
        Group.objects.get_or_create(name=name)


class Migration(migrations.Migration):
    dependencies = [("core", "0008_external_data_provenance"), ("auth", "0012_alter_user_first_name_max_length")]
    operations = [
        migrations.RemoveConstraint(model_name="deployment", name="unique_officer_shift_assignment"),
        migrations.DeleteModel(name="Scenario"),
        migrations.RunPython(roles, migrations.RunPython.noop),
    ]
