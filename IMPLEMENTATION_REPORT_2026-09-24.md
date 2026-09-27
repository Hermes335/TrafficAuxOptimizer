# Implementation Report — September 24, 2026

## 1. Summary

Implemented the fixes for findings 1–19 in `MDFILES/CODE_REVIEW_2026-09-24.md`, removed the Scenario and Analytics features, and added operational regression coverage. The changes cover schedule atomicity, eligibility and roles, popup safety, persistence, Manila scheduling, staffing metrics, authentication refresh, pagination, optimizer validation and lifecycle, provenance, live events, incident expiry, and map stability.

Validation completed: **119 backend tests and 26 frontend tests passed**; TypeScript, ESLint, production build, Django checks, migration consistency, and fixture-based browser checks passed. The production build still reports the existing MapLibre chunk-size warning.

The implementation preserves the existing application structure. New shared modules centralize scheduling, permissions, operational time, staffing calculations, optimization startup, session notifications, popup DOM construction, marker creation, and publication confirmation.

The pre-existing user changes to `.gitignore` and deletion of `MDFILES/THESIS_DOCUMENTATION.md` were preserved.

## 2. Scenario Removal

Removed:

- `src/app/pages/Scenarios.tsx`, its lazy import, route, sidebar entry, comparison state, exports and generated manual-baseline calculations.
- Scenario API functions and frontend types from `src/app/services/backend.ts`.
- The `traffic_dss_backend/scenarios/` app, exclusive views/URLs/stubs, installed-app registration and root URL include.
- The Scenario model, serializer and Django admin registration.
- Scenario-only assertions in the former combined Scenario/deployment test; deployment assertions remain.
- The optimizer's unused scenario preset dispatch branch. The configuration screen's explicit parameter presets remain useful and are retained.
- Current setup/README links advertising the removed page or API.

Migration [0009](traffic_dss_backend/core/migrations/0009_schedule_rules_and_remove_scenario.py) deletes the retired model through a forward migration. The original creation in migration 0001 is intentionally preserved so existing migration histories remain valid.

The final source search found **no active Scenario page, service, navigation entry, registered API or runtime model reference**. The remaining source references are the historical creation migration, the deletion migration and regression checks asserting that removed URLs are unavailable. Historical review/documentation descriptions remain as records; claiming zero occurrences throughout the repository would be inaccurate.

Direct navigation to `/scenarios` follows the application's existing fallback routing. This was verified in the built application.

## 3. Analytics Removal

Removed:

- `src/app/pages/Analytics.tsx`, its route, lazy import, navigation entry and page-specific data mapping.
- Analytics-only frontend service/type definitions.
- `AnalyticsTrendsView` and its exclusive URL in `external/`.
- The unused `analytics_app/` app and installed-app registration.
- The Analytics-only backend endpoint regression test.
- Current documentation entries advertising that feature.

Preserved shared traffic/weather records, provider integrations, map endpoints, data-quality tooling, optimization results, and field-test/benchmark support. These are used independently of the removed page. The Analytics app contained no exclusive operational database table requiring a deletion migration.

The final source search found **no active Analytics page, route, navigation entry, service or registered API**. Removal tests and historical documentation retain explanatory references. Built-browser navigation to `/analytics` follows the existing fallback safely.

## 4. Critical/High Bug Fixes

Backend paths below are relative to `traffic_dss_backend/`.

| Issue | Files Changed | Fix | Test/Validation |
|---|---|---|---|
| 1. Publication could erase the current schedule | `deployments/services.py`, `deployments/views.py` | Validate every proposed row before replacement; lock the scheduling roster; replace in one transaction; propagate insertion failures; emit success after commit. | Missing entities, invalid/empty results, first/second insertion failures, successful publication and commit callbacks. |
| 2. Publication bypassed eligibility and used the viewing filter | Shared schedule service; `PublishScheduleButton.tsx`; `GanttChart.tsx` | Create/update/publish share eligibility, shift, overlap, window and capacity checks. Publication uses the saved run's actual shift and revalidates after preview. | Off-duty/wrong-shift rejection, overlap/capacity checks, stale preview, shift override rejection; browser preview confirms morning while viewing all shifts. |
| 3. Operational APIs lacked role enforcement | `core/permissions.py`, operational views, `config/urls.py`, routes/sidebar | Server checks require supervisor or administrator for scheduling, roster/node management and optimization mutations. Roles use Django groups/staff status. | Anonymous/dispatcher denied; supervisor/administrator allowed; alternate mutation paths and literal username tested. |
| 4. Stored map text could execute HTML | `mapPopup.ts`, `useMapMarkers.ts`, `useMapAssignmentLines.ts` | All application map popups use DOM nodes with textContent/value. | Malicious labels/input values remain inert in DOM tests and a real Chromium popup; source scan finds no setHTML/innerHTML in `src/app`. |
| 5. Phantom incidents/POIs and hidden failures | `MarkerCreationForm.tsx`, dashboard/map hooks, API services, incident serializers/views | Drafts are distinct from saved rows. Only successful API responses provide persisted IDs. Failed saves/removals retain draft/record with an error; refresh retry does not repeat a successful POST. | Successful persisted IDs, failed incident/POI creation, failed POI deletion, failed incident resolution and refresh retry. |
| 6. Shift windows/display used the wrong timezone | `core/operational_time.py`, schedule/import/tasks, `operationalTime.ts`, dashboard/board/audit pages | Asia/Manila constructs and displays operational dates/windows; storage uses aware timestamps; peak hours use Manila. | Both shifts, UTC midnight boundaries, UTC storage conversion, frontend display; browser timezone set to America/Los_Angeles. |
| 7. Dashboard coverage and other metrics were fabricated/mislabeled | `core/staffing.py`, `dashboard/views.py`, snapshot service, KPI/Login components | Coverage integrates fulfilled required posts over the selected shift. Show required/assigned staffing and shortages. Missing response observations remain null; weather factor is labeled as impact. | Zero staffing and partial-shift staffing coverage tests; initial state has no fake observations. |
| 8. Scenario comparison invented its manual baseline | Removed Scenario feature | Removed generated comparison values, chart and export path. | Removed-source audit, compilation, backend URL and built-browser routing checks. |

Staffing coverage is duration-weighted: a single officer covering half an eight-hour shift supplies half of one post for that shift. Fulfillment is capped at each node's requirement; overstaffing cannot compensate for an uncovered different node. Optimizer location coverage is separately labeled, and optimizer travel time remains an explicit estimate with recorded assumptions.

## 5. Medium/Low Fixes

| Issue | Files Changed | Fix | Test/Validation |
|---|---|---|---|
| 9. Rotating refresh requests raced | `backend.ts`, `session.ts`, `AuthContext.tsx` | One shared refresh promise; stale responses cannot overwrite/clear a newer session; context follows storage/session notifications. | Concurrent 401, late failure after new login, expired credentials, rendered AuthContext tests. |
| 10. Lists silently stopped at page one | Backend list views; `backend.ts`; OfficerManagement, Optimization, AuditLogs and schedule selector | Retain pagination metadata. Tables use pages; maps and full-schedule consumers follow required pages. Incident lookup uses its detail endpoint. Guard cycles and cross-origin next URLs. | 101 records, detail outside first page, cyclic/external pagination, server history/roster pagination and filters. |
| 11. Exactly 60 eligible officers could not be assigned | `core/serializers.py`, shared scheduling service | Enforce the roster cap when adding/activating roster members, separately from assignment eligibility. | Exactly 60 available officers can be assigned; a 61st active roster member is rejected. |
| 12. Deployment lifecycle/date uniqueness was inconsistent | Shared schedule service, `core/tasks.py`, Celery schedule, migration 0009 | Remove officer/shift-only uniqueness; validate time overlap; reject invalid windows and terminal-state reactivation; derive current officer status; expire assignments every minute. | Create/update/publish overlap, distinct dates, bad dates/windows, future/current/expired lifecycle and migration checks. |
| 13. Optimization parameters disagreed | `optimization/services.py`, views, Optimization page | Shared bounded serializer; elitism is an absolute count 1–20; structured field errors; Run requires the exact currently validated parameter set. | Invalid numeric/range inputs across configure, normal start and quick start; typecheck/build. |
| 14. Queue failure left runs running | Shared start service, tasks/views, OptimizationRunning | Create queued records, mark enqueue failures failed, start running in the worker; conditional terminal transitions preserve cancellation. Reconnecting/StrictMode does not launch duplicate jobs. | Both enqueue-failure paths, cancelled-before-start and cancelled-during-finish races; frontend reconnect/StrictMode tests. |
| 15. Duplicate location coverage and missing staffing constraints | `optimization/engine.py`, shared staffing requirement helper | Count distinct covered locations; enforce and repair feasible minimum staffing alongside capacity; report unavoidable shortages. | [A,A,B] distinct-location score, feasible minimum staffing and explicit infeasible shortage tests. |
| 16. Uniform inputs replaced with generated data | `optimization/tasks.py`, result API/UI | Preserve equal priorities and measured zero. Store inputs, source/status/timestamps, stale/synthetic flags and travel/weather assumptions. Publication rejects synthetic results. | Two equal-priority zero-TSI nodes survive capture, worker input and stored snapshot; synthetic publication rejection. |
| 17. Live events failed to refresh collections | `core/realtime.py`, producers, dashboard data hook, schedule page | Canonical event name inside forwarded data; after-commit mutations; refresh deployments, roster, nodes, incidents, weather and POIs; periodic fallback; visible connection/freshness. | Actual Channels producer-to-consumer event test; frontend collection refresh and failed-refresh retention. |
| 18. Recently edited incidents auto-resolved | `core/tasks.py`, incident mutation views | Use updated activity time; lock transitions; preserve road closures, construction and flooding from time-only expiry. | Old inactive collision resolves; recently updated collision and ongoing incident types remain active. |
| 19. Filtering changed severity and closed popups | `severity.ts`, map marker hooks | Shared fixed thresholds; compare raw TSI; reuse markers by ID; stable callback refs and safe content updates preserve open popup state. | Quiet-network severity/filter boundaries; marker identity and open popup survive unrelated renders/data updates. |
| Raster tile failure hid operational markers | `useMapMarkers.ts` | Add markers when the map instance exists; raster style loading is not required for DOM markers. | Unloaded-style marker test and built-browser check with external tile requests blocked. |
| Misleading local schedule restore | `GanttChart.tsx` | Remove the React-only restore action. Clear is dated and confirmed; publication requires a validated preview. | Component/browser confirmation checks; source audit. |
| Inaccurate schedule visualization | Board/timeline components, Sidebar | Label as Deployment Board; use Manila hours for the scope and include all node rows. | Time helpers, typecheck and built-browser inspection. |
| Startup portability and stale documentation | `scripts/run-service.cjs`, `scripts/python-path.cjs`, Electron, package scripts, README/setup | Select Windows/Unix interpreter, avoid Windows-only environment assignment, document actual 8080/8000 ports and upgrade steps. | Script syntax and both interpreter path branches checked; full Linux/macOS launch not exercised. |
| Dead/placeholder components and imports | Dashboard components/hooks, ProtectedRoute, tests, tsconfig | Remove unused QuickOptimize/SystemStats, obsolete hook/state, placeholder reauthentication component, stale imports and constant-only smoke tests. Enable unused-local/parameter compiler checks. | Typecheck, lint, meaningful replacement tests and source audit. |

## 6. Security Fixes

- Shared server-side role checks protect schedule clearing, manual assignment/update, publication/preview, optimization configure/start/cancel and officer/node management. Duplicate admin mutation endpoints retain admin checks and share schedule locking.
- Anonymous users cannot perform those operational writes. Dispatchers can report/resolve incidents and manage POIs; they cannot mutate schedules or run optimizations. Frontend actions/routes reflect the policy.
- Supervisor membership comes from the Django `supervisor` group. Staff/superusers are administrators. A literal username grants no privilege.
- Saved node, incident and POI strings cannot become executable map-popup HTML. Assignment popups were included in the audit.
- Token refresh failures cannot erase credentials established by a later login.
- Pagination refuses cross-origin next links before forwarding authorization credentials.
- Backend numeric/date/coordinate serializers reject malformed and non-finite input.
- A synthetic optimization result cannot be published into the operational schedule.

These checks validate the reviewed paths; they are not a comprehensive penetration test of every dependency or deployment configuration.

## 7. UI/UX Improvements

- Dashboard prioritizes Manila operational date/shift, shortages, active incidents, last refresh and stream state. Secondary KPI details collapse.
- Missing data uses a missing state; failed refresh preserves confirmed data, exposes the error and offers retry.
- Shared node/incident/POI creation forms have visible labels, an unsaved-position state, cancel, validation and save errors.
- POIs use category-specific vector markers: hospital cross, fire flame, police shield/star, school book, and a general place pin. Each has its own color and silhouette, with a map legend and a preview when creating a POI. Marker buttons retain accessible names and existing popup behavior.
- Node editing preserves the actual district/type/priority returned by the API.
- Publication dialog shows run, actual date/shift/hours, proposed/replaced assignment counts, added/removed officer IDs and validation conflicts. Confirmation is separate from preview.
- Deployment Board has date/shift scope, a complete node matrix and correctly scoped Manila hours.
- Roster, optimization history and audit logs expose pagination instead of silently truncating results.
- Congestion uses fixed thresholds; staffing and freshness are labeled separately.
- Dialogs use existing accessible Radix primitives; icon actions have names; form labels and yellow action text contrast were improved.
- Removed unrelated stock imagery presented as incident evidence and unsupported login claims/fake statistics.
- Results identify location coverage, estimated travel time, unavoidable staffing shortages, input provenance and the running mean of best fitness.

Visual verification covered the publication dialog at 1440×1000. This is not a full screen-reader, contrast or responsive-layout audit.

## 8. Tests Added/Updated

### Backend regression inventory

New [core/tests_review_fixes.py](traffic_dss_backend/core/tests_review_fixes.py):

1. `test_invalid_publication_keeps_old_schedule`: nine invalid-result/entity/eligibility/capacity/synthetic variants preserve the old schedule.
2. `test_publication_insertion_failure_rolls_back_entire_batch`: failure at the first and second insert rolls back the whole replacement.
3. `test_preview_is_read_only_and_publication_emits_only_after_commit`: preview writes nothing; successful replacement and its event respect commit.
4. `test_preview_revalidates_before_publish`: eligibility changes after preview block confirmation.
5. `test_mutation_roles_are_enforced`: four roles across operational endpoints.
6. `test_dispatcher_cannot_bypass_operational_permissions`: seven alternate mutation paths reject dispatcher access.
7. `test_username_is_not_a_role`: username alone cannot grant supervisor rights.
8. `test_exactly_sixty_eligible_officers_can_be_assigned`: assignment works at the roster boundary.
9. `test_create_update_and_publish_share_overlap_rules`: overlap is rejected and different dates remain valid.
10. `test_assignment_rejects_invalid_dates_and_windows`: four malformed/out-of-shift variants.
11. `test_publish_cannot_override_runs_shift`: a viewing-filter shift cannot override the saved run.
12. `test_manila_windows_convert_to_correct_storage_times`: morning and afternoon local/UTC windows.
13. `test_operational_day_and_peak_hour_cross_utc_midnight`: Manila day and peak-hour boundaries.
14. `test_dashboard_coverage_uses_staffed_duration_and_requirements`: actual staffing and partial-shift fulfillment.
15. `test_optimization_invalid_input_returns_structured_errors`: six invalid input variants across three entry points.
16. `test_queue_failure_has_terminal_record`: both normal/quick start failures terminate with useful errors.
17. `test_cancelled_run_cannot_be_revived_by_worker`: cancelled runs cannot start.
18. `test_cancel_during_worker_completion_wins`: cancellation survives late worker completion.
19. `test_uniform_priority_and_zero_tsi_preserved_in_worker_snapshot`: two equal-priority nodes keep zero TSI in captured inputs, optimizer input and stored results.
20. `test_incident_lifecycle_uses_latest_activity_and_preserves_ongoing_types`: inactivity and ongoing-type policy.
21. `test_deployment_lifecycle_tracks_current_window_and_completion`: future/current/expired officer status.
22. `test_active_incidents_are_paginated_without_silent_fifty_row_limit`: active incident pages expose remaining records.
23. `test_incident_and_poi_creation_return_real_ids_and_persist`: actual stored IDs survive retrieval.
24. `test_removed_backend_routes_are_not_registered`: removed APIs are unavailable.
25. `test_priority_coverage_counts_distinct_locations`: coverage and feasible minimum allocation.
26. `test_history_and_roster_tables_keep_pagination_and_filters`: history/roster pages retain count/next and filtering.
27. `test_infeasible_minimum_staffing_is_explicit_in_result`: shortages are visible when not all minimums can be met.

New Channels regression in [core/tests_realtime.py](traffic_dss_backend/core/tests_realtime.py):

28. `test_lifecycle_producer_preserves_event_name_through_dashboard_consumer`: authenticated consumer receives the actual lifecycle producer's canonical event.

Existing API tests were updated for explicit supervisor fixtures, Manila windows and shared startup error semantics. The old roster-cap test encoded the assignment bug: it was replaced with a roster-expansion rejection assertion, alongside the new successful 60-officer assignment test. Scenario-only assertions and the exclusive Analytics endpoint test were removed because those features were intentionally deleted. Other existing backend tests remain.

### Frontend regression inventory

[backend.test.ts](src/__tests__/backend.test.ts), ten tests:

1. Concurrent 401 responses share one rotating refresh and notify the session.
2. A late refresh rejection cannot clear a newer login.
3. Expired sessions clear credentials and emit notifications.
4. Complete-list consumers retrieve records beyond the first 100.
5. Pagination cycles and cross-origin credential forwarding are rejected.
6. Incident IDs outside page one use the detail endpoint.
7. API creation returns real IDs and mutation failures propagate.
8. Initial dashboard state contains no invented observations/entities.
9. Rendered AuthContext follows the final expired session state.
10. An HTTP 404 from publication preview identifies a backend still running older code.

[operational-ui.test.tsx](src/__tests__/operational-ui.test.tsx), eleven tests:

1. Malicious popup text/editable values remain inert.
2. Failed POI deletion retains the popup and displays the failure.
3. Failed incident creation retains an unsaved draft.
4. Failed POI creation retains an unsaved draft.
5. Successful save followed by refresh failure retries refresh without repeating POST.
6. Failed incident resolution leaves the saved incident visible.
7. Operational dates and both shift displays are timezone-independent.
8. Severity remains fixed when quiet datasets are filtered, including the threshold boundary.
9. Publication requires preview/confirmation and uses the saved run shift.
10. Live events refresh affected collections; failed refresh preserves data and exposes stale/disconnected state.
11. A saved run marked with generated inputs explains why publication is disabled.

[map-markers.test.tsx](src/__tests__/map-markers.test.tsx), three tests:

- Markers retain identity and open popup state across unrelated renders/data updates and clean up appropriately.
- Operational markers render even when raster tiles never finish loading.
- All five POI categories render distinct, accessible SVG designs; editing a category updates its marker while preserving the open popup.

[optimization-progress.test.tsx](src/__tests__/optimization-progress.test.tsx), two tests:

- Reconnecting to a saved run does not create another optimization.
- React StrictMode starts one job and connects to its persisted run.

The previous smoke-test file only asserted locally constructed constants. It was replaced by tests that invoke application services, render components/hooks, interact with controls and inspect persistence/error behavior. Tests are now included in TypeScript checking.

### Built-browser regression

[scripts/browser-review.cjs](scripts/browser-review.cjs) serves the production build and launches an isolated Chromium profile. Backend HTTP calls use fixtures, external provider requests are blocked and live sockets are stubbed; it does not write operational data.

It checks dashboard loading, an actual malicious saved-name popup, absence of removed navigation links, read-only publication preview then exactly one confirmed POST, old-route redirects, dispatcher navigation and login rendering. There were zero uncaught runtime exceptions. The browser timezone was America/Los_Angeles.

Screenshots: [publication preview](traffic_dss_backend/.test-tmp/browser-artifacts/publication-preview.png), [POI marker designs](traffic_dss_backend/.test-tmp/browser-artifacts/poi-markers.png).

## 9. Validation Results

| Check | Actual result |
|---|---|
| Backend: `python -m pytest -q --ds=config.test_settings -p no:cacheprovider --basetemp=.test-tmp/review-final-uniform` | **119 passed**, 6.55s |
| Frontend: `npm test` | **26 passed**, 4 test files |
| TypeScript: `npm run typecheck` | Passed, including tests and enabled unused locals/parameters checks |
| ESLint: `npm run lint` | Passed |
| Production: `npm run build` | Passed; 2,352 modules transformed |
| Built browser: `node scripts/browser-review.cjs` (also available as `npm run test:browser`) | Passed against the final build |
| Django: `python manage.py check --settings=config.test_settings` | No issues |
| Migrations: `python manage.py makemigrations --check --dry-run --settings=config.test_settings` | No changes detected |
| Git whitespace: `git -c core.safecrlf=false diff --check` | Passed using repository line-ending settings |
| Startup scripts | Node syntax checks passed; Windows and Unix Python path selection passed |
| Removal/security source scans | No active removed-feature references; no setHTML/innerHTML in application source |

Backend tests used isolated SQLite, local memory cache, in-memory Channels and a memory Celery broker/result backend. Test migrations exercised the forward model changes. No migration was applied to the operational PostgreSQL database.

ESLint checks code correctness without imposing a project-wide strict style conversion. TypeScript separately checks unused imports/locals/parameters. Temporary test artifacts are ignored within `traffic_dss_backend/.test-tmp/`.

An extra diff check with automatic CRLF conversion forcibly disabled reported line-ending whitespace on Windows files; the check above uses the repository's configured conversion and passed. Files were not rewritten solely to change line endings.

## 10. Remaining Issues

### Required when deploying this update

1. Back up any old Scenario comparison data that must be retained; migration 0009 intentionally drops that retired model/table.
2. From the backend environment, run `python manage.py migrate`.
3. Assign existing operational supervisors to the Django `supervisor` group through Django admin. Existing usernames do not confer the role. The updated test-user command assigns requested roles explicitly.
4. Restart Django, Celery worker and Celery beat. Beat now runs the deployment lifecycle task every minute.

These deployment actions were documented rather than executed against live data.

### Verification limits and maintenance

- **Existing saved run:** `opt-20260924172134268107` is completed but records generated `road_priority_weight` and `tsi` inputs. Its result cannot be published under the operational-data rule. The locally running backend also returned HTTP 404 for the new preview endpoint while migration 0009 remained pending. Restart the updated backend, apply the migration after backing up data to be retained, and run a new optimization with operational inputs. The frontend now identifies the old run and outdated backend separately.

- **PostgreSQL concurrency:** the scheduling service uses transactions and a consistent row-lock order. Rollback behavior is tested, but SQLite does not prove PostgreSQL lock/contention behavior. No live PostgreSQL concurrent-writer test was run.
- **Live infrastructure/providers:** Redis, live Celery workers/beat, live WebSocket reconnect through Redis, and production traffic/weather providers were not exercised together. Channels event delivery is covered with the in-memory layer; the browser uses controlled fixtures.
- **Dependency advisories:** npm installation reported 21 advisories (2 low, 7 moderate, 9 high, 3 critical). They have not been individually triaged or resolved in this implementation; no broad forced dependency upgrade was performed.
- **Bundle size:** MapLibre remains approximately 1,049.52 kB minified / 283.54 kB gzip and triggers Vite's warning. This did not fail the build. No provider-map performance benchmark was performed.
- **Cross-platform startup:** interpreter selection and launcher syntax were checked on Windows. Complete Linux/macOS desktop/service startup is unverified; the existing `stop:local` fallback remains Windows-only, with Ctrl+C documented for the shared launcher.
- **Operational measurements:** measured incident response-time observations remain unavailable in the current data model. The dashboard displays missing values; optimizer travel estimates disclose their model and missing-location assumption. Freshness/provenance are exposed rather than replaced by invented observations.
- **Historical evaluation:** existing benchmark figures have not been rerun after objective/constraint changes and are explicitly labeled historical in README.
- **Accessibility:** labels, focus-aware dialogs and named controls were improved; a comprehensive assistive-technology and multi-viewport audit was not performed.

No reviewed finding is deliberately left in its original broken state. The limitations above distinguish tested behavior from deployment verification and wider maintenance.
