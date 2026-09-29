# September 27 review fixes — implementation report

## Scope

Implemented the 12 numbered findings in `MDFILES/CODE_REVIEW_2026-09-27.md`, plus directly related publication readability, incident accessibility, POI filtering, export, and documentation improvements.

The optimizer's search and fitness implementation in `optimization/engine.py` is unchanged. Input collection is batched and captured consistently; run metadata, job monitoring, publication validation, and display calculations changed. These changes can affect whether a recommendation is eligible for publication.

During the initial code implementation, no operational database migration, schedule publication, external-provider request, or change to the September 25 pilot CSVs was performed. Regression verification used isolated SQLite and in-memory services. The subsequent local database repair is recorded below. The original review remains a historical record.

## Changes by finding

| Review finding | Implemented fix |
| --- | --- |
| 1. Stale inputs/current staffing | Publication checks capture and observation freshness, recorded date, current active locations, incidents, and staffing requirements throughout the proposed interval. Stale/unverified inputs require refreshed inputs or a supervisor's audited override reason. Synthetic inputs and staffing violations remain blocked. |
| 2. Backdating/history | Same-day publication starts at the actual effective time, preserves elapsed assignment intervals, cancels superseded future assignments, and records run, actor, effective interval, and assignment snapshots in a publication revision. Preview versions reject intervening schedule changes; idempotency receipts make identical retries safe. The board has paginated publication history. Clearing a schedule also preserves elapsed service. |
| 3. Incident editing | Edit initialization waits for all required data and never applies creation defaults. Loading failures are visible and block submission; retry is available. Location changes are submitted and validated, with node coordinates updated consistently. |
| 4. Operational data exposure | Roster, run status/history/results, and optimization WebSockets require authentication. Public bottlenecks omit officer names/badges. History uses an explicit, compact summary instead of full input snapshots; read endpoints have scoped throttling. |
| 5. Shadow mode | Runs persist operational date, mode, and session ID. Shadow mode requires a session name and is blocked from publication by the API and UI. Recommendation exports distinguish saved recommendations, recorded publications, and unknown legacy states. |
| 6. Board counts/coverage | Availability and active counts use the full date/shift scope independently of text search. Completed rows are excluded from active counts. Coverage uses complete timestamps and labels cells as staffing at each displayed Manila hour; completed service remains visible in historical coverage. |
| 7. Field comparison | The command requires an explicit date and run or revision, uses saved TSI/recommendations, scopes manual intervals to the selected baseline date/shift, and supports a different manual baseline date. Legacy capture-date inference is explicitly labelled. Exports include run/session/date/timezone/location IDs and provenance. |
| 8. TSI thresholds | API responses retain raw TSI precision; rounding is reserved for display. Boundary regression cases cover values immediately below congestion thresholds. |
| 9. Mutation audits/events | Officer, location, POI, and incident routes consistently record mutation audits and emit events after transaction commit. POI edits now notify other clients. Audit database failures inside a mutation transaction propagate so a rolled-back save is not reported as successful. |
| 10. Unnecessary work | Idle lifecycle ticks no longer write audits or broadcast changes. Dashboard refresh bursts share one in-flight request and a trailing refresh. Latest traffic and active incidents are captured in batches, with constant query-count regression coverage. |
| 11. Interrupted jobs/health | Runs record task IDs and worker heartbeats. Conditional lease expiry marks abandoned queued/running runs failed without replaying them or allowing a late worker to revive them. Scheduled maintenance and status requests detect expiry. Health reports database/migrations, broker, workers, scheduler heartbeat, provider freshness, and backend version. |
| 12. Selection/partial failures | Board refreshes preserve a valid selected run. Publication review freezes the selected run and retains the exact commit request for a lost-response retry. Collections refresh independently, preserving the last good data and naming failed collections. The board catches up periodically when realtime is disconnected. |

Additional improvements:

- Publication review shows named officers/badges, locations, assignment changes, input capture time, effective time, and detailed rejection reasons.
- POI category visibility controls preserve the existing compact category markers. Popup boost inputs now match the API's 0–10 range.
- Incident controls have associated labels and accessible selected/error/loading states. The form clearly states that photo attachments are unavailable.
- New snapshots record schema version, engine version, effective random seed, date, mode, and session ID.
- Authenticated recommendation CSV downloads are available from optimization results/history and the deployment board. String cells escape formula prefixes, and valid zero values are preserved.
- `CLAUDE.md` documents the launcher's interpreter and isolated verification commands. `field_test/APPLICATION_WORKFLOW.md` documents the updated field workflow.

## Verification

| Check | Result |
| --- | --- |
| Backend tests, isolated settings | **155 passed** |
| Frontend tests | **39 passed** across 5 files |
| TypeScript check | Passed |
| ESLint | Passed |
| Production renderer build | Passed |
| Django system check | No issues |
| Model/migration consistency | No changes detected |
| Built-renderer browser check | Passed with mocked API data and an isolated Edge profile, browser timezone America/Los_Angeles |
| Patch whitespace check | Passed |

Backend regressions cover publication freshness/current staffing, duplicate requests, revision conflicts, mid-shift intervals, rollback, shadow guards, privacy, incident location edits, committed events, idle ticks, query counts, job expiry, provider health, dated comparisons, and legacy export labels. Frontend regressions cover delayed incident loading, retries, submitted locations, board counts, partial-hour coverage, selected-run preservation, optional request failures, refresh coalescing, and publication retry identity.

Browser verification covers category filtering, compact markers, escaped saved text, named publication preview and confirmation, route redirects, and dispatcher navigation. Screenshots are in the ignored `traffic_dss_backend/.test-tmp/browser-artifacts/` directory.

The build retains the existing MapLibre chunk warning (approximately 1,049.52 kB, 283.54 kB gzip). No live PostgreSQL contention, real worker crash/broker outage, provider availability, or packaged Electron rollout was tested.

## Activate the changes

Migration `core.0010_publication_history_and_run_health` is prepared and exercised by the isolated test database. It was subsequently applied to this workspace's configured database during the follow-up below. Other installations still need to apply their pending migrations.

With the intended application database configured, apply migrations from `traffic_dss_backend` using the launcher's interpreter:

```powershell
& "..\.venv\Scripts\python.exe" manage.py migrate
```

Then restart Django, the Celery worker, Celery beat, and the renderer/Electron application together. Check System Health for pending migrations, worker/scheduler availability, and provider freshness before publishing a new recommendation. An existing queued/running legacy job may expire under the new lease policy; start a new run rather than replaying an uncertain job.

Default policy settings are configurable in the backend environment:

| Setting | Default |
| --- | --- |
| `PUBLICATION_MAX_INPUT_AGE` | 900 seconds |
| `TRAFFIC_MAX_INPUT_AGE` | 900 seconds |
| `WEATHER_MAX_INPUT_AGE` | 1,800 seconds |
| `OPTIMIZATION_QUEUE_TIMEOUT` | 600 seconds |
| `OPTIMIZATION_HEARTBEAT_TIMEOUT` | 300 seconds |

Legacy runs missing a recorded target date or usable snapshot require a new run for publication. Their exports/comparisons can remain readable when a snapshot exists, with inferred dates and unknown publication states explicitly labelled. Publication revisions begin with new publications; earlier soft-deleted schedules are not reconstructed automatically.

## Remaining work outside these fixes

- Reconcile the September 25 pilot's published/pending classification and five recommended versus four observed officers with the responsible supervisor. The CSVs remain unchanged because the software cannot establish the actual field facts.
- A complete field-session observation/decision entry screen, structured vehicle units/duration capture, and legacy audit-history reconciliation remain future workflow work.
- POI clustering at low zoom, generated API contract types, optimizer replay UI, and measured map/dashboard performance improvements remain enhancements.

See `field_test/APPLICATION_WORKFLOW.md` for the current supported workflow and the specific pilot questions requiring reconciliation.

## Follow-up: local missing-column error

The pasted dashboard error `column core_deployment.revision_id does not exist` was caused by pending migrations **0009 and 0010** in the configured database. The updated backend was running against the older schema.

Before migration 0009 removed the obsolete Scenario table, its two records were serialized to `.local-backups/scenarios-before-0009-20260928T165056Z.json`. The saved file was read back and checked for matching content, record count, and primary keys. Its SHA256 is `7d83c9407c495259d3e3510d98931b973cf8e645e83ff43ca46a3535bf7fa748`. Local backups are excluded from Git.

Applied migrations 0009 and 0010 successfully, with bounded database lock/statement timeouts. Verification against the configured database found:

- **Zero pending migrations** and the new revision column/table present.
- Existing record counts preserved: 10,626 deployments, 217 optimization runs, 335 officers, and 342 locations.
- KPI and bottleneck endpoints returned **HTTP 200 for both morning and afternoon**, using direct Django API requests inside a read-only database transaction.
- Django system check reported no issues.

Services were not restarted or new schedules published during this repair. Restart the local application services to resume the updated workflow.

## Follow-up: completion percentage after early convergence

The screenshot's saved run was confirmed read-only as completed, with **48 recorded generations**, a **300 generation limit**, and `converged_early=True`. The optimizer's existing convergence check can finish a run before that limit. The frontend incorrectly displayed generation-budget consumption (`48 / 300 = 16%`) as task completion. Conversely, the status API reported 300 completed generations after an early stop, obscuring the actual work when reopening the run.

Both progress screens now show **100% for completed runs**, retain the actual generation count, and explain early convergence. The status API and completion events agree on the actual count, limit, convergence flag, and completion timestamp. An older running poll response cannot replace a completed stream event. The optimizer search, fitness, and stopping criteria remain unchanged.

Verification: **158 backend tests and 44 frontend tests passed**, with type checking, lint, build, and browser checks passing. Browser fixtures reproduce completion at 48/300 and verify both the running screen and result details. No operational records were changed for this display fix. Restart Django and the Celery worker to load the status/event changes; no additional migration is required.
