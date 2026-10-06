import logging
from unittest.mock import Mock, patch

import pytest
import requests

from external.clients import ProviderError, logger, request_with_backoff


def response(status=200):
    result = Mock(status_code=status)
    result.json.return_value = {"ok": True}
    if status >= 400:
        result.raise_for_status.side_effect = requests.HTTPError("url?key=secret-value")
    return result


@pytest.mark.parametrize("status", [400, 401, 403, 404, 429])
def test_access_coverage_and_quota_errors_are_not_retried(status, caplog):
    caplog.set_level(logging.INFO, logger="external_apis")
    with patch.object(logger, "handlers", [caplog.handler]), patch(
        "external.clients.requests.get", return_value=response(status)
    ) as get, patch("external.clients.time.sleep") as sleep:
        with pytest.raises(ProviderError) as error:
            request_with_backoff("https://api.tomtom.com/flow?key=secret-value")
    assert get.call_count == 1
    sleep.assert_not_called()
    # A propagating logger would deliver this record twice to the same handler.
    assert len(caplog.records) == 1
    assert caplog.records[0].levelno == logging.WARNING
    assert "provider=api.tomtom.com" in caplog.text
    assert f"status={status}" in caplog.text
    assert "secret-value" not in caplog.text + str(error.value)


@pytest.mark.parametrize("first", [requests.ReadTimeout("key=secret-value"), response(503)])
def test_transient_failure_can_recover(first):
    with patch("external.clients.requests.get", side_effect=[first, response()]) as get, patch(
        "external.clients.time.sleep"
    ) as sleep:
        assert request_with_backoff("https://api.tomtom.com/flow") == {"ok": True}
    assert get.call_count == 2
    sleep.assert_called_once_with(1.0)


def test_exhausted_timeouts_warn_once_and_keep_credentials_private(caplog):
    caplog.set_level(logging.INFO, logger="external_apis")
    with patch.object(logger, "handlers", [caplog.handler]), patch(
        "external.clients.requests.get", side_effect=requests.ConnectTimeout("key=secret-value")
    ) as get, patch("external.clients.time.sleep") as sleep:
        with pytest.raises(ProviderError) as error:
            request_with_backoff("https://api.tomtom.com/flow")
    assert get.call_count == 3
    assert sleep.call_count == 2
    assert [r.levelno for r in caplog.records] == [logging.INFO, logging.INFO, logging.WARNING]
    assert "reason=ConnectTimeout" in caplog.text
    assert "secret-value" not in caplog.text + str(error.value)


def test_invalid_json_is_reported_without_repeated_requests():
    invalid = response()
    invalid.json.side_effect = ValueError("invalid response")
    with patch("external.clients.requests.get", return_value=invalid) as get:
        with pytest.raises(ProviderError, match="ValueError"):
            request_with_backoff("https://api.open-meteo.com/v1/forecast")
    get.assert_called_once()
