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
            "App_Weather_Factor", "Traffic_Source", "Traffic_Status", "Published", "Supervisor_Decision", "Date_Source",
            "Period_Start", "Period_End", "Required_Officers", "Requirement_Reason", "Area",
            "Skill_Policy_Version", "Preferred_Skills", "Skill_Match_Statuses", "Matched_Skills", "Skill_Match_Reasons",
            "Initial_Location_Policy", "Origin_Reset", "Default_Origin_Name", "Default_Origin_Latitude", "Default_Origin_Longitude"])
        captured = parse_datetime(snapshot.get("captured_at", ""))
        timestamp = captured.astimezone(MANILA).isoformat() if captured and captured.tzinfo else ""
        assignments = top[0].get("assignments") or []
        officers = {row["id"]: row for row in snapshot.get("officers", [])}
        published = run.publications.exists()
        travel = snapshot.get("travel_time_model") or {}
        origin = travel.get("default_origin") or {}
        legacy = not run.parameters.get("operational_date")
        target_date = run.parameters.get("operational_date") or (str(captured.astimezone(MANILA).date()) if captured and captured.tzinfo else "")
        for period in top[0].get("time_periods") or [None]:
            for node in snapshot.get("bottlenecks", []):
                assigned = [a for a in assignments if a.get("bottleneck_id") == node["id"]]
                if period:
                    instant = parse_datetime(period["start_time"])
                    assigned = [a for a in assigned if parse_datetime(a["start_time"]) <= instant < parse_datetime(a["end_time"])]
                requirement = next((r for r in period["requirements"] if r["bottleneck_id"] == node["id"]), {}) if period else {}
                badges = ";".join(officers.get(a.get("officer_id"), {}).get("badge_number", "") for a in assigned)
                # Historical evidence comes only from the saved recommendation.
                # Older runs have blank skill columns; today's roster cannot assess them retroactively.
                assessed = [(officers.get(a.get("officer_id"), {}).get("badge_number", str(a.get("officer_id", ""))), a["skill_match"])
                    for a in assigned if isinstance(a.get("skill_match"), dict)]
                skill_statuses = " | ".join(f"{badge}: {match.get('status', '')}" for badge, match in assessed)
                matched_skills = " | ".join(f"{badge}: {';'.join(match.get('matched_skills') or [])}" for badge, match in assessed)
                skill_reasons = " | ".join(f"{badge}: {match.get('explanation', '')}" for badge, match in assessed)
                provenance = node.get("provenance") or {}
                writer.writerow([csv_text(value) for value in [run.run_id, run.parameters.get("session_id"),
                    run.parameters.get("mode", "legacy_unknown"), target_date, run.parameters.get("shift"),
                    timestamp, "Asia/Manila", node["id"], node.get("name"), len(assigned), badges, node.get("tsi"),
                    snapshot.get("weather", {}).get("impact_factor"), provenance.get("source"), provenance.get("data_status"),
                    "Yes" if published else "Unknown (legacy)" if legacy else "No",
                    "Published by supervisor" if published else "Unknown (legacy)" if legacy else "Pending",
                    "Input capture date (legacy)" if legacy else "Recorded operational date",
                    period["start_time"] if period else "", period["end_time"] if period else "",
                    requirement.get("required", ""), requirement.get("reason", ""), node.get("area_name", ""),
                    snapshot.get("skill_policy_version", ""), ";".join(node.get("preferred_skills") or []),
                    skill_statuses, matched_skills, skill_reasons,
                    travel.get("initial_location_policy", ""), travel.get("origin_reset", ""), origin.get("name", ""),
                    origin.get("latitude", ""), origin.get("longitude", "")]])
        return response
