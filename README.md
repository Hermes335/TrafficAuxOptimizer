# TrafficAuxOptimizer

A Traffic Decision Support System (DSS) for the Iloilo City Traffic Management Office (ICTMO). It uses an NSGA-II multi-objective genetic algorithm to optimize traffic officer deployment across bottleneck locations, with real-time WebSocket progress, Pareto front visualization, incident-aware optimization, and deployment scheduling.

## Quick Start

```bash
npm install
npm run dev:local
```

Open http://127.0.0.1:8080/login and use one of the test accounts:

| Role | Username | Password |
|------|----------|----------|
| Administrator | `admin` | `admin123` |
| Supervisor | `supervisor` | `supervisor123` |
| Dispatcher | `dispatcher` | `dispatcher123` |

## Architecture

```
Frontend (React + TypeScript + Vite + Tailwind CSS + shadcn/ui)
  Dashboard      -- Live map, KPIs, bottleneck list, incident/weather context
  Optimization   -- Configure shift, weights, GA parameters; start runs
  Gantt Chart    -- Deployment schedule, coverage matrix, publish from optimization

Backend (Django 4.2 + Celery + Channels + Redis)
  optimization/  -- NSGA-II engine, Celery task, WebSocket progress, Pareto data
  dashboard/     -- KPIs, bottleneck/officer CRUD, map data
  deployments/   -- Schedule, assign, publish optimization results
  incidents/     -- Incident reporting, resolution, WebSocket alerts
  external/      -- TomTom traffic flow, PAGASA/Open-Meteo weather, OSM fallback
```

## Optimization Flow

1. Supervisor clicks **Run Optimization** from Dashboard or navigates to `/optimization`
2. Selects **shift** (Morning 6AM-2PM / Afternoon 2PM-10PM)
3. Adjusts **objective weights** (TSI, WIF, RPW, Resource Utilization) or picks a preset (Normal, Typhoon, Special Event, Balanced)
4. Tunes **GA parameters** (population size, generations, mutation rate, crossover rate, elitism)
5. Clicks **Run Algorithm** -- navigates to `/optimization-running`
6. Backend fetches officers, bottlenecks, weather data, and active incidents; runs NSGA-II optimization
7. **WebSocket broadcasts** generation-by-generation progress (fitness, convergence)
8. On completion, results page shows:
   - Top 3 non-dominated deployment plans with officer assignments (grouped by bottleneck)
   - Pareto front scatter chart (coverage vs response time, color-coded by resource balance)
   - Convergence chart with best and average fitness lines
   - Early-stop status and synthetic data indicators
9. Supervisor clicks **Publish to Schedule** -- officers set to "deployed", deployments appear on Gantt Chart
10. Dashboard remains the live operational view with real-time TSI markers, KPIs, and incidents

## Key Features

- **NSGA-II Multi-Objective Optimization** -- Non-dominated sorting, crowding distance, Pareto front preservation
- **4 Objectives** -- Coverage efficiency, response time, road priority coverage, resource utilization
- **Incident-Aware Optimization** -- Active incidents within 500m boost bottleneck priority weight; incident coverage bonus (+15% fitness)
- **Hard Constraint Penalties** -- Adaptive minimum coverage, over-assignment limits
- **Convergence Detection** -- Hypervolume-based early stopping (20-generation window)
- **Scenario Presets** -- Typhoon mode (WIF 50%), Special Event (TSI 50%), Balanced (25% each), Normal
- **Real-Time Progress** -- WebSocket streaming per generation with estimated completion time
- **Pareto Visualization** -- Scatter chart (coverage vs response time) + data table with weather/balance metrics
- **Deployment Publishing** -- Publish top solution to Gantt Chart; officers auto-set to "deployed"
- **Real-Time Traffic Data** -- TomTom API fetches every 5 min via Celery beat; bottleneck TSI updates automatically
- **Map Incident Markers** -- Red diamond markers for incidents with remove button; optimization uses incident locations
- **Officer Status Lifecycle** -- available ↔ deployed based on deployment schedule

## Services

| Service | Command | Port | Purpose |
|---------|---------|------|---------|
| Django Backend | `npm run dev:backend` | 8000 | REST API server |
| Celery Worker | `npm run dev:worker` | -- | Executes background tasks |
| Celery Beat | `npm run dev:beat` | -- | Triggers periodic tasks (traffic/weather fetch) |
| Vite Frontend | `npm run dev:renderer` | 8080 | React development server |
| Electron Desktop | `npm run dev:desktop` | 3001 | Desktop application wrapper |

Start all: `npm run dev:local` | Stop all: `npm run stop:local`

## Data Sources

| Data | Source | Update Frequency | Used In |
|------|--------|-----------------|---------|
| Traffic Severity Index (TSI) | TomTom Traffic API | Every 5 min | Map dots, optimization fitness |
| Weather Impact Factor (WIF) | PAGASA / Open-Meteo | Every 15 min | Optimization fitness |
| Incident Reports | Dashboard map / ICTTMO | Real-time | Map markers, optimization priority boost |
| Road Priority Weights | Database (static) | Manual | Optimization fitness |
| Officer Locations | Database (null coords) | Manual | Response time calculation |

## Benchmark Results

Tested with 25 officers / 22 bottlenecks, 30 independent runs:

| Metric | Mean ± SD |
|--------|-----------|
| Best Fitness | 96.63 ± 0.49 |
| Convergence Generation | 11.3 ± 3.8 |
| Execution Time | 484.8 ± 57.3 ms |
| Coefficient of Variation | 0.005 |

See [benchmark.md](benchmark.md) for full results.

## Documentation

- [SETUP.md](SETUP.md) -- Full setup guide with prerequisites, database, Redis, test accounts
- [HOW_OPTIMIZATION_WORKS.md](HOW_OPTIMIZATION_WORKS.md) -- NSGA-II algorithm explanation
- [SIGNIFICANT_CODES.md](SIGNIFICANT_CODES.md) -- Key code sections with explanations
- [benchmark.md](benchmark.md) -- GA performance benchmark results
- [API Docs](http://127.0.0.1:8000/api/docs/) -- Swagger UI (when backend is running)
