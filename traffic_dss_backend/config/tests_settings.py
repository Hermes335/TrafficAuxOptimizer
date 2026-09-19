import os
import subprocess
import sys
from pathlib import Path

import pytest
from django.conf import settings


PROJECT_ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.django_db
def test_local_settings_remain_development_friendly():
    assert settings.DEPLOYMENT_ENV == "development"
    assert isinstance(settings.DEBUG, bool)
    assert isinstance(settings.CORS_ALLOW_ALL_ORIGINS, bool)


def _run_production_settings(extra_env: dict[str, str]):
    environment = os.environ.copy()
    environment.update(extra_env)
    return subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        cwd=PROJECT_ROOT,
        env=environment,
        capture_output=True,
        text=True,
    )


def test_development_settings_allow_explicit_debug():
    result = _run_production_settings({
        "DJANGO_ENV": "development",
        "DEBUG": "True",
        "CORS_ALLOW_ALL_ORIGINS": "True",
    })

    assert result.returncode == 0, result.stderr


def test_production_settings_require_real_secrets_and_cors_allowlist():
    result = _run_production_settings({
        "DJANGO_ENV": "production",
        "DEBUG": "False",
        "SECRET_KEY": "production-secret-" + "a" * 32,
        "JWT_SECRET_KEY": "jwt-production-secret-" + "b" * 32,
        "CORS_ALLOW_ALL_ORIGINS": "False",
        "CORS_ALLOWED_ORIGINS": "https://example.invalid",
    })

    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("variable", ["SECRET_KEY", "JWT_SECRET_KEY"])
def test_production_settings_reject_placeholder_secrets(variable):
    result = _run_production_settings({
        "DJANGO_ENV": "production",
        "DEBUG": "False",
        "SECRET_KEY": "production-secret-" + "a" * 32,
        "JWT_SECRET_KEY": "jwt-production-secret-" + "b" * 32,
        "CORS_ALLOW_ALL_ORIGINS": "False",
        "CORS_ALLOWED_ORIGINS": "https://example.invalid",
        variable: "change-me",
    })

    assert result.returncode != 0
    assert variable in result.stderr


def test_production_settings_reject_allow_all_cors_without_allowlist():
    result = _run_production_settings({
        "DJANGO_ENV": "production",
        "DEBUG": "False",
        "SECRET_KEY": "production-secret-" + "a" * 32,
        "JWT_SECRET_KEY": "jwt-production-secret-" + "b" * 32,
        "CORS_ALLOW_ALL_ORIGINS": "True",
        "CORS_ALLOWED_ORIGINS": "",
    })

    assert result.returncode != 0
    assert "CORS_ALLOW_ALL_ORIGINS" in result.stderr