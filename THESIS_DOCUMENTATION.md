# TrafficAuxOptimizer: Intelligent Traffic Management System

## A Genetic Algorithm-Based Deployment Optimization System for Urban Traffic Management

---

## 1. Abstract

This document presents the technical documentation of **TrafficAuxOptimizer**, a desktop application designed to optimize traffic auxiliary deployment in urban environments. The system employs a **Genetic Algorithm (GA)** to optimally assign traffic officers to bottleneck locations based on real-time traffic conditions, weather data, and road priority weights. The application integrates external APIs (TomTom, PAGASA/Open-Meteo) for live traffic and weather data, utilizes Celery for asynchronous task processing, and provides a modern React-based frontend with Electron for desktop deployment.

---

## 2. Introduction

### 2.1 Problem Statement

Urban traffic congestion is a significant challenge in metropolitan areas, particularly in developing regions with limited infrastructure. Efficient deployment of traffic personnel requires balancing multiple factors:

- **Traffic Severity Index (TSI)** - Real-time congestion levels at various points
- **Weather Impact Factor (WIF)** - Environmental conditions affecting traffic flow
- **Road Priority** - Strategic importance of different road segments
- **Officer Availability** - Distribution and shift schedules of traffic personnel

### 2.2 Solution Overview

TrafficAuxOptimizer addresses these challenges through:

1. **Automated Data Collection** - Continuous fetching of traffic and weather data
2. **Genetic Algorithm Optimization** - Evolutionary computation for optimal assignments
3. **Real-time Dashboard** - Live monitoring of traffic conditions and deployments
4. **Scenario Management** - Configurable optimization parameters for different situations

---

## 3. System Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                                 │
│  ┌──────────────────┐    ┌──────────────────┐                     │
│  │   React UI       │    │  Electron Shell  │                     │
│  │   (Vite + TS)    │    │  (Desktop App)   │                     │
│  └────────┬─────────┘    └────────┬─────────┘                     │
│           │                        │                               │
│           └──────────┬─────────────┘                               │
│                      │                                             │
│              ┌───────▼───────┐                                     │
│              │  REST API     │                                     │
│              │  (Django)    │                                     │
│              └───────┬───────┘                                     │
└──────────────────────│──────────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   ┌────▼────┐    ┌────▼────┐    ┌────▼────┐
   │ Redis   │    │PostgreSQL│    │External │
   │(Celery) │    │+PostGIS │    │  APIs   │
   └─────────┘    └──────────┘    └─────────┘
```

### 3.2 Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | React 18 + TypeScript | UI Components |
| **Desktop Shell** | Electron 34 | Desktop Application |
| **Build Tool** | Vite 6 | Development & Bundling |
| **UI Framework** | Tailwind CSS 4 | Styling |
| **Backend** | Django 5 | REST API & Business Logic |
| **Database** | PostgreSQL 14 + PostGIS | Spatial Data Storage |
| **Task Queue** | Celery | Background Processing |
| **Message Broker** | Redis | Celery Broker |
| **WebSocket** | Django Channels | Real-time Updates |

---

## 4. Data Models

### 4.1 Core Entities

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  Bottleneck │       │   Officer   │       │  Deployment │
├─────────────┤       ├─────────────┤       ├─────────────┤
│ id          │       │ id          │       │ id          │
│ name        │       │ name        │       │ officer_id  │
│ latitude    │       │ badge_number│       │ bottleneck  │
│ longitude   │       │ shift       │       │ shift       │
│ road_priori │       │ status      │       │ start_time  │
│ ty_weight   │       │ current_lat │       │ end_time    │
│ bottleneck_ │       │ current_lng │       │ assignment_ │
│ type        │       │ skills      │       │ type        │
│ district    │       └─────────────┘       └─────────────┘
└─────────────┘             │                     │
       │                    │                     │
       └────────────────────┼─────────────────────┘
                            │
                    ┌───────▼───────┐
                    │OptimizationRun│
                    ├───────────────┤
                    │ run_id        │
                    │ parameters    │
                    │ fitness_scores│
                    │ result_data   │
                    │ status        │
                    └───────────────┘
```

### 4.2 Data Collection Models

```
┌─────────────┐       ┌─────────────┐
│ TrafficData │       │ WeatherData │
├─────────────┤       ├─────────────┤
│ bottleneck  │       │ timestamp   │
│ timestamp   │       │ condition   │
│ traffic_sev │       │ temperature │
│ _index(TSI) │       │ precipita.. │
│ vehicle_cnt │       │ weather_    │
│ avg_speed   │       │ impact_(WIF)│
└─────────────┘       └─────────────┘
```

---

## 5. Genetic Algorithm Implementation

### 5.1 Algorithm Overview

The system uses a **Genetic Algorithm (GA)** to solve the officer-to-bottleneck assignment problem. The GA optimizes the deployment by evolving a population of candidate solutions over multiple generations.

### 5.2 Chromosome Representation

Each chromosome represents a complete deployment assignment:

```
Chromosome = [bottleneck_index_1, bottleneck_index_2, ..., bottleneck_index_N]
              │                    │                    │
              │                    │                    └── Officer N assigned to
              │                    └── Officer 2 assigned to
              └── Officer 1 assigned to
```

Where each gene is an integer representing the bottleneck ID assigned to each officer.

### 5.3 Fitness Function

The fitness function evaluates each chromosome based on multiple objectives:

```
Fitness = (coverage_efficiency × tsi_weight)
        + (response_time_score × wif_weight)
        + (road_priority_coverage × rpw_weight)
        + (resource_utilization × resource_weight)
```

**Components:**

| Component | Formula | Description |
|-----------|---------|-------------|
| **Coverage Efficiency** | `(covered_bottlenecks / total_bottlenecks) × 100` | Percentage of bottlenecks covered |
| **Response Time Score** | `max(0, 100 - (avg_response_time × 2))` | Based on travel time considering weather |
| **Road Priority Coverage** | `(assigned_priority_weight / total_priority) × 100` | Coverage of high-priority roads |
| **Resource Utilization** | `(assigned_officers / total_officers) × 100)` | Efficient use of personnel |

### 5.4 GA Parameters

Default parameters (configurable via UI):

| Parameter | Default | Range |
|-----------|---------|-------|
| Population Size | 200 | 50-500 |
| Generations | 300 | 50-1000 |
| Mutation Rate | 0.10 | 0.01-0.30 |
| Crossover Rate | 0.80 | 0.50-0.95 |
| Elitism Count | 5 | 1-20 |

### 5.5 Evolutionary Operators

1. **Selection** - Tournament selection with tournament size = 3
2. **Crossover** - Two-point crossover
3. **Mutation** - Swap mutation with random reassignment
4. **Elitism** - Top N solutions preserved to next generation

---

## 6. External API Integration

### 6.1 Traffic Data (TomTom)

The system fetches real-time traffic data using the TomTom Traffic API:

```
Endpoint: https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json
Parameters: point (lat,lng), unit (KMPH)
Output: currentSpeed, freeFlowSpeed → TSI calculation
```

**TSI Calculation:**
```python
tsi = max(0, min(1, 1 - (currentSpeed / freeFlowSpeed)))
```

### 6.2 Weather Data

Two weather sources are implemented:

**Primary: PAGASA (Philippine Atmospheric, Geophysical and Astronomical Services Administration)**

**Fallback: Open-Meteo (Free API)**

**WIF Calculation:**
| Condition | WIF Value |
|-----------|-----------|
| Clear | 1.0 |
| Light Rain | 1.15 |
| Moderate Rain | 1.35 |
| Heavy Rain | 1.65 |
| Severe (Storm) | 2.0 |

---

## 7. Background Processing (Celery)

### 7.1 Task Schedule

| Task | Frequency | Function |
|------|-----------|----------|
| `fetch_traffic_data` | Every 5 minutes | Updates TSI for all bottlenecks |
| `fetch_weather_data` | Every 15 minutes | Updates weather conditions |
| `cleanup_old_data` | Daily | Archives data older than 90 days |
| `run_optimization` | On-demand | Executes GA optimization |

### 7.2 Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Celery    │────▶│   Celery    │────▶│   Django    │
│    Beat     │     │   Worker    │     │   Backend   │
│ (Scheduler) │     │ (Executor)  │     │   (Tasks)   │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │                   │                   │
       └───────────────────┴───────────────────┘
                          │
                   ┌──────▼──────┐
                   │   Redis     │
                   │   Broker    │
                   └─────────────┘
```

---

## 8. User Interface

### 8.1 Pages/Modules

| Page | Description |
|------|-------------|
| **Dashboard** | Real-time overview of traffic status, KPIs, bottleneck map |
| **Optimization** | Configure and run GA optimization with parameter controls |
| **Optimization Engine** | Live progress view with convergence chart |
| **Optimization Running** | Real-time generation progress with fitness scores |
| **Deployment Schedule** | Gantt chart view of officer assignments |
| **Scenarios** | Save and load optimization presets (Normal/Weather/Event) |
| **Analytics** | Historical trends and performance metrics |
| **Incident Report** | Report and track traffic incidents |
| **Audit Logs** | System activity audit trail |
| **Settings** | Application configuration |

### 8.2 Dashboard Features

- **KPI Cards**: Coverage Efficiency, Average Response Time, Resource Utilization, Weather Correlation
- **Bottleneck Map**: Interactive map with color-coded status (normal/warning/critical)
- **Incident Feed**: Real-time incident notifications
- **Live Updates**: WebSocket-based real-time data refresh

---

## 9. API Endpoints

### 9.1 Dashboard API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dashboard/kpis/` | GET | Get KPI metrics |
| `/api/dashboard/bottlenecks/` | GET | List all bottlenecks |
| `/api/dashboard/incidents/active/` | GET | Get active incidents |
| `/api/dashboard/officers/` | GET | List traffic officers |

### 9.2 Optimization API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/optimization/configure/` | POST | Validate parameters |
| `/api/optimization/start/` | POST | Start optimization run |
| `/api/optimization/status/{run_id}/` | GET | Get run status |
| `/api/optimization/results/{run_id}/` | GET | Get optimization results |
| `/api/optimization/history/` | GET | List past runs |
| `/api/optimization/cancel/{run_id}/` | POST | Cancel running optimization |

### 9.3 Deployment API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/deployments/schedule/` | GET | Get deployment schedule |
| `/api/deployments/schedule/` | DELETE | Clear schedule |
| `/api/deployments/publish-optimization/` | POST | Publish optimization results |

### 9.4 External Data API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/weather/current/` | GET | Current weather data |
| `/api/analytics/trends/` | GET | Historical trends |
| `/api/admin/audit-logs/` | GET | System audit logs |

---

## 10. Installation & Setup

### 10.1 Prerequisites

- Node.js 18+
- Python 3.10+
- PostgreSQL 14+ with PostGIS extension
- Redis 6+

### 10.2 Quick Start

```bash
# Install dependencies
npm install

# Start full development stack
npm run dev:local
```

### 10.3 Services

| Service | Command | Port |
|---------|---------|------|
| Frontend | `npm run dev:renderer` | 5173 |
| Backend | `npm run dev:backend` | 8000 |
| Desktop | `npm run dev:desktop` | 3001 |
| Celery Worker | `npm run dev:worker` | - |
| Celery Beat | `npm run dev:beat` | - |

---

## 11. Data Flow

### 11.1 Continuous Data Collection

```
TomTom API ─▶ Celery Task ─▶ TrafficData Model ─▶ Dashboard
                     │
PAGASA/Open-Meteo ──▶───────────▶ WeatherData Model ─▶ Optimization
```

### 11.2 Optimization Workflow

```
User Request ─▶ Validate Parameters ─▶ Create Run Record
       │                                    │
       ▼                                    ▼
Celery Task ◀──────────────▶ Start GA Optimization
       │                                    │
       │  (progress callbacks every generation)
       │                                    ▼
       │                            Store Results
       ▼                                    │
WebSocket ──────────────────────────▶ Frontend Display
```

---

## 12. Future Enhancements

### 12.1 Planned Features

1. **SUMO Integration** - Microscopic traffic simulation for solution validation
2. **Real-time What-If Scenarios** - Test deployment changes before implementation
3. **Mobile Officer App** - Field officers receive assignments on mobile devices
4. **ML-based Predictions** - Forecast traffic patterns using historical data

### 12.2 Scalability Considerations

- Horizontal scaling with Django multi-instance deployment
- Redis cluster for high-throughput message brokering
- PostgreSQL read replicas for dashboard queries

---

## 13. Conclusion

TrafficAuxOptimizer demonstrates the effective application of Genetic Algorithms to solve the complex problem of traffic officer deployment optimization. By integrating real-time traffic and weather data with an evolutionary optimization algorithm, the system provides data-driven deployment recommendations that can significantly improve urban traffic management efficiency.

The modular architecture enables continuous enhancement while maintaining system reliability through Celery-based asynchronous processing and comprehensive error handling.

---

## References

1. Genetic Algorithm fundamentals for optimization problems
2. Django REST Framework for API development
3. Celery distributed task queue documentation
4. TomTom Traffic API documentation
5. PostGIS spatial database extensions

---

*Document Version: 1.0*
*Last Updated: May 2026*
*Application: TrafficAuxOptimizer v0.0.1*