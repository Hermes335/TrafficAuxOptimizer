import pytest
from django.core.management import call_command

from core.models import Bottleneck


@pytest.mark.django_db
def test_field_test_compare_selects_explicit_location_and_skips_raw_tsi_comparison(tmp_path, capsys):
    Bottleneck.objects.create(
        id="ATR-001",
        name="Atrium Rotonda",
        district="Iloilo City",
        latitude=10.72,
        longitude=122.56,
        tsi=0.41,
    )
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
    )

    output = capsys.readouterr().out
    assert "FIELD TEST COMPARISON - Atrium Rotonda" in output
    assert "not comparable" in output
    assert "No quantitative comparison with raw field-observation TSI is performed." in output
    assert "41.0%" in output


@pytest.mark.django_db
def test_field_test_compare_can_select_historical_district(capsys):
    Bottleneck.objects.create(
        id="DRJ-001",
        name="Jaro Plaza",
        district="Diversion Road + Jaro",
        latitude=10.72,
        longitude=122.56,
        tsi=0.35,
    )

    call_command("field_test_compare", location="Diversion Road + Jaro", shift="afternoon")

    assert "FIELD TEST COMPARISON - Diversion Road + Jaro" in capsys.readouterr().out