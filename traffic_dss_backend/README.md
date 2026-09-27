# Traffic DSS Backend

Django + DRF backend for the Traffic Deployment DSS.

## Implemented (Phase 1)

- Core PostGIS-ready models for bottlenecks, officers, incidents, deployments, optimization runs, traffic/weather data, and audit logs.
- JWT authentication endpoints.
- CRUD-style API endpoints for dashboard, incidents, deployments, optimization, scenarios, external data, and admin tools.
- OpenAPI schema + Swagger UI at `/api/docs/`.
- Docker Compose stack for PostGIS, Redis, Django, Celery worker/beat, and Nginx.
- Channels + Redis channel layer setup with websocket routes.

## Quick Start (Local)

1. Copy `.env.example` to `.env` and adjust values.
2. Install dependencies:
   - `pip install -r requirements.txt`
3. Run migrations:
   - `python manage.py migrate`
4. Create a superuser:
   - `python manage.py createsuperuser`
5. Start server:
   - `python manage.py runserver`

## API Docs

- Schema: `/api/schema/`
- Swagger: `/api/docs/`
- ReDoc: `/api/redoc/`

## Notes

- Operational writes require the supervisor group or administrator status. Dispatchers can report/update/resolve incidents and manage POIs.
- Scheduling rules live in `deployments/services.py`; all API creation, update, and publication paths use this service.
- Run tests using `python -m pytest --ds=config.test_settings -p no:cacheprovider`.
- See `../IMPLEMENTATION_REPORT_2026-09-24.md` for migration and verification notes.
