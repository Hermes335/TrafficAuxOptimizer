# Fitness Function Formula

## Weighted Fitness

```
Fitness = (Coverage × w₁) + (ResponseTime × w₂) + (RoadPriority × w₃) + (ResourceUtil × w₄) + (IncidentCoverage × 0.15)
```

---

## Default Weights (Normalized to sum = 1.0)

| Weight | Name | Default | Meaning |
|--------|------|---------|---------|
| w₁ | TSI Weight | 0.35 | Traffic severity coverage |
| w₂ | WIF Weight | 0.25 | Weather-responsive response time |
| w₃ | RPW Weight | 0.25 | Road priority coverage |
| w₄ | Resource Weight | 0.15 | Officer utilization |

---

## Objective 1 — Coverage Efficiency (f₁)

```
f₁ = (bottlenecks_with ≥ 1 officer / total_bottlenecks) × 100
```

Measures how many bottlenecks have at least one officer assigned.

---

## Objective 2 — Response Time Score (f₂)

```
speed = max(8, 28 × (1 − TSI_effective))
travel_time = (distance_km / speed) × 60 × WIF
f₂ = max(0, 100 − (avg_travel_time × 2))
```

Where:
- `TSI_effective = bottleneck.tsi + incident_priority_boost` (if incident nearby)
- `WIF = weather_impact_factor` (e.g., 1.03 for light rain, 1.4 for heavy rain)
- `distance_km = geodesic(officer_coords, bottleneck_coords)` (3.0 km fallback if no coords)

Speed decreases with higher congestion (TSI). Weather Impact Factor multiplies travel time.

---

## Objective 3 — Road Priority Coverage (f₃)

```
f₃ = (Σ assigned_priority_weights / Σ all_priority_weights) × 100
```

Where:
- `priority_weight = bottleneck.road_priority_weight + incident_boost` (if incident nearby)

Prioritizes high-importance roads (bridges, main intersections, school zones).

---

## Objective 4 — Resource Utilization (f₄)

```
f₄ = (assigned_officers / total_officers) × 100
```

Measures how many officers are deployed vs total available.

---

## Incident Coverage Bonus (fixed 15% weight)

```
bonus = (incident_bottlenecks_covered / total_incident_bottlenecks) × 100 × 0.15
```

Only active when incidents exist within 500m of bottlenecks.

---

## Incident Priority Boost

```
boost = Σ(severity_multiplier × proximity) for each incident within 500m

severity_multiplier:
  critical = 3.0
  major    = 2.0
  minor    = 1.0

proximity = 1 − (distance_km / 0.5)
```

Closer incidents have stronger effect. Boosts road_priority_weight for the affected bottleneck, making the optimizer assign more officers there.

---

## Hard Constraint Penalties

```
If constraints violated: Fitness = Fitness × 1e-6
```

| Constraint | Formula |
|------------|---------|
| Minimum coverage | `covered_ratio ≥ min(0.60, officers/bottlenecks × 0.9)` |
| No over-assignment | `count_per_bottleneck ≤ max(4, fair_share × 3)` |
| Fair share | `officers / bottlenecks` |

The minimum coverage is adaptive — if fewer officers than bottlenecks, it adjusts to `officers/bottlenecks × 0.9`.

---

## Full Formula Expanded

```
Fitness = 
    f₁ × 0.35                    (Coverage Efficiency)
  + f₂ × 0.25                    (Response Time Score)
  + f₃ × 0.25                    (Road Priority Coverage)
  + f₄ × 0.15                    (Resource Utilization)
  + incident_bonus × 0.15        (Incident Coverage, if incidents present)

If any constraint violated:
    Fitness = Fitness × 0.000001
```

---

## Scenario Presets

| Preset | w₁ (TSI) | w₂ (WIF) | w₃ (RPW) | w₄ (Resource) | Use Case |
|--------|----------|----------|----------|---------------|----------|
| Normal | 0.35 | 0.25 | 0.25 | 0.15 | Default balanced |
| Typhoon | 0.30 | **0.50** | 0.15 | 0.05 | Heavy rain, prioritize weather response |
| Special Event | **0.50** | 0.15 | 0.25 | 0.10 | City parade, prioritize coverage |
| Balanced | 0.25 | 0.25 | 0.25 | 0.25 | Equal weight to all objectives |

Weights are normalized by the engine: each weight is divided by the total sum so they always sum to 1.0.

---

## Benchmark Result

```
Input:  25 officers, 22 bottlenecks, afternoon shift, Normal preset
Output: Fitness = 96.79
        f₁ = 100.00% (full coverage)
        f₂ =  87.14  (response time score)
        f₃ = 100.00% (all priority roads covered)
        f₄ = 100.00% (all officers deployed)
        Convergence: ~11 generations
        Execution: ~485 ms
```

---

## Code Location

- **Engine:** `traffic_dss_backend/optimization/engine.py` — `_evaluate_objectives()` and `_evaluate()`
- **Incident boosts:** `traffic_dss_backend/optimization/engine.py` — `_compute_incident_boosts()`
- **Task data:** `traffic_dss_backend/optimization/tasks.py` — fetches officers, bottlenecks, weather, incidents
- **Frontend config:** `src/app/hooks/useOptimizationConfig.ts` — `toRunParams()` converts UI sliders to API params
