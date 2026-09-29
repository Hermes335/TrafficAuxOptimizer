import pytest
from django.core.management import call_command
from django.contrib.auth import get_user_model
from django.utils import timezone

from core.models import Bottleneck, OptimizationRun


def recommendation(node):
    user = get_user_model().objects.create_user(username="field-review")
    return OptimizationRun.objects.create(run_id="field-review-run", timestamp=timezone.now(), created_by=user,
        status="completed", parameters={"shift": "afternoon", "operational_date": "2026-09-11", "mode": "shadow"},
        result_data={"top_solutions": [{"assignments": []}], "input_snapshot": {"bottlenecks": [
            {"id": node.pk, "name": node.name, "tsi": node.tsi}]}})


@pytest.mark.django_db
def test_field_test_compare_selects_explicit_location_and_skips_raw_tsi_comparison(tmp_path, capsys):
    node = Bottleneck.objects.create(
        id="ATR-001",
        name="Atrium Rotonda",
        district="Iloilo City",
        latitude=10.72,
        longitude=122.56,
        tsi=0.41,
    )
    run = recommendation(node)
    Bottleneck.objects.filter(pk=node.pk).update(tsi=0.99)
    observations = tmp_path / "observations.csv"
    observations.write_text(
        "Date,Time,Location,TSI\n2026-09-11,17:15,Atrium Rotonda,221\n",
        encoding="utf-8",
    )

    call_command(
        "field_test_compare",
        location="Atrium Rotonda",
        shift="afternoon",
        observations_csv=str(observations),
        date="2026-09-11", run_id=run.run_id,
    )

    output = capsys.readouterr().out
    assert "FIELD TEST COMPARISON - Atrium Rotonda" in output
    assert "not comparable" in output
    assert "No quantitative comparison with raw field-observation TSI is performed." in output
    assert "41.0%" in output


@pytest.mark.django_db
def test_field_test_compare_can_select_historical_district(capsys):
    node = Bottleneck.objects.create(
        id="DRJ-001",
        name="Jaro Plaza",
        district="Diversion Road + Jaro",
        latitude=10.72,
        longitude=122.56,
        tsi=0.35,
    )

    run = recommendation(node)
    call_command("field_test_compare", location="Diversion Road + Jaro", shift="afternoon", date="2026-09-11", run_id=run.run_id)

    assert "FIELD TEST COMPARISON - Diversion Road + Jaro" in capsys.readouterr().out
