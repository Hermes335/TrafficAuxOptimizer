"""Private on-VM smoke test. Credentials arrive on stdin and are never printed."""
import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def main():
    config = json.load(sys.stdin)
    if "--refresh-providers" in sys.argv:
        sys.path.insert(0, "/opt/trafficaux/app")
        for line in Path("/etc/trafficaux/backend.env").read_text().splitlines():
            key, _, value = line.partition("=")
            os.environ[key] = json.loads(value)
        import django
        django.setup()
        from external.tasks import fetch_traffic_data, fetch_weather_data
        for task in (fetch_traffic_data, fetch_weather_data):
            result = task.delay()
            summary = result.get(timeout=180)
            print(task.name, ":", json.dumps(summary, default=str))
    headers = {"Host": config["hostname"], "Origin": config["frontend"]}

    def request(path, method="GET", payload=None, extra=None):
        request_headers = dict(headers, **(extra or {}))
        data = None if payload is None else json.dumps(payload).encode()
        if data is not None:
            request_headers["Content-Type"] = "application/json"
        message = Request("http://127.0.0.1" + path, data=data,
                          headers=request_headers, method=method)
        try:
            with urlopen(message, timeout=30) as response:
                body = response.read()
                return response.status, response.headers, json.loads(body) if body else None
        except HTTPError as error:
            return error.code, error.headers, None

    status, _, health = request("/api/health/")
    assert status == 200 and health["status"] == "ok", "API health failed"
    status, _, _ = request("/api/dashboard/officers/")
    assert status == 401, "Anonymous roster access was not rejected"
    status, response_headers, credentials = request("/api/auth/login/", "POST",
        {"username": "demo_admin", "password": config["demo_password"]})
    assert status == 200, f"Login returned HTTP {status}"
    assert response_headers.get("Access-Control-Allow-Origin") == config["frontend"]
    token_headers = {"Authorization": "Bearer " + credentials["access"]}
    for route, expected in (("officers", 24), ("bottlenecks", 10)):
        status, _, rows = request("/api/dashboard/" + route + "/", extra=token_headers)
        assert status == 200, f"{route} returned HTTP {status}"
        results = rows if isinstance(rows, list) else rows["results"]
        assert len(results) == expected, f"Unexpected initial fictional {route} count"
    status, _, health = request("/api/admin/system-health/", extra=token_headers)
    assert status == 200, f"Detailed system health returned HTTP {status}"
    print("PASS: login, exact-origin CORS, anonymous rejection, and database-backed roster/map.")
    print("System health:", json.dumps(health, default=str))


if __name__ == "__main__":
    main()
