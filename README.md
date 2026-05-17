# TrafficAuxOptimizer

A Traffic Decision Support System (DSS) for the Iloilo City Traffic Management Office (ICTMO). It uses an NSGA-II multi-objective genetic algorithm to optimize traffic officer deployment across bottleneck locations, with real-time WebSocket progress, Pareto front visualization, and deployment scheduling.

## Quick Start

```bash
npm install
npm run dev:local
```

Open http://127.0.0.1:5173/login and use one of the test accounts (see SETUP.md).

## Architecture

```
Frontend (React + TypeScript + Vite)
  Dashboard      -- Live map, KPIs, bottleneck list, incident/weather context
  Optimization   -- Configure shift, weights, GA parameters; start runs
  Gantt Chart    -- Deployment schedule, coverage matrix, publish from optimization

Backend (Django + Celery + Channels)
  optimization/  -- NSGA-II engine, Celery task, WebSocket progress, Pareto data
  dashboard/     -- KPIs, bottleneck/officer CRUD, map data
  deployments/   -- Schedule, assign, publish optimization results
  incidents/     -- Incident reporting, resolution, WebSocket alerts
  external/      -- TomTom traffic tiles, PAGASA/Open-Meteo weather, OSM fallback
```

## Optimization Flow

1. Supervisor clicks **Run Optimization** from Dashboard or navigates to `/optimization`
2. Selects **shift** (Morning 6AM-2PM / Afternoon 2PM-10PM)
3. Adjusts **objective weights** (TSI, WIF, RPW, Resource Utilization) or picks a preset (Normal, Typhoon, Special Event, Balanced)
4. Tunes **GA parameters** (population size, generations, mutation rate, crossover rate, elitism)
5. Clicks **Run Algorithm** -- navigates to `/optimization-running`
6. Backend fetches officers, bottlenecks, weather data; runs NSGA-II optimization
7. **WebSocket broadcasts** generation-by-generation progress (fitness, convergence)
8. On completion, results page shows:
   - Top 3 non-dominated deployment plans with officer assignments
   - Pareto front visualization (coverage vs response time, weather responsiveness, resource balance)
   - Convergence chart and early-stop status
9. Supervisor clicks **Publish to Schedule** -- deployments appear on Gantt Chart
10. Dashboard remains the live operational view with map markers, KPIs, and incidents

## Key Features

- **NSGA-II Multi-Objective Optimization** -- Non-dominated sorting, crowding distance, Pareto front preservation
- **4 Objectives** -- Coverage efficiency, response time, road priority coverage, resource utilization
- **Hard Constraint Penalties** -- Minimum 60% coverage, over-assignment limits
- **Convergence Detection** -- Hypervolume-based early stopping (20-generation window)
- **Scenario Presets** -- Typhoon mode (high WIF), Special Event (high TSI), Balanced, Normal
- **Real-Time Progress** -- WebSocket streaming per generation with estimated completion
- **Pareto Visualization** -- Bubble plot metadata (coverage, response time, weather responsiveness, resource balance)
- **Deployment Publishing** -- Publish top solution directly to Gantt Chart schedule

## Services

| Service | Command | Port |
|---------|---------|------|
| Frontend (Vite) | `npm run dev:renderer` | 5173 |
| Backend (Django) | `npm run dev:backend` | 8000 |
| Celery Worker | `npm run dev:worker` | -- |
| Celery Beat | `npm run dev:beat` | -- |
| Desktop (Electron) | `npm run dev:desktop` | 3001 |

Start all: `npm run dev:local` | Stop all: `npm run stop:local`

## Documentation

- [SETUP.md](SETUP.md) -- Full setup guide with prerequisites, database, Redis, test accounts
- [API Docs](http://127.0.0.1:8000/api/docs/) -- Swagger UI (when backend is running)
