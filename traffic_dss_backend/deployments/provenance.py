"""Read publication identity from the persisted ledger, not browser state.

The ledger is immutable, while deployments retain their revision through manual
edits. Compare merged service intervals and consult mutation audit entries so a
normal completion or a harmless split does not look like a manual edit. All
history rows in a request share one reader (a bounded number of database queries).
"""
from collections import defaultdict
from datetime import datetime

from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core.models import AuditLog, Deployment, ScheduleRevision
from core.operational_time import shift_window


def _moment(value):
    if isinstance(value, datetime):
        return value if timezone.is_aware(value) else None
    if not isinstance(value, str):
        return None
    try:
        value = parse_datetime(value)
    except (TypeError, ValueError):
        return None
    return value if value and timezone.is_aware(value) else None


def _merge(windows):
    merged = []
    for left, right in sorted(windows):
        if left >= right:
            continue
        if merged and left <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(right, merged[-1][1]))
        else:
            merged.append((left, right))
    return merged


def _subtract(windows, removed):
    remaining = list(windows)
    for cut_start, cut_end in _merge(removed):
        next_windows = []
        for left, right in remaining:
            if left < min(right, cut_start):
                next_windows.append((left, min(right, cut_start)))
            if max(left, cut_end) < right:
                next_windows.append((max(left, cut_end), right))
        remaining = next_windows
    return _merge(remaining)


def _overlaps(left, right, windows):
    return left is not None and right is not None and any(left < end and right > start for start, end in windows)


def _canonical(rows, windows, include_type):
    """Ignore row IDs and completed/assigned transitions; preserve real geometry."""
    grouped = defaultdict(list)
    if not isinstance(rows, list):
        return None
    for row in rows:
        if not isinstance(row, dict):
            return None
        left, right = _moment(row.get("start_time")), _moment(row.get("end_time"))
        if left is None or right is None or left >= right or not row.get("officer_id") or not row.get("bottleneck_id"):
            return None
        if not isinstance(row["officer_id"], (str, int)) or isinstance(row["officer_id"], bool) or not isinstance(row["bottleneck_id"], str):
            return None
        if include_type and (not isinstance(row.get("assignment_type"), str) or not row["assignment_type"]):
            return None
        key = (str(row["officer_id"]), str(row["bottleneck_id"]), row.get("assignment_type") if include_type else None)
        for start, end in windows:
            if left < end and right > start:
                grouped[key].append((max(left, start), min(right, end)))
    return {key: _merge(value) for key, value in grouped.items()}


def _unpublished(run):
    parameters = run.parameters if isinstance(run.parameters, dict) else {}
    return {"state": "unpublished", "run_id": run.run_id, "publication_count": 0,
            "revision_id": None, "operational_date": parameters.get("operational_date") if isinstance(parameters.get("operational_date"), str) else None,
            "shift": parameters.get("shift") if parameters.get("shift") in ("morning", "afternoon") else None,
            "published_at": None, "published_by": None,
            "effective_start": None, "effective_end": None, "replacing_run_ids": [],
            "manual_changes": False,
            "message": "Shadow comparison only; this recommendation has not been published." if parameters.get("mode") == "shadow"
            else "No publication is recorded for this recommendation."}


class PublicationProvenance:
    """Batch publication lookups for either a history page or selected shifts."""

    def __init__(self, runs=(), scopes=()):
        self.runs = {run.pk: run for run in runs}
        selected = set(scopes)
        if self.runs:
            selected.update(ScheduleRevision.objects.filter(run_id__in=self.runs).values_list("operational_date", "shift"))
        self.revisions = []
        self.rows = []
        self.audits = []
        self.by_scope = defaultdict(list)
        self.by_run = defaultdict(list)
        self.rows_by_id = {}
        self._states = {}
        if not selected:
            return
        revision_filter, row_filter = Q(), Q()
        for day, shift in selected:
            start, end = shift_window(shift, day)
            revision_filter |= Q(operational_date=day, shift=shift)
            row_filter |= Q(shift=shift, start_time__lt=end, end_time__gt=start)
        self.revisions = list(ScheduleRevision.objects.filter(revision_filter).select_related("run", "actor").order_by("published_at", "pk"))
        for revision in self.revisions:
            self.by_scope[(revision.operational_date, revision.shift)].append(revision)
            self.by_run[revision.run_id].append(revision)
        # Include cancelled/deleted rows to resolve the immutable snapshots of
        # later publications. They are excluded from surviving service below.
        self.rows = list(Deployment.objects.filter(row_filter).values(
            "id", "officer_id", "bottleneck_id", "shift", "start_time", "end_time",
            "assignment_type", "status", "source", "revision_id", "is_deleted"))
        self.rows_by_id = {row["id"]: row for row in self.rows}
        if self.revisions:
            self.audits = list(AuditLog.objects.filter(resource="deployment_schedule",
                action__in=["create", "update", "clear"], timestamp__gte=self.revisions[0].published_at,
            ).filter(Q(action="clear") | Q(changes__deployment_id__in=list(self.rows_by_id)))
                .values("action", "changes", "timestamp"))

    def for_run(self, run):
        revisions = self.by_run.get(run.pk, [])
        return self.for_revision(revisions[-1]) if revisions else _unpublished(run)

    @staticmethod
    def _replacement_mode(revision):
        response = revision.response if isinstance(revision.response, dict) else {}
        if isinstance(response.get("replace_existing"), bool):
            return response["replace_existing"]
        # Before the explicit flag was recorded, a nonempty previous snapshot
        # proves replacement; an empty one cannot prove replacement vs append.
        if isinstance(revision.previous_assignments, list) and revision.previous_assignments:
            return True
        if isinstance(response.get("replaced"), int) and response["replaced"] > 0:
            return True
        return None

    def _manual_changes(self, revision, windows):
        def related_row(identifier):
            try:
                return self.rows_by_id.get(identifier)
            except TypeError:
                return None

        for event in self.audits:
            if event["timestamp"] < revision.published_at:
                continue
            changes = event["changes"]
            if not isinstance(changes, dict):
                continue
            if event["action"] == "update" and isinstance(changes.get("previous_assignment"), dict) and isinstance(changes.get("assignment"), dict):
                before, after = changes["previous_assignment"], changes["assignment"]
                expected = _canonical([before], windows, True)
                preserved = changes.get("preserved_assignments", [])
                rows = preserved if isinstance(preserved, list) else []
                actual = _canonical(rows + ([after] if after.get("status") in {"assigned", "completed"} else []), windows, True)
                if expected is not None and actual is not None and expected == actual:
                    continue  # Saving unchanged service does not modify a publication.
            if event["action"] == "clear":
                previous = changes.get("previous_assignments", [])
                if not isinstance(previous, list):
                    continue
                for previous_row in previous:
                    if not isinstance(previous_row, dict):
                        continue
                    row = related_row(previous_row.get("deployment_id"))
                    if row and row["shift"] == revision.shift and _overlaps(
                            _moment(previous_row.get("start_time")), _moment(previous_row.get("end_time")), windows):
                        include_type = bool(previous_row.get("assignment_type"))
                        before = _canonical([previous_row], windows, include_type)
                        after = _canonical([row] if not row["is_deleted"] and row["status"] in {"assigned", "completed"} else [], windows, include_type)
                        if before is None or after is None or before != after:
                            return True
            else:
                row = related_row(changes.get("deployment_id"))
                if row and row["shift"] == revision.shift and _overlaps(row["start_time"], row["end_time"], windows):
                    return True
        return False

    def for_revision(self, revision):
        if revision.pk in self._states:
            return self._states[revision.pk]
        revisions = self.by_scope[(revision.operational_date, revision.shift)]
        original = [(revision.effective_start, revision.effective_end)]
        replaced, replacing, uncertain = [], [], False
        for later in revisions:
            if (later.published_at, later.pk) <= (revision.published_at, revision.pk):
                continue
            if not _overlaps(later.effective_start, later.effective_end, original):
                continue
            replacement = self._replacement_mode(later)
            if replacement:
                replaced.append((later.effective_start, later.effective_end))
                if later.run.run_id != revision.run.run_id and later.run.run_id not in replacing:
                    replacing.append(later.run.run_id)
            elif replacement is None:
                # An older ambiguous receipt must not invent a replacement.
                uncertain = True
        remaining = _subtract(original, replaced)
        manual = self._manual_changes(revision, remaining)
        own_rows = [row for row in self.rows if row["revision_id"] == revision.pk and not row["is_deleted"]
                    and row["status"] in {"assigned", "completed"}]
        snapshot = revision.assignments
        include_type = isinstance(snapshot, list) and bool(snapshot) and all(isinstance(row, dict) and row.get("assignment_type") for row in snapshot)
        expected = _canonical(snapshot, remaining, include_type)
        current = _canonical(own_rows, remaining, include_type)
        changed = expected is not None and current is not None and expected != current
        # Missing service with no proven replacing revision is a real edit or
        # clear, including edits whose original source remains "optimized".
        manual = manual or changed
        valid_window = revision.effective_start < revision.effective_end
        if not valid_window:
            state, message = "unknown", "Publication is recorded, but its saved effective window is invalid."
        elif not remaining:
            state, message = "replaced", "A later publication replaced this recommendation's entire effective window."
        elif expected is None or current is None or uncertain:
            state, message = "unknown", "Publication is recorded, but legacy records do not establish its current schedule status."
        elif remaining != original:
            state, message = "partially_replaced", "A later publication replaced part of this recommendation's effective window."
        elif manual:
            state, message = "modified", "Published; manual schedule changes have been recorded since publication."
        else:
            state, message = "published", "Published assignments match this recommendation's saved publication."
        if state == "partially_replaced" and manual:
            message += " Manual changes also affect the retained periods."
        value = {"state": state, "run_id": revision.run.run_id,
                 "publication_count": len(self.by_run[revision.run_id]), "revision_id": revision.pk,
                 "operational_date": str(revision.operational_date), "shift": revision.shift,
                 "published_at": revision.published_at.isoformat(), "published_by": revision.actor.get_username(),
                 "effective_start": revision.effective_start.isoformat(), "effective_end": revision.effective_end.isoformat(),
                 "replacing_run_ids": replacing, "manual_changes": manual, "message": message}
        self._states[revision.pk] = value
        return value

    def for_schedule(self, day, shifts):
        summaries = []
        for shift in shifts:
            start, end = shift_window(shift, day)
            rows = [row for row in self.rows if row["shift"] == shift and row["start_time"] < end and row["end_time"] > start
                    and not row["is_deleted"] and row["status"] in {"assigned", "completed"}]
            revisions = self.by_scope[(day, shift)]
            latest = self.for_revision(revisions[-1]) if revisions else None
            counts = defaultdict(int)
            for row in rows:
                if row["revision_id"] is not None:
                    counts[row["revision_id"]] += 1
            sources = [{"revision_id": revision.pk, "run_id": revision.run.run_id,
                        "published_at": revision.published_at.isoformat(), "published_by": revision.actor.get_username(),
                        "assignment_count": counts[revision.pk]} for revision in reversed(revisions) if counts[revision.pk]]
            summaries.append({"shift": shift, "latest_publication": latest,
                "manual_assignment_count": sum(row["source"] == "manual" for row in rows),
                "optimized_assignment_count": sum(row["source"] == "optimized" for row in rows),
                "assignments_changed_since_publication": bool(latest and latest["manual_changes"]), "sources": sources})
        return {"operational_date": str(day), "checked_at": timezone.now().isoformat(), "shifts": summaries}
