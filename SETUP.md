# TrafficAuxOptimizer - Setup Guide

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 18+ | Frontend build (Vite) |
| Python | 3.10+ | Django backend |
| PostgreSQL | 14+ | Database with PostGIS |
| Redis | 6+ | Cache & message broker |
| SUMO (optional) | 1.18+ | Traffic simulation |

---

## 1. Environment Setup

### 1.1 Clone & Install Dependencies

```bash
# Clone repository
git clone <repo-url>
cd "TrafficAuxOptimizer Design Help and Demo"

# Install Node dependencies
npm install
```

### 1.2 Create Python Virtual Environment

```bash
# Create virtual environment
python -m venv .venv

# Activate (Windows)
.venv\Scripts\activate

# Activate (Linux/Mac)
source .venv/bin/activate

# Install Python dependencies
cd traffic_dss_backend
pip install -r requirements.txt
```

---

## 2. Database Setup (PostgreSQL + PostGIS)

### 2.1 Install PostgreSQL with PostGIS

**Ubuntu:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib postgis

# Create database
sudo -u postgres createdb traffic_dss
sudo -u postgres psql -d traffic_dss -c "CREATE EXTENSION postgis;"
```

**Windows:**
1. Download & install PostgreSQL from https://www.postgresql.org/download/windows/
2. During installation, check "PostGIS"
3. Create database via pgAdmin or CLI

### 2.2 Configure Database

Create `traffic_dss_backend/.env`:

```env
DEBUG=True
SECRET_KEY=your-secret-key-here
ALLOWED_HOSTS=localhost,127.0.0.1

# Database
DATABASE_URL=postgis://postgres:password@localhost:5432/traffic_dss

# Redis
REDIS_URL=redis://localhost:6379/0

# Optional: External APIs
TOMTOM_API_KEY=your-tomtom-key
PAGASA_API_ENDPOINT=https://api.pagasa.dost.gov.ph/api/v1/
OPENWEATHER_API_KEY=your-key

# Coordinates
ILOILO_LATITUDE=10.7202
ILOILO_LONGITUDE=122.5621
```

---

## 3. Redis Setup

### 3.1 Install Redis

**Ubuntu:**
```bash
sudo apt install redis-server
sudo service redis-server start
redis-cli ping  # Should return PONG
```

**Windows (via WSL or Memurai):**
```powershell
# Option 1: Use WSL
wsl -d Ubuntu -e bash
sudo service redis-server start

# Option 2: Use Memurai (Redis for Windows)
# Download from https://www.memurai.com/
```

### 3.2 Verify Redis

```bash
redis-cli ping
# Expected: PONG

redis-cli INFO SERVER | grep redis_version
```

---

## 4. Backend Initialization

```bash
cd traffic_dss_backend

# Run migrations
python manage.py migrate

# Create superuser (optional)
python manage.py createsuperuser
```

### 4.1 Create Test Accounts

The project includes a management command to create test user accounts for different roles:

```bash
# Create Supervisor account
python manage.py create_test_user --username supervisor --password supervisor123 --badge 1001 --role supervisor

# Create Dispatcher account
python manage.py create_test_user --username dispatcher --password dispatcher123 --badge 2001 --role dispatcher

# Create Administrator account
python manage.py create_test_user --username admin --password admin123 --badge 0001 --role administrator
```

**Test Login Credentials:**

| Role | Username | Password | Badge | Access Level |
|------|-----------|-----------|-------|--------------|
| Supervisor | `supervisor` | `supervisor123` | 1001 | Full optimization & deployment controls |
| Dispatcher | `dispatcher` | `dispatcher123` | 2001 | Read-only monitoring |
| Administrator | `admin` | `admin123` | 0001 | System settings & user management |

**Usage:**
1. Start the backend: `npm run dev:backend`
2. Start the frontend: `npm run dev:renderer`
3. Open http://127.0.0.1:5173/login
4. Enter any of the credentials above

**Note:** The login page requires the backend to be running. If testing frontend-only, you can temporarily disable authentication in `src/app/routes.tsx` by removing the `ProtectedRoute` wrapper.

---

## 5. Import Data (CSV)

### 5.1 Import Officers & Bottlenecks

The project includes a management command to import from CSV:

```bash
python manage.py import_officers_bottlenecks
```

Default expected CSV: `Traffic Officer Assignments and Badge Numbers - Traffic Officer Assignments and Badge Numbers.csv`

**CSV format expected:**
| Name | Badge Number | Relief | Area of Assignment | District |
|------|--------------|--------|-------------------|----------|
| John Doe | B001 | 1st Relief | Iloilo City Plaza | Central |

### 5.2 Import Bottlenecks from CSV (Alternative)

```bash
python manage.py replace_bottlenecks_from_csv bottlenecks.csv
```

### 5.3 Seed Dashboard Data

```bash
python manage.py seed_dashboard_data
```

---

## 6. Running the Application

### 6.1 Full Local Stack (Windows)

```bash
# Start everything (backend + worker + renderer + desktop)
npm run dev:local
```

### 6.2 Individual Services

**Backend (Django):**
```bash
npm run dev:backend
# Or manually:
cd traffic_dss_backend
python manage.py runserver 127.0.0.1:8000
```

**Frontend (Vite):**
```bash
npm run dev:renderer
# Runs on http://127.0.0.1:5173
```

**Desktop (Electron):**
```bash
npm run dev:desktop
```

**Celery Worker (Background Tasks):**
```bash
npm run dev:worker
# Or manually:
cd traffic_dss_backend
python -m celery -A config worker -l info --pool=solo
```

**Celery Beat (Scheduled Tasks):**
```bash
npm run dev:beat
# Or manually:
cd traffic_dss_backend
python -m celery -A config beat -l info
```

### 6.3 Stop All Services

```bash
npm run stop:local
```

---

## 7. Background Tasks (Celery)

The following tasks run automatically via Celery Beat:

| Task | Schedule | Function |
|------|----------|----------|
| `fetch_traffic_data` | Every 5 min | Fetch TSI from TomTom for each bottleneck |
| `fetch_weather_data` | Every 15 min | Fetch WIF from PAGASA/Open-Meteo |
| `cleanup_old_data` | Daily | Soft-delete data older than 90 days |

**Monitoring Celery:**
```bash
# View worker logs
python -m celery -A config worker -l info

# View beat logs
python -m celery -A config beat -l info
```

---

## 8. External APIs Configuration

### 8.1 TomTom (Traffic Data)

1. Get API key from https://developer.tomtom.com/
2. Add to `.env`:
   ```
   TOMTOM_API_KEY=your-api-key
   ```

### 8.2 Weather APIs

**Option A: PAGASA (Philippines)**
```
PAGASA_API_ENDPOINT=https://api.pagasa.dost.gov.ph/api/v1/
```

**Option B: Open-Meteo (Fallback - Free)**
- No API key needed - configured by default

---

## 9. GitIgnore Files

The following are already excluded in `.gitignore`:

```gitignore
# Node
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Build outputs
dist/
build/
coverage/

# Python
.venv/
venv/
__pycache__/
*.py[cod]
*.sqlite3

# Env files
.env
.env.*
!.env.example

# OS/Editor
.DS_Store
Thumbs.db
.vscode/settings.json
```

**Additional recommended exclusions:**

```gitignore
# Django
media/
staticfiles/
*.log

# Celery
celerybeat-schedule
celerybeat.pid

# Testing
.pytest_cache/
htmlcov/

# IDE
.idea/
*.swp
*.swo
```

---

## 10. Troubleshooting

### Redis Port Conflict (Windows)

If Redis fails to start due to port conflict:

```powershell
# Check what's using port 6379
netstat -ano | findstr :6379

# Stop Windows Redis service (if running)
Stop-Service Redis

# Start WSL Redis instead
wsl -d Ubuntu -e bash
sudo service redis-server start
```

### Database Connection Issues

```bash
# Test PostgreSQL connection
psql -U postgres -d traffic_dss -c "SELECT postgis_version();"

# Should return: POSTGIS="3.x" ...
```

### Celery Worker Not Starting

```bash
# Check Redis is running
redis-cli ping

# Check Celery configuration
cd traffic_dss_backend
python -c "from django.conf import settings; print(settings.CELERY_BROKER_URL)"
```

---

## 11. Access Points

| Service | URL |
|---------|-----|
| Frontend (Vite) | http://127.0.0.1:5173 |
| Login Page | http://127.0.0.1:5173/login |
| Django API | http://127.0.0.1:8000 |
| Electron Desktop | http://127.0.0.1:3001 |
| Admin Panel | http://127.0.0.1:8000/admin |
| API Docs (Swagger) | http://127.0.0.1:8000/api/docs/ |

---

## 12. Development Commands Summary

```bash
# Full local dev (all services)
npm run dev:local

# Frontend only
npm run dev:renderer

# Backend only
npm run dev:backend

# Background workers
npm run dev:worker    # Celery worker
npm run dev:beat     # Celery beat (schedules)

# Stop
npm run stop:local
```