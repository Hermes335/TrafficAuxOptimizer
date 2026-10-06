# TrafficAuxOptimizer

## Project
Iloilo traffic-officer deployment decision-support application using NSGA-II optimization.
React/TypeScript + Vite renderer, Electron desktop shell, Django/DRF API, Celery jobs,
and Redis-backed Channels realtime updates.

## Repository layout
- [src/app](src/app/) — frontend pages, hooks, components, authentication and API services.
- [electron](electron/) — desktop lifecycle and preload bridge.
- [traffic_dss_backend](traffic_dss_backend/) — active Django backend.
  - `core` — models, serializers, assignment scoring, validation and management commands.
  - `optimization` — optimizer engine, tasks and progress reporting.
  - `dashboard`, `deployments`, `incidents`, `external` — domain APIs and integrations.
- [field_test](field_test/) — protocols and pilot observation/recommendation CSVs.
- [MDFILES](MDFILES/) — technical documentation and dated improvement studies.
- [backend](backend/) — legacy prototype, not the backend used by current launchers.

## Local development
- Run `npm run dev:local` from the repository root for Django, Celery, renderer and Electron.
- Renderer uses port 8080; Django uses port 8000.
- `dev:local` reloads Django after backend edits. The standalone Electron backend still uses `--noreload` and needs an app restart for backend changes.
- Redis is needed for background jobs and Redis-backed realtime broadcasts.
- npm/Electron launchers reference the root `.venv/Scripts/python.exe`.
- A separate backend-local interpreter exists at `traffic_dss_backend/.venv/Scripts/python.exe`.
  Keep interpreter/dependency differences in mind when diagnosing startup versus test behavior.

## Backend verification
From `traffic_dss_backend` in PowerShell, using the launcher's root interpreter and isolated SQLite/cache settings:
```powershell
& "..\.venv\Scripts\python.exe" -m pytest -q --ds=config.test_settings -p no:cacheprovider --basetemp=.test-tmp/regression
& "..\.venv\Scripts\python.exe" manage.py check --settings=config.test_settings
& "..\.venv\Scripts\python.exe" manage.py makemigrations --check --dry-run --settings=config.test_settings
```
`config.test_settings` uses in-memory SQLite, cache, Channels, and Celery. Progress storage follows that configured cache. Do not run tests against operational data.

From the repository root: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`, and `npm.cmd run build`.
`node scripts/browser-review.cjs` runs the built renderer with mocked API responses and an isolated browser profile.

## Operational changes (2026-09-28)
- [Implementation report](IMPLEMENTATION_REPORT_2026-09-28.md) maps the September 27 review to fixes and verification.
- Migration `core.0010_publication_history_and_run_health` adds publication history and run heartbeats. Apply it to the intended database before restarting updated Django/Celery services.
- New runs save their operational date and operational/shadow mode. Shadow runs require a session name and cannot be published.
- Publication requires a fresh preview revision and idempotency key. Missing legacy snapshots/date metadata require reoptimization. Stale/unverified inputs need refresh/reoptimization or an audited supervisor override; synthetic inputs and staffing violations cannot be overridden.
- Officer/run details are authenticated. Public dashboard responses omit assignee identities.
- [Field workflow](field_test/APPLICATION_WORKFLOW.md) documents dated comparisons and recommendation exports.

## Current review and field work
- [Deployment operations guide](field_test/DEPLOYMENT_OPERATIONS.md) covers live staffing, schedule review, audited staffing overrides, area filters, break/travel reservations and field feedback. Migration 0012 is applied locally. Upcoming movement lists and officer acknowledgement/arrival tracking remain excluded.
- [Dynamic deployment implementation](MDFILES/DYNAMIC_DEPLOYMENT_2026-09-29.md) adds intersection staffing periods, zero demand, timed optimization/publication and an editable Gantt. Migration `0011_bottleneck_staffing_periods` is applied locally; restart workers to load `timed-demand-v2`. Actual site profiles must be entered from field requirements.
- [Officer assignment fix dated 2026-09-29](MDFILES/OFFICER_ASSIGNMENT_FIX_2026-09-29.md) changes optimizer allocation and resource scoring to use staffing demand; restart the worker before generating new recommendations. The web/desktop platform decision is deferred at the user's request.
- [Review dated 2026-09-19](MDFILES/CODE_REVIEW_2026-09-19.md) records verified findings,
  the three approved quick fixes, verification results and the deferred improvement backlog.
- Older P1/P2/readiness documents are historical plans: verify their claims against current source.
- [Field-test protocol](field_test/FIELD_TEST.md) defines the controlled shadow pilot:
  manual deployments remain authoritative and app recommendations must not be published.
- Source inspection and passing automated tests alone do not establish operational readiness.
