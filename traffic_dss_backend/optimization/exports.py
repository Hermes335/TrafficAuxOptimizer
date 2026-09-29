import csv
from django.http import HttpResponse
from django.utils.dateparse import parse_datetime
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from core.models import OptimizationRun
from core.operational_time import MANILA


def csv_text(value):
    value = str("" if value is None else value)
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value


class RecommendationExportView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = "operational_read"

    def get(self, request, run_id):
        run = OptimizationRun.objects.filter(run_id=run_id, is_deleted=False, status="completed").first()
        if not run:
            return Response({"detail": "Completed recommendation not found."}, status=404)
        snapshot = run.result_data.get("input_snapshot") or {}
        top = run.result_data.get("top_solutions") or []
        if not snapshot or not top:
            return Response({"detail": "This legacy result has no exportable input snapshot. Run optimization again."}, status=409)
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="recommendation-{run.pk}.csv"'
        writer = csv.writer(response)
        writer.writerow(["Run_ID", "Session_ID", "Mode", "Operational_Date", "Shift", "Captured_At", "Timezone",
            "Bottleneck_ID", "Location", "App_Recommended_Officers", "Recommended_Badges", "App_TSI",
            "App_Weather_Factor", "Traffic_Source", "Traffic_Status", "Published", "Supervisor_Decision", "Date_Source"])
        captured = parse_datetime(snapshot.get("captured_at", ""))
        timestamp = captured.astimezone(MANILA).isoformat() if captured and captured.tzinfo else ""
        assignments = top[0].get("assignments") or []
        officers = {row["id"]: row for row in snapshot.get("officers", [])}
        published = run.publications.exists()
        legacy = not run.parameters.get("operational_date")
        target_date = run.parameters.get("operational_date") or (str(captured.astimezone(MANILA).date()) if captured and captured.tzinfo else "")
        for node in snapshot.get("bottlenecks", []):
            assigned = [a for a in assignments if a.get("bottleneck_id") == node["id"]]
            badges = ";".join(officers.get(a.get("officer_id"), {}).get("badge_number", "") for a in assigned)
            provenance = node.get("provenance") or {}
            writer.writerow([csv_text(value) for value in [run.run_id, run.parameters.get("session_id"),
                run.parameters.get("mode", "legacy_unknown"), target_date, run.parameters.get("shift"),
                timestamp, "Asia/Manila", node["id"], node.get("name"), len(assigned), badges, node.get("tsi"),
                snapshot.get("weather", {}).get("impact_factor"), provenance.get("source"), provenance.get("data_status"),
                "Yes" if published else "Unknown (legacy)" if legacy else "No",
                "Published by supervisor" if published else "Unknown (legacy)" if legacy else "Pending",
                "Input capture date (legacy)" if legacy else "Recorded operational date"]])
        return response
