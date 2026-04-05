# Step-by-Step Integration Guide

Chosen path:
- Runtime: Local native
- App mode: Desktop demo mode

This guide assumes you are running the app directly on your machine, without Docker, and without strict JWT enforcement for the desktop demo flow.


## 1) Choose your target runtime (do this first)
Pick one:
- Local native (fastest for development)
- Docker Compose (closest to deployment)

Selected for this guide:
- Local native

If you are unsure, start with local native and move to Docker after smoke tests pass.

### What to pick for local native
Choose local native if you want to run everything directly on your Windows machine without Docker.
Use this when you are:
- debugging the app locally
- changing frontend or backend code frequently
- okay with starting PostgreSQL, Redis, and Celery separately

In this mode, your main commands are:
- backend: `python manage.py runserver 127.0.0.1:8000`
- frontend/desktop: `npm run dev`
- Redis/Celery: start them separately if they are not already running

## 2) Decide auth policy before wiring more services
Choose now:
- Desktop demo mode: open endpoints and open websocket
- Production mode: JWT required for API and websocket

Selected for this guide:
- Desktop demo mode

This avoids rework on permissions later.

## 3) Prepare backend env values
Create `traffic_dss_backend/.env` from `.env.example` (if present), then set:
- `SECRET_KEY`
- `JWT_SECRET_KEY`
- `DEBUG=True` for local, `False` for production
- `DATABASE_URL`
- `REDIS_URL`
- `CELERY_BROKER_URL`
- `CELERY_RESULT_BACKEND`
- `TOMTOM_API_KEY`
- `OPENWEATHERMAP_API_KEY`
- `PAGASA_API_ENDPOINT`

1) TomTom API key
Go to the TomTom developer portal and create an account.
Confirm your email.
Create a new project or application in the dashboard.
Find the API key under the project credentials.
Copy that key.
Put it in traffic_dss_backend/.env as:
Restart the backend.
2) OpenWeatherMap API key
Go to the OpenWeatherMap website and create an account.
Verify your email.
Open the API keys section in your account dashboard.
Generate a new key if one does not already exist.
Copy the key.
Put it in traffic_dss_backend/.env as:
Restart the backend.
3) PAGASA endpoint
PAGASA usually is not a normal “API key” flow like TomTom or OpenWeatherMap.

Check whether you have an approved PAGASA data endpoint from your organization or from PAGASA itself.
If you do, copy the endpoint URL.
Put it in traffic_dss_backend/.env as:
If you do not have one, leave it blank for now. The backend will fall back to cached or default weather data where supported.
4) Add them to the backend env file
Open traffic_dss_backend/.env and set:

5) Restart the app
Stop the backend.
Start it again.
Run the app with npm run dev.
Check the weather and traffic screens to confirm the values are being used.
6) Verify they work
Open the app.
Check weather/current and traffic/real-time views.
If a provider fails, the backend should still fall back to safe data.

Use this local-native starter set:

```env
DATABASE_URL=postgis://postgres:postgres@localhost:5432/traffic_dss
REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0
SECRET_KEY=change-me-to-a-long-random-string
JWT_SECRET_KEY=change-me-to-a-second-long-random-string
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1
CORS_ALLOW_ALL_ORIGINS=True
TOMTOM_API_KEY=your_tomtom_key
OPENWEATHERMAP_API_KEY=your_weather_key
PAGASA_API_ENDPOINT=https://api.pagasa.dost.gov.ph
ILOILO_LATITUDE=10.7202
ILOILO_LONGITUDE=122.5621
LOG_DIR=./logs
```

If you do not have real API keys yet, keep the placeholders for now and the app will use fallback data where supported.

## 4) Start PostgreSQL/PostGIS and validate
### Local/Docker requirement
- PostgreSQL reachable on your configured host/port
- PostGIS extension enabled

### Quick checks
1. Connect and run:
   - `SELECT version();`
2. Confirm PostGIS:
   - `CREATE EXTENSION IF NOT EXISTS postgis;`
   - `SELECT postgis_version();`

## 5) Apply migrations
From `traffic_dss_backend`:
1. Activate venv (PowerShell):
   - `& "..\.venv\Scripts\Activate.ps1"`
2. Run:
   - `python manage.py migrate`
3. Optional:
   - `python manage.py createsuperuser`

## 6) Start Redis and verify
Start Redis, then run:
- `redis-cli ping`
Expected: `PONG`

## 7) Start backend server
From `traffic_dss_backend`:
- `python manage.py runserver 127.0.0.1:8000`

Check health:
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health/ | Select-Object -ExpandProperty Content`

## 8) Start Celery worker and beat
Open two terminals in `traffic_dss_backend`:

Worker:
- `celery -A config worker -l info`

Beat:
- `celery -A config beat -l info`

Confirm periodic tasks appear in logs.

## 9) Start frontend + desktop shell
From repo root:
- `npm install`
- `npm run dev`

Expected:
- Vite on `http://localhost:5173`
- Electron launches automatically

## 10) Validate core API endpoints
Run these one by one:
- `GET /api/health/`
- `GET /api/dashboard/kpis/`
- `GET /api/dashboard/bottlenecks/`
- `GET /api/dashboard/incidents/active/`
- `POST /api/optimization/configure/`
- `POST /api/optimization/start/`
- `GET /api/optimization/status/:run_id/`
- `GET /api/optimization/results/:run_id/`
- `GET /api/deployments/schedule/`
- `POST /api/incidents/report/`
- `GET /api/scenarios/`
- `GET /api/weather/current/`
- `GET /api/traffic/real-time/`
- `GET /api/analytics/trends/`

## 11) Validate websocket channels
Check that these connect and receive messages:
- `/ws/dashboard/`
- `/ws/optimization/:run_id/`

Then test reconnect by stopping and restarting backend briefly.

## 12) Validate file uploads
Incident reporting should support multipart upload:
- Allowed: JPEG, PNG
- Max size target: 10 MB
- Thumbnail generation should occur
- Uploaded media should be reachable under media URL in development

## 13) Run smoke tests (full flow)
Run this flow in the app:
1. Login (if JWT mode)
2. Load dashboard
3. Start optimization
4. Observe progress updates
5. Open optimization results
6. Submit incident with photo
7. Open scenarios and schedule pages
8. Logout (if JWT mode)

## 14) Measure performance
Use your real dataset and infrastructure:
- API latency targets
- websocket latency
- optimization completion time
- DB query performance and indexing

## 15) Lock production settings
Before deployment:
- `DEBUG=False`
- strict `ALLOWED_HOSTS`
- strict CORS origins
- JWT/auth policy finalized
- websocket auth finalized
- secrets not placeholders

## 16) Docker deployment validation (if using Docker)
Run `docker-compose up` and confirm:
- web can reach postgres and redis
- media volume persists
- env vars are injected
- health checks pass

## Completion Criteria
You are done when all are true:
- Health/API/websocket checks pass
- Redis and Celery stable
- external APIs return real data with fallback behavior
- smoke test flow works end-to-end
- production env/security policy finalized
