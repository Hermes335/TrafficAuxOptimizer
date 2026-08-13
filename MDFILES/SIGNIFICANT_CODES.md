# Significant Code Files with Explanations

---

## 1. NSGA-II Optimization Engine

**File:** `traffic_dss_backend/optimization/engine.py`

This is the core optimization algorithm. It uses NSGA-II (Non-dominated Sorting Genetic Algorithm II) to find optimal officer-to-bottleneck assignments.

```python
class GeneticDeploymentOptimizer:
    """NSGA-II multi-objective optimizer for officer-to-bottleneck assignments."""
```

### 4 Independent Objectives

```python
def _evaluate_objectives(self, chromosome, officers, bottlenecks, weather_impact_factor):
    # Objective 1: Coverage Efficiency - % of bottlenecks covered by at least 1 officer
    coverage_efficiency = (len(covered) / len(bottlenecks)) * 100

    # Objective 2: Response Time Score - how fast officers can reach bottlenecks
    # Speed decreases with higher TSI (congestion): speed = max(8, 28 * (1 - tsi))
    # Travel time multiplied by Weather Impact Factor (WIF)
    response_time_score = max(0, 100 - (avg_response_time * 2))

    # Objective 3: Road Priority Coverage - weighted coverage by road importance
    road_priority_coverage = (assigned_priority_weight / total_priority_weight) * 100

    # Objective 4: Resource Utilization - % of officers deployed
    resource_utilization = (assigned_count / total_officers) * 100
```

### Hard Constraint Enforcement

```python
def _check_constraints(self, chromosome, officers, bottlenecks):
    # Constraint 1: Minimum coverage (adaptive based on officer count)
    max_possible_coverage = len(officers) / len(bottlenecks)
    min_coverage = min(0.60, max_possible_coverage * 0.9)

    # Constraint 2: No severe over-assignment
    fair_share = len(officers) / len(bottlenecks)
    max_allowed = max(4, int(fair_share * 3))

    # If violated, fitness multiplied by 1e-6 (effectively zero)
```

### NSGA-II Non-Dominated Sorting

```python
def _fast_non_dominated_sort(self, scored):
    """Ranks solutions by Pareto dominance.
    Solution A dominates B if A is better in ALL objectives.
    Front 0 = non-dominated (best solutions)."""
    for i in range(n):
        for j in range(i + 1, n):
            if self._dominates(scored[i][1], scored[j][1]):
                dominated_set[i].append(j)
                domination_count[j] += 1
```

### Crowding Distance (Diversity Preservation)

```python
def _crowding_distance(self, scored, front):
    """Measures how isolated a solution is in objective space.
    Higher crowding distance = more diverse = preferred."""
    for obj in objectives:
        sorted_front = sorted(front, key=lambda i: scored[i][1][obj])
        distances[sorted_front[0]] = inf  # boundary solutions always kept
        distances[sorted_front[-1]] = inf
```

### Convergence Detection (Early Stopping)

```python
def _compute_hypervolume_2d(pareto_front):
    """Computes 2D hypervolume of Pareto front.
    If improvement < 0.01% for 20 generations -> stop early."""
    if improvement < 1e-4:
        no_improvement_count += 1
        if no_improvement_count >= 3:
            return GARunResult(status="completed", converged_early=True)
```

---

## 2. Celery Task (Data Pipeline)

**File:** `traffic_dss_backend/optimization/tasks.py`

This task runs the optimization in the background and broadcasts progress via WebSocket.

```python
@shared_task
def run_optimization(run_id, params, shift):
    # 1. Fetch real data from database
    officers = Officer.objects.filter(
        is_deleted=False, status__in=["available", "deployed"], shift=shift
    ).values("id", "badge_number", "current_latitude", "current_longitude")

    # 2. Get TSI from bottleneck.tsi field (updated by TomTom fetch)
    tsi_val = float(bottleneck.tsi) if bottleneck.tsi > 0 else 0.0

    # 3. Get Weather Impact Factor
    weather = WeatherData.objects.filter(is_deleted=False).order_by("-timestamp").first()
    wif = float(weather.weather_impact_factor)

    # 4. Run NSGA-II optimization
    engine = GeneticDeploymentOptimizer()
    result = engine.run(
        officers=officers, bottlenecks=bottlenecks,
        parameters=params, weather_impact_factor=wif,
        progress_callback=lambda gen, total, fitness: broadcast_progress(...)
    )

    # 5. Store results with Pareto data
    run.result_data = {
        "top_solutions": result.top_solutions,
        "pareto_curve_data": result.pareto_curve_data,
        "converged_early": result.converged_early,
    }
```

---

## 3. Traffic Data Fetcher (Real-Time TSI)

**File:** `traffic_dss_backend/external/tasks.py`

Fetches real traffic data from TomTom API every 5 minutes and updates bottleneck TSI.

```python
@shared_task
def fetch_traffic_data():
    bottlenecks = list(Bottleneck.objects.filter(is_deleted=False))

    # Parallel HTTP requests (8 workers)
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(_fetch_single_traffic, b): b for b in bottlenecks}
        for future in as_completed(futures):
            bottleneck, snapshot, source = future.result()

            # TSI = 1 - (current_speed / free_flow_speed)
            tsi_val = float(snapshot.get("tsi", 0.0))

            # Save to TrafficData table
            TrafficData.objects.create(
                bottleneck=bottleneck, timestamp=now,
                traffic_severity_index=tsi_val,
                avg_speed=float(snapshot.get("current_speed", 0.0)),
            )

            # Update bottleneck.tsi so dashboard map dots reflect real traffic
            bottleneck.tsi = tsi_val
            updated_bottlenecks.append(bottleneck)

    # Bulk update all bottleneck TSI values
    Bottleneck.objects.bulk_update(updated_bottlenecks, ["tsi", "updated_at"])
```

### TSI Calculation

```python
# In external/clients.py
def fetch_tomtom_traffic(latitude, longitude):
    # Gets current speed and free flow speed from TomTom API
    current_speed = data["currentSpeed"]    # e.g., 16 km/h
    free_flow_speed = data["freeFlowSpeed"] # e.g., 36 km/h
    tsi = 1.0 - (current_speed / free_flow_speed)  # = 0.556

    # TSI interpretation:
    # 0.0 = free flow (green dot)
    # 0.4 = moderate (yellow dot)
    # 0.6 = heavy (orange dot)
    # 0.8+ = critical (red dot)
```

---

## 4. WebSocket Progress Broadcasting

**File:** `traffic_dss_backend/optimization/tasks.py`

Broadcasts generation-by-generation progress to the frontend.

```python
def progress_callback(current_generation, total_generations, current_fitness):
    # Calculate estimated completion from elapsed time
    elapsed = (timezone.now() - start_time).total_seconds()
    rate = current_generation / max(elapsed, 1)
    remaining = (total_generations - current_generation) / max(rate, 0.001)
    est_completion = (timezone.now() + timedelta(seconds=remaining)).isoformat()

    payload = {
        "event": "optimization_progress",
        "run_id": run_id,
        "status": "running",
        "current_generation": current_generation,
        "total_generations": total_generations,
        "current_fitness": round(current_fitness, 4),
        "estimated_completion": est_completion,
    }

    # Save to Redis for status polling
    save_progress(run_id, payload)

    # Broadcast via Django Channels WebSocket
    _broadcast_progress(run_id, payload)
```

---

## 5. Deployment Publishing (Officer Status Sync)

**File:** `traffic_dss_backend/deployments/views.py`

When publishing optimization results, officers are set to "deployed" status.

```python
class DeploymentPublishOptimizationView(APIView):
    def post(self, request):
        # 1. Get top solution from optimization run
        run = OptimizationRun.objects.get(run_id=run_id)
        top_solution = run.result_data["top_solutions"][0]
        assignments = top_solution["assignments"]

        # 2. If replacing existing, reset old officers to "available"
        if replace_existing:
            for officer_id in set(old_officer_ids):
                if not Deployment.objects.filter(is_deleted=False, officer_id=officer_id).exists():
                    Officer.objects.filter(pk=officer_id).update(status="available")

        # 3. Create new deployments
        for item in assignments:
            officer = Officer.objects.get(pk=item["officer_id"])
            bottleneck = Bottleneck.objects.get(pk=item["bottleneck_id"])
            Deployment.objects.create(officer=officer, bottleneck=bottleneck, ...)
            deployed_officer_ids.add(officer.id)

        # 4. Set deployed officers to "deployed" status
        Officer.objects.filter(pk__in=deployed_officer_ids).update(status="deployed")
```

---

## 6. Dashboard KPI Endpoint

**File:** `traffic_dss_backend/dashboard/views.py`

Returns live metrics for the dashboard KPI cards.

```python
class DashboardKPIsView(APIView):
    def get(self, request):
        # Active officers = available + deployed (not off_duty)
        active_officers = Officer.objects.filter(
            is_deleted=False, status__in=["available", "deployed"]
        ).count()

        # Deployed officers = only "deployed" (actually assigned)
        deployed_officers = Officer.objects.filter(
            is_deleted=False, status="deployed"
        ).count()

        # Resource Utilization = deployed / active * 100
        resource_utilization = (deployed_officers / active_officers) * 100

        # Coverage Efficiency = 90 - (critical_incidents * 5)
        coverage_efficiency = max(0, 90 - (critical_incidents * 5))

        # Weather Correlation = latest WIF from weather data
        weather_correlation = float(weather.weather_impact_factor)
```

---

## 7. Dashboard Bottleneck Endpoint

**File:** `traffic_dss_backend/dashboard/views.py`

Returns bottleneck data with real TSI, weather impact, and assigned officers.

```python
class DashboardBottlenecksView(APIView):
    def get(self, request):
        weather = WeatherData.objects.filter(is_deleted=False).order_by("-timestamp").first()
        wif = float(weather.weather_impact_factor)

        for b in bottlenecks:
            # TSI from bottleneck.tsi field (updated by TomTom task)
            tsi_val = b.tsi if b.tsi > 0 else 0.0

            # Weather Impact Factor (base WIF + TSI-based adjustment)
            weather_impact_factor = wif * (1 + tsi_val * 0.3)

            # Assigned officers with names and badge numbers
            assigned_officers = [
                {"name": d.officer.name, "badge_number": d.officer.badge_number}
                for d in deployments
            ]

            # Status classification
            status = "critical" if tsi_val >= 0.8 else "warning" if tsi_val >= 0.4 else "normal"
```

---

## 8. Frontend Auto-Refresh Token

**File:** `src/app/services/backend.ts`

Automatically refreshes expired JWT tokens on 401 responses.

```typescript
async function fetchWithTimeout(url, options) {
  const token = localStorage.getItem("auth_token");
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}` } });

  // If 401 (expired), try refreshing
  if (response.status === 401) {
    const refreshToken = localStorage.getItem("refresh_token");
    const refreshResponse = await fetch(`${apiBase}/api/auth/refresh/`, {
      method: "POST",
      body: JSON.stringify({ refresh: refreshToken }),
    });

    if (refreshResponse.ok) {
      const { access } = await refreshResponse.json();
      localStorage.setItem("auth_token", access);
      // Retry original request with new token
      return fetch(url, { ...options, headers: { Authorization: `Bearer ${access}` } });
    }

    // Refresh failed -> redirect to login
    window.location.href = "/login";
  }
}
```

---

## 9. Map Assignment Lines

**File:** `src/app/hooks/useMapAssignmentLines.ts`

Draws patrol route lines on the map when "Assignments" view is active.

```typescript
export function useMapAssignmentLines({ mapRef, selectedView, bottlenecks, deployments }) {
  useEffect(() => {
    if (selectedView !== "Assignments") return;

    // Group deployments by officer to find patrol routes
    for (const [officer, bnIds] of officerAssignments) {
      if (bnIds.length < 2) continue;
      // Draw dashed blue line between bottlenecks sharing the same officer
      lineFeatures.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: { officer },
      });
    }

    // Draw assignment dots (size = officer count)
    for (const [bnId, deps] of bnAssignments) {
      dotFeatures.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [bn.longitude, bn.latitude] },
        properties: { officer_count: deps.length, officers: deps.map(d => d.officer_name) },
      });
    }
  }, [selectedView, deployments]);
}
```

---

## 10. Scenario Presets

**File:** `src/app/hooks/useOptimizationConfig.ts`

Pre-configured weight presets for different scenarios.

```typescript
const PRESETS = {
  normal: {
    tsiWeight: 35, wifWeight: 25, rpwWeight: 25, resourceUtilizationWeight: 15
  },
  typhoon: {
    // Prioritize weather impact (50%) during typhoon
    tsiWeight: 30, wifWeight: 50, rpwWeight: 15, resourceUtilizationWeight: 5
  },
  special_event: {
    // Prioritize traffic severity (50%) during events
    tsiWeight: 50, wifWeight: 15, rpwWeight: 25, resourceUtilizationWeight: 10
  },
  balanced: {
    // Equal weights (25% each)
    tsiWeight: 25, wifWeight: 25, rpwWeight: 25, resourceUtilizationWeight: 25
  },
};
```

---

## Data Flow Summary

```
TomTom API -> fetch_traffic_data (every 5 min) -> bottleneck.tsi field
                                                    |
Dashboard <- DashboardBottlenecksView <- bottleneck.tsi + assigned_officers
                                                    |
Optimization -> run_optimization task -> NSGA-II engine -> Pareto front
                                                    |
Results -> OptimizationEngine page -> top solutions + Pareto chart
                                                    |
Publish -> DeploymentPublishOptimizationView -> officer.status = "deployed"
                                                    |
Gantt Chart <- fetchDeploymentSchedule <- Deployment table
```
