# TrafficAuxOptimizer - Setup Guide

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 18+ | Frontend build (Vite) |
| Python | 3.10+ | Django backend |
| PostgreSQL | 14+ | Database with PostGIS |
| Redis | 6+ | Cache, Celery broker, Channels layer |

---

## 1. Clone & Install

```bash
git clone <repo-url>
cd "TrafficAuxOptimizer Design Help and Demo"
npm install
```

### Python Virtual Environment

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/Mac:
source .venv/bin/activate

cd traffic_dss_backend
pip install -r requirements.txt
```

---

## 2. Database Setup (PostgreSQL + PostGIS)

### Ubuntu
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib postgis
sudo -u postgres createdb traffic_dss
sudo -u postgres psql -d traffic_dss -c "CREATE EXTENSION postgis;"
```

### Windows
1. Download PostgreSQL from https://www.postgresql.org/download/windows/
2. During installation, check "PostGIS"
3. Create database via pgAdmin or CLI

---

## 3. Environment Configuration

Create `traffic_dss_backend/.env`:

```env
DEBUG=True
DJANGO_ENV=development
SECRET_KEY=your-secret-key-at-least-32-chars
JWT_SECRET_KEY=your-jwt-secret-at-least-32-chars
ALLOWED_HOSTS=localhost,127.0.0.1
CORS_ALLOW_ALL_ORIGINS=True

# Database
DATABASE_URL=postgis://postgres:yourpassword@localhost:5432/traffic_dss

# Redis
REDIS_URL=redis://localhost:6379/0

# External APIs (optional)
TOMTOM_API_KEY=your-tomtom-key
PAGASA_API_ENDPOINT=https://api.pagasa.dost.gov.ph/api/v1/
```

**Important:** Never commit `.env` to git. The `.gitignore` already excludes it.

For production, set `DJANGO_ENV=production`, `DEBUG=False`, non-placeholder 32+ character values for `SECRET_KEY` and `JWT_SECRET_KEY`, and an explicit comma-separated `CORS_ALLOWED_ORIGINS` list. Production startup fails if these requirements are missing or unsafe.

---

## 4. Redis Setup

### Ubuntu
```bash
sudo apt install redis-server
sudo service redis-server start
redis-cli ping  # Should return PONG
```

### Windows
```powershell
# Option 1: Windows Redis service
Start-Service Redis
redis-cli ping

# Option 2: WSL
wsl -d Ubuntu -e bash
sudo service redis-server start
```

If port 6379 is in use:
```powershell
netstat -ano | findstr :6379
Stop-Service Redis
Start-Service Redis
```

---

## 5. Backend Initialization

```bash
cd traffic_dss_backend

# Run migrations (includes token_blacklist for JWT logout)
python manage.py migrate

# Create test accounts
python manage.py create_test_user --username supervisor --password supervisor123 --badge 1001 --role supervisor
python manage.py create_test_user --username dispatcher --password dispatcher123 --badge 2001 --role dispatcher
python manage.py create_test_user --username admin --password admin123 --badge 0001 --role administrator
```

### Test Credentials

| Role | Username | Password | Access |
|------|----------|----------|--------|
| Supervisor | `supervisor` | `supervisor123` | Optimization, deployment, full dashboard |
| Dispatcher | `dispatcher` | `dispatcher123` | Dashboard monitoring, incident reporting |
| Administrator | `admin` | `admin123` | System settings, user management, audit logs |

---

## 6. Import Data

### Officers & Bottlenecks from CSV
```bash
python manage.py import_officers_bottlenecks
```

### Seed Demo Data
```bash
python manage.py seed_dashboard_data
```

### Import POIs from OpenStreetMap
```bash
python manage.py import_pois_overpass
```

---

## 7. Running the Application

### All Services (Recommended)
```bash
npm run dev:local
```

This starts all services concurrently:

| Service | Command | URL |
|---------|---------|-----|
| Django Backend | `dev:backend` | http://127.0.0.1:8000 |
| Celery Worker | `dev:worker` | Executes background tasks |
| Celery Beat | `dev:beat` | Triggers periodic tasks (traffic/weather fetch) |
| Vite Frontend | `dev:renderer` | http://127.0.0.1:8080 |
| Electron Desktop | `dev:desktop:local` | Loads http://127.0.0.1:8080 |

The launch scripts choose `.venv/Scripts/python.exe` on Windows and `.venv/bin/python` on Linux/macOS. Set `TRAFFIC_PYTHON` to use a different interpreter. Press Ctrl+C in the launch terminal to stop the group; `stop:local` is a Windows-only fallback. The desktop loads the renderer on port 8080 and Django listens on port 8000.

### Individual Services

```bash
npm run dev:backend     # Django only
npm run dev:worker      # Celery worker only
npm run dev:beat        # Celery beat only
npm run dev:renderer    # Frontend only
npm run dev:desktop     # Electron only
```

### Stop All
```bash
npm run stop:local
```

---

## 8. Background Tasks (Celery)

Celery beat schedules periodic tasks. Celery worker executes them.

| Task | Schedule | Function |
|------|----------|----------|
| `fetch_traffic_data` | Every 5 min | Fetch TSI from TomTom (parallel HTTP, updates bottleneck.tsi) |
| `fetch_weather_data` | Every 15 min | Fetch WIF from PAGASA/Open-Meteo |
| `incident_lifecycle` | Every 5 min | Resolve inactive collision/other incidents after 4h since last activity; preserve closures, construction and flooding |
| `deployment_lifecycle` | Every minute | Complete expired deployments and reconcile current officer status |
| `incident_archive` | Daily | Archive resolved incidents (24h) |
| `compute_heatmap_tsi` | Every 5/15 min | Update heatmap TSI (peak/off-peak) |
| `cleanup_old_data` | Daily | Soft-delete data older than 90 days |

**Important:** Both `dev:worker` AND `dev:beat` must be running for periodic tasks to execute. `npm run dev:local` starts both.

---

## 9. External APIs

### TomTom (Traffic Tiles & Flow Data)
1. Get API key from https://developer.tomtom.com/
2. Add `TOMTOM_API_KEY=your-key` to `.env`
3. Used for: map tiles (AllowAny), traffic flow data (TSI calculation)
4. TSI formula: `1 - (current_speed / free_flow_speed)`

The dashboard overlays transparent PNG traffic tiles from `/api/maps/tomtom-traffic/{z}/{x}/{y}.png?style=relative0` on OpenStreetMap. The tile URL and MapLibre source must both use the raster format. Local-road detail depends on zoom and available provider coverage.

The September 29 traffic regression was caused by switching the dashboard to a new vector endpoint while the running backend still served the old routes. That endpoint returned 404 while the PNG endpoint returned valid live traffic. The dashboard now uses the existing PNG endpoint again. The local launcher uses `--noreload`, so future backend route changes require restarting Django.

To verify the actual running traffic service after building the renderer, run `$env:LIVE_TRAFFIC_TILES='1'; node scripts/browser-review.cjs` in PowerShell. This checks live PNG responses and rendered traffic pixels at zoom levels 13, 14, and 15. Other API calls remain fixtures, including all writes. The normal browser test uses local tile fixtures.

### Weather
- **PAGASA** (Philippines): Set `PAGASA_API_ENDPOINT` in `.env`
- **Open-Meteo** (Fallback): No API key needed, configured by default
- Weather Impact Factor (WIF) multiplies officer travel times

---

## 10. API Endpoints

### Authentication
| Endpoint | Method | Auth |
|----------|--------|------|
| `/api/auth/login/` | POST | Public |
| `/api/auth/refresh/` | POST | Public |
| `/api/auth/logout/` | POST | Public (blacklists refresh token) |

### Dashboard (Public Read)
| Endpoint | Method | Auth |
|----------|--------|------|
| `/api/dashboard/kpis/` | GET | Public |
| `/api/dashboard/bottlenecks/` | GET | Public |
| `/api/dashboard/officers/` | GET | Public |
| `/api/dashboard/incidents/active/` | GET | Public |

### Dashboard (Supervisor or Administrator Write)
| Endpoint | Method | Auth |
|----------|--------|------|
| `/api/dashboard/bottlenecks/manage/` | POST | Supervisor or administrator |
| `/api/dashboard/bottlenecks/manage/<id>/` | PUT/DELETE | Supervisor or administrator |
| `/api/dashboard/officers/manage/` | POST | Supervisor or administrator |
| `/api/dashboard/officers/manage/<id>/` | PUT/DELETE | Supervisor or administrator |

### Optimization
| Endpoint | Method | Auth |
|----------|--------|------|
| `/api/optimization/configure/` | POST | Supervisor or administrator |
| `/api/optimization/start/` | POST | Supervisor or administrator |
| `/api/optimization/cancel/<run_id>/` | POST | Supervisor or administrator |
| `/api/optimization/status/<run_id>/` | GET | Public |
| `/api/optimization/results/<run_id>/` | GET | Public |
| `/api/optimization/history/` | GET | Public |

### Deployments
| Endpoint | Method | Auth |
|----------|--------|------|
| `/api/deployments/schedule/` | GET | Required |
| `/api/deployments/schedule/` | DELETE | Supervisor or administrator; `?date=YYYY-MM-DD&shift=morning` (defaults to Manila today; no shift means both shifts) |
| `/api/deployments/assign/` | POST | Supervisor or administrator |
| `/api/deployments/preview-optimization/` | POST | Supervisor or administrator |
| `/api/deployments/publish-optimization/` | POST | Supervisor or administrator |

### Incidents
| Endpoint | Method | Auth |
|----------|--------|------|
| `/api/incidents/meta/` | GET | Public |
| `/api/incidents/report/` | POST | Required |
| `/api/incidents/` | GET | Public |
| `/api/incidents/<id>/resolve/` | PUT | Required |
| `/api/incidents/<id>/` | DELETE | Admin only |

### WebSocket
| Endpoint | Auth | Purpose |
|----------|------|---------|
| `ws/dashboard/` | Token optional | Live dashboard events |
| `ws/optimization/<run_id>/` | Token optional | Optimization progress |
| `ws/incidents/` | Token required | Incident alerts |

---

## 11. Access Points

| Service | URL |
|---------|-----|
| Login | http://127.0.0.1:8080/login |
| Dashboard | http://127.0.0.1:8080/ |
| Optimization | http://127.0.0.1:8080/optimization |
| Optimization Running | http://127.0.0.1:8080/optimization-running |
| Optimization Results | http://127.0.0.1:8080/optimization-engine |
| Deployment Board | http://127.0.0.1:8080/gantt-chart |
| API Docs (Swagger) | http://127.0.0.1:8000/api/docs/ |
| Django Admin | http://127.0.0.1:8000/admin |

---

## 12. Officer Status Lifecycle

| Action | Officer Status |
|--------|---------------|
| Officer created | `available` |
| Deployment published | `deployed` only while its window is current; future assignments remain available |
| Schedule cleared | `available` (if no remaining deployments) |
| Deployment replaced | Recalculate deployed/available from current, non-cancelled windows |

**Scheduled roster KPI** = distinct officers scheduled for the selected date/shift / eligible officers for that shift × 100%. Staffing coverage integrates fulfilled required posts over the full shift.

---

## 13. Optimization Data Flow

```
TomTom API → fetch_traffic_data (every 5 min) → bottleneck.tsi field
                                                    ↓
Dashboard ← DashboardBottlenecksView ← bottleneck.tsi + assigned_officers
                                                    ↓
Optimization → run_optimization task → NSGA-II engine → Pareto front
                                                    ↓
Results → OptimizationEngine page → top solutions + Pareto chart
                                                    ↓
Preview → shared schedule service → confirm → atomic publish → reconcile current officer status
                                                    ↓
Deployment Board ← fetchDeploymentSchedule ← Deployment table
```

**Incidents in Optimization:**
- Active incidents within 500m of a bottleneck boost its road priority weight
- Critical incidents: +3.0, Major: +2.0, Minor: +1.0 priority boost
- Incident coverage bonus: +15% fitness for covering bottleneck clusters near incidents

---

## 14. Troubleshooting

### Celery not picking up tasks
Restart both worker and beat:
```bash
npm run stop:local
npm run dev:local
```

### Optimization shows 0 fitness
- Check that Celery worker is running
- Check that Redis is running (`redis-cli ping`)
- Restart after engine changes

### Map dots not updating
- Check that Celery beat is running (triggers `fetch_traffic_data` every 5 min)
- Manually refresh: `python -c "import os,django;os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings');django.setup();from external.tasks import fetch_traffic_data;fetch_traffic_data()"`

### Redis connection refused
```bash
redis-cli ping
# If no PONG:
# Windows: Start-Service Redis
# Linux: sudo service redis-server start
```

### Database migration errors
```bash
python manage.py migrate --run-syncdb
python manage.py showmigrations  # Check for unapplied migrations
```

### Token blacklist errors
If logout fails with database errors, run:
```bash
python manage.py migrate token_blacklist
```

### Login throttle (429 Too Many Requests)
Login is rate-limited to 10 attempts per minute. Wait 1 minute or clear cache:
```bash
python -c "import os,django;os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings');django.setup();from django.core.cache import cache;cache.clear()"
```

## September 2026 upgrade

Run `python manage.py migrate` before using the updated schedule APIs. Migration 0009 drops the removed comparison table and removes the old officer/shift uniqueness rule. Back up any old comparison data you wish to retain before applying it.

Roles are stored through Django groups: assign existing supervisors to the `supervisor` group using Django admin. Usernames are never interpreted as roles. The test-user command assigns the requested role explicitly.

Restart both Celery worker and beat after updating. Use `config.test_settings` for regression tests to avoid touching operational PostgreSQL or Redis data. All shift windows and the CSV schedule importer use Asia/Manila.

Frontend checks: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. Full changes and results are in `../IMPLEMENTATION_REPORT_2026-09-24.md`.
