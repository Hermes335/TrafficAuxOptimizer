"""Compare one dated manual baseline with one saved recommendation/publication."""
import csv
from collections import defaultdict
from datetime import date
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q
from django.utils.dateparse import parse_datetime
from core.models import Bottleneck, Deployment, OptimizationRun, ScheduleRevision
from core.operational_time import MANILA, shift_window


class Command(BaseCommand):
    help = "Compare a dated manual baseline with an explicitly selected recommendation or publication"

    def add_arguments(self, parser):
        parser.add_argument("--location", required=True, help="Bottleneck name or district")
        parser.add_argument("--shift", choices=["morning", "afternoon"], default="afternoon")
        parser.add_argument("--date", required=True, help="Recommendation operational date (YYYY-MM-DD, Asia/Manila)")
        parser.add_argument("--manual-date", default="", help="Baseline date; defaults to --date")
        selected = parser.add_mutually_exclusive_group(required=True)
        selected.add_argument("--run-id", default="", help="Saved recommendation; works for unpublished shadow runs")
        selected.add_argument("--revision-id", type=int, default=None, help="Immutable published schedule revision")
        parser.add_argument("--observations-csv", default="", help="Optional dated field observations; raw TSI is never normalized")

    def handle(self, *args, **options):
        try:
            day = date.fromisoformat(str(options["date"]))
            manual_day = date.fromisoformat(str(options.get("manual_date") or day))
        except (TypeError, ValueError) as exc:
            raise CommandError("Provide an operational date in YYYY-MM-DD format.") from exc
        shift = options["shift"]
        location = options["location"].strip()
        revision = None
        if options.get("revision_id"):
            revision = ScheduleRevision.objects.select_related("run").filter(pk=options["revision_id"]).first()
            if not revision or revision.operational_date != day or revision.shift != shift:
                raise CommandError("The publication revision does not match this date and shift.")
            run = revision.run
        elif options.get("run_id"):
            run = OptimizationRun.objects.filter(run_id=options["run_id"], is_deleted=False, status="completed").first()
        else:
            raise CommandError("Select --run-id or --revision-id; an unscoped comparison is not supported.")
        if not run or run.parameters.get("shift") != shift:
            raise CommandError("Select a completed recommendation for the specified operational date and shift.")
        snapshot = run.result_data.get("input_snapshot") or {}
        saved_day = run.parameters.get("operational_date")
        inferred = not saved_day
        if inferred:
            captured = parse_datetime(snapshot.get("captured_at", ""))
            saved_day = str(captured.astimezone(MANILA).date()) if captured and captured.tzinfo else None
        if saved_day != str(day):
            raise CommandError("The saved recommendation date does not match --date.")
        saved_nodes = {row["id"]: row for row in snapshot.get("bottlenecks", [])}
        if not saved_nodes:
            raise CommandError("This run has no historical input snapshot. Generate a new recommendation.")
        # Historical records may refer to nodes that have since been soft-deleted or renamed.
        current_ids = set(Bottleneck.objects.filter(Q(name__iexact=location) | Q(district__iexact=location)).values_list("pk", flat=True))
        nodes = [node for key, node in saved_nodes.items() if key in current_ids or node.get("name", "").casefold() == location.casefold() or node.get("district", "").casefold() == location.casefold()]
        if not nodes:
            raise CommandError(f"No saved locations match: {location}")
        node_ids = {node["id"] for node in nodes}
        start, end = shift_window(shift, manual_day)
        manual = list(Deployment.objects.filter(bottleneck_id__in=node_ids, shift=shift, source="manual",
            is_deleted=False, status__in=["assigned", "completed"], start_time__lt=end, end_time__gt=start).select_related("officer"))
        top = run.result_data.get("top_solutions") or []
        proposals = revision.assignments if revision else top[0].get("assignments", []) if top else []
        proposed = [row for row in proposals if row.get("bottleneck_id") in node_ids]
        self.stdout.write(f"FIELD TEST COMPARISON - {location}")
        self.stdout.write(f"Asia/Manila · {shift} · Manual date {manual_day} · Recommendation date {day}")
        self.stdout.write(f"Run: {run.run_id} · Session: {run.parameters.get('session_id') or 'Unspecified'} · Mode: {run.parameters.get('mode', 'Legacy / unspecified')}")
        self.stdout.write(f"Revision: {revision.pk if revision else 'Recommendation only; no publication revision selected'}")
        if inferred:
            self.stdout.write("Legacy run: --date matches its input capture date. Its intended deployment date was not recorded.")
        self.stdout.write("Assignment records and recommendations do not establish actual officer presence or traffic effects.")
        self._report_observation_tsi(options.get("observations_csv", ""), {str(day), str(manual_day)}, location)

        manual_by_node = defaultdict(list)
        for row in manual:
            manual_by_node[row.bottleneck_id].append(row.officer.badge_number)
        proposed_by_node = defaultdict(list)
        officer_badges = {row["id"]: row.get("badge_number", str(row["id"])) for row in snapshot.get("officers", [])}
        for row in proposed:
            proposed_by_node[row["bottleneck_id"]].append(row.get("badge_number") or officer_badges.get(row.get("officer_id"), "Unknown"))
        for label, rows, officers, grouped in [
            ("MANUAL (ICTTMO) DEPLOYMENT RECORDS", manual, {row.officer_id for row in manual}, manual_by_node),
            ("PUBLISHED RECOMMENDATION" if revision else "APP RECOMMENDATION (SAVED PLAN)", proposed, {row.get("officer_id") for row in proposed}, proposed_by_node),
        ]:
            self.stdout.write(f"\n{label}")
            self.stdout.write(f"  Total assignments: {len(rows)}")
            self.stdout.write(f"  Distinct officers: {len(officers)}")
            self.stdout.write(f"  Bottlenecks covered: {len(grouped)}/{len(nodes)}")
            for node in nodes:
                self.stdout.write(f"  {node.get('name', node['id'])}: {len(grouped[node['id']])} assignment(s)")
        self.stdout.write("\nSAVED INPUT TRAFFIC SEVERITY (NORMALIZED TSI)")
        self.stdout.write("No quantitative comparison with raw field-observation TSI is performed.")
        for node in nodes:
            value = node.get("tsi")
            self.stdout.write(f"  {node.get('name', node['id'])}: {float(value) * 100:.1f}%" if value is not None else f"  {node['id']}: unavailable")
        unmatched = current_ids - set(saved_nodes)
        if unmatched:
            self.stdout.write(f"Locations absent from the saved snapshot: {', '.join(sorted(unmatched))}")
        if top and top[0].get("constraints_violated"):
            self.stdout.write("Recommendation has staffing constraint violations; it is not publishable.")

    def _report_observation_tsi(self, path, dates, location):
        if not path:
            return
        try:
            with Path(path).open(newline="", encoding="utf-8-sig") as handle:
                rows = [row for row in csv.DictReader(handle) if row.get("Date") in dates and row.get("Location", "").casefold() == location.casefold()]
        except OSError as exc:
            raise CommandError(f"Could not read observations: {exc}") from exc
        values = []
        for row in rows:
            try:
                values.append(float(row["TSI"]))
            except (KeyError, TypeError, ValueError):
                continue
        self.stdout.write(f"Matched field observations: {len(rows)}")
        if not values:
            self.stdout.write("No comparable TSI column is available; vehicle counts require explicit units and sampling duration.")
        elif any(not 0 <= value <= 1 for value in values):
            self.stdout.write("Field observation TSI is not comparable to application TSI: values fall outside [0,1]. No conversion was applied.")
        else:
            self.stdout.write("Field observation TSI source semantics require confirmation; no conversion or numerical comparison was applied.")
