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
- Redis is needed for background jobs and Redis-backed realtime broadcasts.
- npm/Electron launchers reference the root `.venv/Scripts/python.exe`.
- A separate backend-local interpreter exists at `traffic_dss_backend/.venv/Scripts/python.exe`.
  Keep interpreter/dependency differences in mind when diagnosing startup versus test behavior.

## Backend verification
From `traffic_dss_backend` in PowerShell, using a disposable SQLite test database:
```powershell
$env:DATABASE_URL = "sqlite:///:memory:"
& ".\.venv\Scripts\python.exe" -m pytest --collect-only -q
& ".\.venv\Scripts\python.exe" -m pytest -q
```
Some existing integration tests use Redis-backed broadcasts. Do not run tests against operational data.
The frontend currently has no configured test script or project TypeScript checking configuration.

## Current review and field work
- [Review dated 2026-09-19](MDFILES/CODE_REVIEW_2026-09-19.md) records verified findings,
  the three approved quick fixes, verification results and the deferred improvement backlog.
- Older P1/P2/readiness documents are historical plans: verify their claims against current source.
- [Field-test protocol](field_test/FIELD_TEST.md) defines the controlled shadow pilot:
  manual deployments remain authoritative and app recommendations must not be published.
- Source inspection and passing automated tests alone do not establish operational readiness.
