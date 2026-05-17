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
SECRET_KEY=your-secret-key-at-least-32-chars
JWT_SECRET_KEY=your-jwt-secret-at-least-32-chars
ALLOWED_HOSTS=localhost,127.0.0.1

# Database
DATABASE_URL=postgis://postgres:yourpassword@localhost:5432/traffic_dss

# Redis
REDIS_URL=redis://localhost:6379/0

# External APIs (optional)
TOMTOM_API_KEY=your-tomtom-key
PAGASA_API_ENDPOINT=https://api.pagasa.dost.gov.ph/api/v1/
```

**Important:** Never commit `.env` to git. The `.gitignore` already excludes it.

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

This starts: Django backend, Celery worker, Celery beat, Vite frontend, Electron desktop.

### Individual Services

| Service | Command | URL |
|---------|---------|-----|
| Backend | `npm run dev:backend` | http://127.0.0.1:8000 |
| Frontend | `npm run dev:renderer` | http://127.0.0.1:5173 |
| Celery Worker | `npm run dev:worker` | -- |
| Celery Beat | `npm run dev:beat` | -- |
| Desktop | `npm run dev:desktop` | http://127.0.0.1:3001 |

### Stop All
```bash
npm run stop:local
```

---

## 8. Background Tasks (Celery)

| Task | Schedule | Function |
|------|----------|----------|
| `fetch_traffic_data` | Every 5 min | Fetch TSI from TomTom (parallel HTTP) |
| `fetch_weather_data` | Every 15 min | Fetch WIF from PAGASA/Open-Meteo |
| `incident_lifecycle` | Every 5 min | Auto-resolve stale incidents (4h) |
| `incident_archive` | Daily | Archive resolved incidents (24h) |
| `compute_heatmap_tsi` | Every 5/15 min | Update heatmap TSI (peak/off-peak) |
| `cleanup_old_data` | Daily | Soft-delete data older than 90 days |

**Note:** The Celery worker must be running for optimization runs to execute. If the worker is not running, optimization runs will stay in "queued" status forever.

---

## 9. External APIs

### TomTom (Traffic Tiles)
1. Get API key from https://developer.tomtom.com/
2. Add `TOMTOM_API_KEY=your-key` to `.env`
3. The tile proxy endpoints require authentication (`IsAuthenticated`)

### Weather
- **PAGASA** (Philippines): Set `PAGASA_API_ENDPOINT` in `.env`
- **Open-Meteo** (Fallback): No API key needed, configured by default

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

### Dashboard (Authenticated Write)
| Endpoint | Method | Auth |
|----------|--------|------|
| `/api/dashboard/bottlenecks/manage/` | POST | Required |
| `/api/dashboard/bottlenecks/manage/<id>/` | PUT/DELETE | Required |
| `/api/dashboard/officers/manage/` | POST | Required |
| `/api/dashboard/officers/manage/<id>/` | PUT/DELETE | Required |

### Optimization
| Endpoint | Method | Auth |
|----------|--------|------|
| `/api/optimization/configure/` | POST | Required |
| `/api/optimization/start/` | POST | Required |
| `/api/optimization/cancel/<run_id>/` | POST | Required |
| `/api/optimization/status/<run_id>/` | GET | Public |
| `/api/optimization/results/<run_id>/` | GET | Public |
| `/api/optimization/history/` | GET | Public |

### Deployments
| Endpoint | Method | Auth |
|----------|--------|------|
| `/api/deployments/schedule/` | GET | Required |
| `/api/deployments/schedule/` | DELETE | Required (`?shift=morning` or `?shift=afternoon`) |
| `/api/deployments/assign/` | POST | Required |
| `/api/deployments/publish-optimization/` | POST | Required |

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
| Login | http://127.0.0.1:5173/login |
| Dashboard | http://127.0.0.1:5173/ |
| Optimization | http://127.0.0.1:5173/optimization |
| Gantt Chart | http://127.0.0.1:5173/gantt-chart |
| API Docs (Swagger) | http://127.0.0.1:8000/api/docs/ |
| Django Admin | http://127.0.0.1:8000/admin |

---

## 12. Troubleshooting

### Celery worker not picking up tasks
Restart the worker after code changes:
```bash
# Stop with Ctrl+C, then:
cd traffic_dss_backend
celery -A config worker --loglevel=info
```

### Optimization shows 0 fitness
- Check that Celery worker is running
- Check that Redis is running (`redis-cli ping`)
- Restart the worker after engine changes

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
