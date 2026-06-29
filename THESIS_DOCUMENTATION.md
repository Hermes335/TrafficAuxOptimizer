# TrafficAuxOptimizer: Intelligent Traffic Management System

## A Genetic Algorithm-Based Deployment Optimization System for Urban Traffic Management

---

## 1. Abstract

This document presents the technical documentation of **TrafficAuxOptimizer**, a desktop application designed to optimize traffic auxiliary deployment in urban environments. The system employs **NSGA-II (Non-dominated Sorting Genetic Algorithm II)** to optimally assign traffic officers to bottleneck locations based on real-time traffic conditions (TSI), weather data (WIF), and road priority weights. The application integrates multiple external APIs (Google Maps, OSM Overpass, Waze CCP, PAGASA, OpenWeatherMap, NOAA) for comprehensive traffic and weather data collection, utilizes Celery with Redis for asynchronous task processing, and provides a modern React-based frontend with Electron for desktop deployment.

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

### 3.1 System Architecture Overview

The TrafficAuxOptimizer employs a layered architecture consisting of five primary tiers as described in Chapter 3, Section "Components and Design":

```
┌─────────────────────────────────────────────────────────────────────┐
│                    LAYER 1 — DATA SOURCES                            │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────────────┐   │
│  │ Traffic Data    │ │ Weather Data   │ │ Human Inputs            │   │
│  │ • Google Maps   │ │ • PAGASA API   │ │ • ICTTMO Supervisor     │   │
│  │ • OSM Overpass  │ │ • OpenWeather  │ │ • Field Officer App     │   │
│  │ • Waze CCP      │ │ • NOAA         │ │ • DPWH Notices          │   │
│  └────────────────┘ └────────────────┘ └────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    LAYER 2 — DATA INGESTION                         │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  API Connectors → Data Cleaning → Feature Aggregation → Queue│   │
│  │  (Python/httpx)    (Pandas)    (Time-window/Spatial)  (Redis)│   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│               LAYER 3 — PROCESSING & STORAGE                        │
│  ┌───────────┐ ┌──────────────────┐ ┌───────────┐ ┌─────────────┐   │
│  │ Operational│ │  GA Engine      │ │  Reference│ │   Cache     │   │
│  │ DB (PGIS) │ │  NSGA-II +      │ │  DB       │ │   (Redis)   │   │
│  │           │ │  Numba Fitness  │ │           │ │             │   │
│  └───────────┘ └──────────────────┘ └───────────┘ └─────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      LAYER 4 — DECISION                             │
│  ┌──────────────┐ ┌───────────────┐ ┌────────────────┐ ┌───────────┐│
│  │  Deployment │ │  What-If      │ │  Constraint    │ │  Audit    ││
│  │  Planner    │ │  Simulator    │ │  Validator     │ │  Logger   ││
│  └──────────────┘ └───────────────┘ └────────────────┘ └───────────┘│
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      LAYER 5 — PRESENTATION                         │
│  ┌─────────────┐ ┌───────────────┐ ┌────────────────────────────┐   │
│  │Web Dashboard│ │  Visualization│ │  Export Services          │   │
│  │(Django      │ │  (Mapbox/D3/  │ │  (PDF/CSV/Excel)          │   │
│  │ Channels)   │ │   Recharts)   │ │                            │   │
│  └─────────────┘ └───────────────┘ └────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Layer Descriptions

#### Layer 1 — Data Sources

**Traffic Data Providers:** Google Maps Directions API, OpenStreetMap Overpass API, Waze CCP

**Weather Data Providers:** PAGASA API, OpenWeatherMap One Call API, NOAA

**Human Inputs:** ICTTMO supervisor web forms, field officer mobile incident reports, DPWH coordination notices

#### Layer 2 — Data Ingestion

- **API Connectors:** Python Requests/httpx with OAuth2 for secure API access
- **Data Cleaning Module:** Pandas/NumPy for data validation and cleaning
- **Feature Aggregation Engine:** Time-window aggregation and spatial clustering
- **Message Queue:** Redis Streams for reliable message delivery

#### Layer 3 — Processing & Storage

- **GA Optimization Engine:** NSGA-II using Python DEAP or custom implementation
- **Fitness Evaluation Service:** Numba-accelerated for computational efficiency
- **Operational Database:** PostgreSQL + PostGIS for spatial data storage
- **Reference Database:** Historical archives, officer profiles
- **Cache Layer:** Redis for session storage, API responses, GA population state

#### Layer 4 — Decision

- **Deployment Planner:** Generates optimal officer-to-bottleneck assignments
- **What-If Simulator:** Tests deployment scenarios before implementation
- **Constraint Validator:** Ensures assignments meet business rules
- **Audit Logger:** Records all system decisions for accountability

#### Layer 5 — Presentation

- **Web Dashboard Server:** Django Channels for WebSocket-based real-time updates
- **Visualization Engine:** Mapbox GL JS, D3.js, and Recharts for data visualization
- **Export Services:** ReportLab for PDF, Pandas for CSV/Excel exports

### 3.3 Technology Stack

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

## 4. Database Design

### 4.1 Entity-Relationship Diagram (ERD)

The database uses PostgreSQL with PostGIS for spatial data storage. The ERD below uses Crow's Foot notation as described in Chapter 3, Section "Database Design":

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ENTITIES                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────┐                                            │
│  │    BOTTLENECK (PK)       │◄─── 1:N ───┐                              │
│  ├──────────────────────────┤             │                              │
│  │ PK  id (SERIAL)          │             ▼                              │
│  │     name (VARCHAR)       │    ┌──────────────────────┐               │
│  │     location (GEOGRAPHY)  │    │  TRAFFICMETRIC (PK)   │               │
│  │     priority_level (INT)  │    ├──────────────────────┤               │
│  │     road_type (ENUM)      │    │ FK bottleneck_id     │               │
│  │     typical_volume (INT)  │    │     timestamp        │               │
│  │     adjacent_ids (INT[])  │    │     congestion_level │               │
│  └──────────────────────────┘    │     average_speed     │               │
│           │                      │     vehicle_count    │               │
│           │                      │     data_source       │               │
│           │                      │     quality_score     │               │
│           │                      └──────────────────────┘               │
│           │                                                             │
│           ▼                                                             │
│  ┌──────────────────────────┐    ┌──────────────────────┐               │
│  │     BOTTLENECK           │◄─── 1:N ───┤    INCIDENT (PK)   │               │
│  │   ADJACENCY (PK)        │    ┌──────────────────────┤               │
│  ├──────────────────────────┤    │ FK bottleneck_id     │               │
│  │ FK from_bottleneck_id   │    │ FK reporter_id      │               │
│  │ FK to_bottleneck_id     │    │     report_time     │               │
│  │     influence_weight    │    │     type            │               │
│  └──────────────────────────┘    │     severity        │               │
│                                  │     description     │               │
│                                  │     status          │               │
│  ┌──────────────────────────┐    │     resolved_time   │               │
│  │    INCIDENT (PK)         │    └──────────────────────┘               │
│  ├──────────────────────────┤             │                              │
│  │ FK bottleneck_id         │             ▼                              │
│  │ FK reporter_id ──────┐  │    ┌──────────────────────┐               │
│  └──────────────────────┘  │    │  ASSIGNMENT (PK)     │               │
│                            │    ├──────────────────────┤               │
│  ┌──────────────────────────┐    │ FK bottleneck_id     │               │
│  │      OFFICER (PK)        │────┘ FK officer_id       │               │
│  ├──────────────────────────┤    │     shift_id         │               │
│  │ PK  id (SERIAL)          │    │     assignment_date  │               │
│  │     badge_number         │    │     start_time       │               │
│  │     full_name           │    │     end_time         │               │
│  │     rank                │    │     status           │               │
│  │     contact_phone       │    │ FK ga_run_id         │               │
│  │     status (ENUM)       │    └──────────────────────┘               │
│  │     skills[]            │             │                              │
│  │     preferred_shifts    │             │ 1:N                           │
│  │     max_weekly_hours   │             ▼                              │
│  └──────────────────────────┘    ┌──────────────────────┐               │
│           │                     │  OPTIMIZATIONRUN    │               │
│           │ 1:N                 ├──────────────────────┤               │
│           ▼                     │ PK  id (SERIAL)     │               │
│  ┌──────────────────────────┐    │     timestamp        │               │
│  │ OFFICER_CERTIFICATION    │    │     parameters_json │               │
│  ├──────────────────────────┤    │     best_fitness    │               │
│  │ PK  id (SERIAL)          │    │     execution_time  │               │
│  │ FK officer_id           │    │     algorithm_ver   │               │
│  │     certification_name  │    └──────────────────────┘               │
│  │     expiry_date         │                                             │
│  └──────────────────────────┘                                             │
│                                                                          │
│  ┌──────────────────────────┐    ┌──────────────────────┐               │
│  │  WEATHERREADING (PK)     │                                             │
│  ├──────────────────────────┤                                             │
│  │ PK  id (SERIAL)          │    Independent entity (no FK)              │
│  │     timestamp            │                                             │
│  │     temperature          │                                             │
│  │     rainfall_mm         │                                             │
│  │     rainfall_intensity  │                                             │
│  │     weather_code        │                                             │
│  │     alert_level         │                                             │
│  │     flood_warning       │                                             │
│  └──────────────────────────┘                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Relationship Descriptions

| Relationship | Type | Description |
|-------------|------|-------------|
| Bottleneck → TrafficMetric | 1:N | One bottleneck has many traffic metric readings over time |
| Bottleneck → Incident | 1:N | One bottleneck can have multiple incidents reported |
| Bottleneck → Assignment | 1:N | One bottleneck can have multiple officer assignments |
| Bottleneck ↔ Bottleneck | Self-ref | Adjacency network for spatial influence modeling |
| Officer → Assignment | 1:N | One officer can have multiple shift assignments |
| Officer → Incident | 1:N | One officer can report multiple incidents |
| Officer → Certification | 1:N | One officer can have multiple skill certifications |
| OptimizationRun → Assignment | 1:N | One GA run generates multiple deployment assignments |

### 4.3 Entity Attribute Details

#### Bottleneck Entity
| Attribute | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `id` | SERIAL | PK | Auto-increment primary key |
| `name` | VARCHAR(100) | NOT NULL | Location identifier |
| `location` | GEOGRAPHY(POINT, 4326) | NOT NULL | PostGIS spatial point |
| `priority_level` | INTEGER | 1-5 | Strategic importance rating |
| `road_type` | ENUM | arterial/collector/local | Road classification |
| `typical_volume` | INTEGER | | Average daily traffic count |
| `adjacent_bottlenecks` | INTEGER[] | | Array of neighboring bottleneck IDs |

#### Officer Entity
| Attribute | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `id` | SERIAL | PK | Auto-increment primary key |
| `badge_number` | VARCHAR(20) | UNIQUE, NOT NULL | Official badge identifier |
| `full_name` | VARCHAR(100) | NOT NULL | Officer's full name |
| `rank` | VARCHAR(50) | | Position/rank in ICTTMO |
| `contact_phone` | VARCHAR(20) | | Mobile contact number |
| `status` | ENUM | active/inactive/on_leave | Current employment status |
| `skill_certifications` | VARCHAR[] | | Array of certification names |
| `preferred_shifts` | JSON | | Shift preferences per day |
| `max_weekly_hours` | INTEGER | | Contracted hours limit |

#### Assignment Entity (Junction Table)
| Attribute | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `id` | SERIAL | PK | Auto-increment primary key |
| `bottleneck_id` | INTEGER | FK → Bottleneck | Assigned location |
| `officer_id` | INTEGER | FK → Officer | Assigned officer |
| `shift_id` | INTEGER | | Reference to shift schedule |
| `assignment_date` | DATE | NOT NULL | Date of assignment |
| `start_time` | TIMESTAMPTZ | NOT NULL | Shift start timestamp |
| `end_time` | TIMESTAMPTZ | NOT NULL | Shift end timestamp |
| `status` | ENUM | planned/active/completed/cancelled | Assignment status |
| `ga_run_id` | INTEGER | FK → OptimizationRun | Source GA optimization |

#### TrafficMetric Entity
| Attribute | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `id` | SERIAL | PK | Auto-increment primary key |
| `bottleneck_id` | INTEGER | FK → Bottleneck | Associated location |
| `timestamp` | TIMESTAMPTZ | NOT NULL, INDEX | Measurement time |
| `congestion_level` | INTEGER | 0-100 | Percentage congestion |
| `average_speed` | DECIMAL | | Mean vehicle speed (km/h) |
| `vehicle_count` | INTEGER | | Number of vehicles detected |
| `data_source` | VARCHAR(50) | | API source (TomTom/OSM/Waze) |
| `quality_score` | DECIMAL | 0-1 | Data reliability indicator |

#### WeatherReading Entity
| Attribute | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `id` | SERIAL | PK | Auto-increment primary key |
| `timestamp` | TIMESTAMPTZ | NOT NULL | Measurement time |
| `temperature` | DECIMAL | | Degrees Celsius |
| `rainfall_mm` | DECIMAL | | Precipitation in millimeters |
| `rainfall_intensity` | ENUM | none/light/moderate/heavy | Rain intensity |
| `weather_code` | INTEGER | | WMO standard weather code |
| `alert_level` | ENUM | none/watch/warning | PAGASA alert status |
| `flood_warning` | BOOLEAN | | Active flood warning flag |

#### Incident Entity
| Attribute | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `id` | SERIAL | PK | Auto-increment primary key |
| `bottleneck_id` | INTEGER | FK → Bottleneck, NULLABLE | Affected location |
| `report_time` | TIMESTAMPTZ | NOT NULL | Time incident reported |
| `type` | ENUM | accident/closure/construction/special_event | Incident category |
| `severity` | ENUM | critical/major/minor/informational | Impact level |
| `description` | TEXT | | Incident details |
| `status` | ENUM | active/resolved | Current state |
| `resolved_time` | TIMESTAMPTZ | NULLABLE | Time resolved |
| `reporter_id` | INTEGER | FK → Officer | Reporting officer |

#### OptimizationRun Entity
| Attribute | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `id` | SERIAL | PK | Auto-increment primary key |
| `timestamp` | TIMESTAMPTZ | NOT NULL | Run initiation time |
| `parameters_json` | JSON | | GA hyperparameter configuration |
| `best_fitness` | DECIMAL | | Final best fitness score |
| `execution_time_ms` | INTEGER | | Total runtime in milliseconds |
| `convergence_generation` | INTEGER | | Generation at convergence |
| `algorithm_version` | VARCHAR(20) | | GA variant identifier |
| `input_data_hash` | VARCHAR(64) | | SHA-256 hash of input snapshot |

### 4.4 Junction Tables

#### Bottleneck_Adjacency
| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | SERIAL, PK | Primary key |
| `from_bottleneck_id` | FK → Bottleneck | Source bottleneck |
| `to_bottleneck_id` | FK → Bottleneck | Target bottleneck |
| `influence_weight` | DECIMAL | Spatial influence coefficient |

#### Officer_Certification
| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | SERIAL, PK | Primary key |
| `officer_id` | FK → Officer | Certified officer |
| `certification_name` | VARCHAR(100) | Certification title |
| `expiry_date` | DATE | Certification validity |

### 4.5 PostGIS Spatial Features

The database utilizes PostGIS for geographic data storage and spatial queries:

- **GEOGRAPHY(POINT, 4326)** - Stores bottleneck locations as geographic points using WGS84 coordinate system
- **Spatial Indexing** - GiST index on location column for efficient spatial queries
- **Distance Calculations** - Uses `ST_Distance` for officer-to-bottleneck proximity calculations
- **Spatial Clustering** - Supports traffic analysis by geographic zones

### 4.6 Indexing Strategy

| Table | Index | Purpose |
|-------|-------|---------|
| TrafficMetric | (bottleneck_id, timestamp) | Fast time-series queries per location |
| TrafficMetric | (timestamp) | Global time-range queries |
| Incident | (bottleneck_id, status) | Active incidents per location |
| Incident | (timestamp) | Time-range incident queries |
| Assignment | (officer_id, start_time) | Officer's assignment history |
| Assignment | (bottleneck_id, start_time) | Location's assignment history |
| WeatherReading | (timestamp, condition) | Weather trend analysis |
| OptimizationRun | (timestamp, status) | Run history queries |

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

### 5.4 GA Parameters (as per Chapter 3 Design Specifications)

| Parameter | Value | Range |
|-----------|-------|-------|
| Population Size | 200 | 50-500 |
| Generations | 300 | 50-1000 |
| Mutation Rate (Pm) | 0.10 | 0.01-0.30 |
| Crossover Rate (Pc) | 0.80 | 0.50-0.95 |
| Elitism | 10% | 5-20% |
| Tournament Size (k) | 3 | - |

### 5.5 Evolutionary Operators

1. **Selection** - Tournament selection with k=3 [92]
2. **Crossover** - Single-point crossover with Pc=0.8 [43], [44]
3. **Mutation** - Bit-flip mutation with Pm=0.10 [98]
4. **Elitism** - Top 10% solutions preserved to next generation [22]

---

## 6. External API Integration

### 6.1 Traffic Data Sources

The system integrates multiple traffic data providers for comprehensive coverage:

**Primary Sources:**
- **Google Maps Directions API:** Real-time traffic flow and estimated travel times
- **OpenStreetMap Overpass API:** Road network data and spatial features [14], [17]
- **Waze CCP (Connected Citizens Program):** Crowdsourced traffic incident data [14], [17], [73]
- **TomTom Traffic API:** FlowSegmentData for traffic speed analysis

**TSI Calculation:**
```python
tsi = max(0, min(1, 1 - (currentSpeed / freeFlowSpeed)))
```

### 6.2 Weather Data Sources

**Primary: PAGASA (Philippine Atmospheric, Geophysical and Astronomical Services Administration)**

**Secondary Sources:**
- **OpenWeatherMap One Call API:** Global weather data coverage [10], [12], [13]
- **NOAA (National Oceanic and Atmospheric Administration):** Historical weather patterns [27]

**Fallback: Open-Meteo (Free API without API key requirement)**

**WIF Calculation:**
| Condition | WIF Value |
|-----------|-----------|
| Clear | 1.0 |
| Light Rain | 1.15 |
| Moderate Rain | 1.35 |
| Heavy Rain | 1.65 |
| Severe (Storm) | 2.0 |

### 6.3 Human Input Sources

- **ICTTMO Supervisor Web Forms:** Configuration and parameter adjustments
- **Field Officer Mobile Reports:** Real-time incident reporting [4], [7], [24]
- **DPWH Coordination Notices:** Road closures and construction alerts [37]

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
| Frontend | `npm run dev:renderer` | 8080 |
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

The current implementation provides a functional core system. The following enhancements are planned for future development to extend capabilities:

### 12.1 SUMO Traffic Simulation Integration

**Description:** Integrate SUMO (Simulation of Urban MObility) for microscopic traffic simulation to validate GA-generated deployment plans before actual implementation.

**Benefits:**
- Validate officer assignments in a simulated environment
- Predict traffic flow improvements with virtual deployments
- Test "what-if" scenarios without real-world consequences

**Implementation Approach:**
1. Generate SUMO network file for Iloilo City from OpenStreetMap data
2. Create TraCI Python client to interface with SUMO
3. Map bottleneck locations to SUMO network edges
4. Run simulations on top-3 GA solutions and score using:
   - Vehicle throughput
   - Average delay time
   - Queue length reduction

**Expected Impact:** Significantly improved confidence in deployment recommendations by testing them in a realistic traffic simulation before field implementation.

### 12.2 Real-Time What-If Scenario Analysis

**Description:** Interactive scenario builder allowing supervisors to test deployment changes before committing.

**Features:**
- Simulate road closures or construction zones
- Adjust traffic demand patterns for events
- Modify signal timing to see impact on officer requirements
- Compare multiple deployment strategies side-by-side

**Technical Requirements:**
- Cached simulation results for quick scenario switching
- WebSocket-based real-time scenario comparison
- Decision support dashboard with recommendation rankings

### 12.3 Mobile Officer Application

**Description:** Native mobile application for field officers to receive real-time assignments and report incidents.

**Features:**
- Push notifications for new deployment assignments
- GPS-based officer location tracking
- In-app incident reporting with photo capture
- Route guidance to assigned bottleneck locations

### 12.4 Machine Learning-Based Traffic Prediction

**Description:** Use historical traffic and weather data to train predictive models for traffic severity forecasting.

**Potential Algorithms:**
- LSTM (Long Short-Term Memory) networks for time-series prediction
- Gradient Boosting for multi-factor traffic forecasting
- Prophet for seasonal pattern detection

**Benefits:**
- Proactive officer deployment based on predicted congestion
- Early warning system for high-traffic periods
- Improved optimization accuracy by using forecasted TSI values

### 12.5 Scalability Considerations

| Enhancement | Effort | Priority |
|-------------|--------|----------|
| SUMO Integration | Medium | High |
| What-If Scenarios | Medium | High |
| Mobile App | High | Medium |
| ML Predictions | High | Low |

**Infrastructure Scaling:**
- Horizontal scaling with Django multi-instance deployment
- Redis cluster for high-throughput message brokering
- PostgreSQL read replicas for dashboard queries
- CDN integration for static assets

---

## 13. Conclusion

TrafficAuxOptimizer demonstrates the effective application of Genetic Algorithms to solve the complex problem of traffic officer deployment optimization. By integrating real-time traffic and weather data with an evolutionary optimization algorithm, the system provides data-driven deployment recommendations that can significantly improve urban traffic management efficiency.

The modular architecture enables continuous enhancement while maintaining system reliability through Celery-based asynchronous processing and comprehensive error handling.

---

## 13. System Architecture Diagram

The following describes the system architecture for diagram generation, aligned with Chapter 3 "Components and Design":

```
┌─────────────────────────────────────────────────────────────────────┐
│                    LAYER 1 — DATA SOURCES (Light Blue)               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐             │
│  │Google    │ │ OSM      │ │PAGASA    │ │ Human       │             │
│  │Maps      │ │Overpass  │ │API       │ │ Inputs      │             │
│  └──────────┘ └──────────┘ └──────────┘ └─────────────┘             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐             │
│  │Waze CCP  │ │OpenWeather│ │NOAA     │ │ Field       │             │
│  │         │ │Map        │ │        │ │ Officer App │             │
│  └──────────┘ └──────────┘ └──────────┘ └─────────────┘             │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 LAYER 2 — DATA INGESTION (Light Green)              │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  API Connectors → Data Cleaning → Feature Aggregation → Queue │   │
│  │  (Python/httpx)    (Pandas)    (Time-window/Spatial)  (Redis) │   │
│  └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              LAYER 3 — PROCESSING (Light Orange)                    │
│  ┌──────────┐ ┌────────────────────────────────┐ ┌───────────┐        │
│  │Operational│ │         OptCore               │ │Reference │        │
│  │DB (PGIS) │ │  ┌─────────────────────────┐  │ │DB        │        │
│  └──────────┘ │  │  GA Engine (NSGA-II)   │  │ └───────────┘        │
│               │  │  Fitness Evaluator     │  │ ┌───────────┐        │
│  ┌──────────┐ │  │  Constraint Validator  │  │ │  Redis    │        │
│  │ GA Pop   │ │  └─────────────────────────┘  │ │  Cache    │        │
│  │ State    │ │                               │ └───────────┘        │
│  └──────────┘ └────────────────────────────────┘                     │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 LAYER 4 — DECISION (Light Purple)                    │
│  ┌───────────────┐ ┌───────────────┐ ┌────────────────┐ ┌──────────┐│
│  │  Deployment   │ │  What-If      │ │  Constraint    │ │  Audit   ││
│  │  Planner      │ │  Simulator    │ │  Validator     │ │  Logger  ││
│  └───────────────┘ └───────────────┘ └────────────────┘ └──────────┘│
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                LAYER 5 — PRESENTATION (Light Teal)                   │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Web Dashboard                             │    │
│  │  ┌──────────────┐ ┌─────────────┐ ┌──────────────────────┐   │    │
│  │  │ Bottleneck  │ │    Shift   │ │  Deployment Plan      │   │    │
│  │  │  Ranking    │ │ Assignments│ │  (PDF/CSV/Excel)     │   │    │
│  │  └──────────────┘ └─────────────┘ └──────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘

                           ACTORS
  ┌────────────────┐                              ┌────────────────┐
  │    ICTTMO      │                              │    Field       │
  │  Supervisor    │──────────────────────────────│    Officer     │
  └────────────────┘                              └────────────────┘
         │                                                  │
         │ Approve/Modify                                   │ Report
         │                                                  │ Incidents
         └──────────────────┬───────────────────────────────┘
                            ▼
                      Web Dashboard
```

### 13.1 Diagram Generation Guidelines for Thesis

**Format:** Compact, portrait-oriented, maximum 6.5 inches wide
**Text:** Minimum 10pt font size for legibility when printed
**Style:** Flat design with subtle rounded corners, no 3D effects or shadows
**Colors:** Subtle background tints per layer (blue, green, orange, purple, teal)
**Layout:** Stack 5 horizontal layers vertically with tight spacing

**Layer Color Coding:**
- Layer 1 (Sources): Light blue tint (#E3F2FD)
- Layer 2 (Ingestion): Light green tint (#E8F5E9)
- Layer 3 (Processing): Light orange tint (#FFF3E0)
- Layer 4 (Decision): Light purple tint (#F3E5F5)
- Layer 5 (Presentation): Light teal tint (#E0F2F1)

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