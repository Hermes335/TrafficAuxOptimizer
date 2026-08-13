# How the Optimization Works

## Overview

The optimization assigns **officers to bottlenecks** using NSGA-II, a multi-objective genetic algorithm. Instead of finding one "best" solution, it finds a set of **trade-off solutions** (Pareto front) where no solution is better in all objectives simultaneously.

---

## Step 1: Input Data

| Data | Source | Updated |
|------|--------|---------|
| **Officers** | `Officer` table | Status synced on publish/clear |
| **Bottlenecks** | `Bottleneck` table | TSI updated every 5 min from TomTom |
| **TSI** | TomTom API | `1 - (current_speed / free_flow_speed)` |
| **Weather (WIF)** | PAGASA/Open-Meteo | Multiplier on travel time |
| **Road Priority** | `bottleneck.road_priority_weight` | Static per bottleneck |

---

## Step 2: Chromosome Encoding

Each solution is a **chromosome** — an array where each position represents an officer, and the value is the bottleneck they're assigned to.

```
Officers:    [O1, O2, O3, O4, O5]
Chromosome:  [0,  2,  0,  1,  3]
               |   |   |   |   |
Bottlenecks: [B0, B2, B0, B1, B3]
```

- O1 → B0, O2 → B2, O3 → B0, O4 → B1, O5 → B3

---

## Step 3: Fitness Evaluation (4 Objectives)

Each solution is scored on 4 independent objectives:

### Objective 1 — Coverage Efficiency

```
coverage = (bottlenecks_with_at_least_1_officer / total_bottlenecks) x 100
```

Goal: Cover as many bottlenecks as possible.

### Objective 2 — Response Time Score

```
speed = max(8, 28 x (1 - TSI))           // slower in congested areas
travel_time = (distance_km / speed) x 60 x WIF
score = max(0, 100 - (avg_travel_time x 2))
```

Goal: Minimize average travel time from officers to their assigned bottlenecks.

### Objective 3 — Road Priority Coverage

```
coverage = (sum_of_assigned_priority_weights / total_priority_weights) x 100
```

Goal: Prioritize high-importance roads (bridges, main intersections).

### Objective 4 — Resource Utilization

```
utilization = (assigned_officers / total_officers) x 100
```

Goal: Deploy as many officers as possible.

---

## Step 4: Hard Constraint Check

Solutions that violate constraints get fitness multiplied by 1e-6 (effectively zero):

| Constraint | Rule |
|------------|------|
| Minimum coverage | >= min(60%, officers/bottlenecks x 90%) |
| No over-assignment | No bottleneck gets > max(4, fair_share x 3) officers |

---

## Step 5: NSGA-II Selection

### Non-Dominated Sorting

```
Front 0: Solutions not dominated by any other (best trade-offs)
Front 1: Solutions dominated only by Front 0
Front 2: Solutions dominated by Front 0 and 1
...
```

### Crowding Distance

Within the same front, solutions in less crowded regions are preferred (preserves diversity).

### Tournament Selection

Pick 3 random solutions → choose the one with lower rank → if same rank, choose higher crowding distance.

---

## Step 6: Genetic Operators

### Crossover (80% chance)

```
Parent 1: [0, 2, 0, 1, 3]
Parent 2: [1, 0, 2, 3, 1]
          ----swap----
Child 1:  [0, 2, 2, 3, 1]
Child 2:  [1, 0, 0, 1, 3]
```

### Mutation (10% chance)

```
Before: [0, 2, 0, 1, 3]
Swap positions 1 and 3:
After:  [0, 1, 0, 2, 3]
```

### Elitism

Top N solutions from Front 0 are copied directly to next generation.

---

## Step 7: Convergence Detection

Tracks 2D hypervolume (coverage x response time) each generation:

```
If improvement < 0.01% for 20 consecutive generations:
    Stop early → return converged_early=True
```

---

## Step 8: Output

| Output | Description |
|--------|-------------|
| **Top 3 Solutions** | Best from Front 0, with full officer→bottleneck assignments |
| **Pareto Curve Data** | All Front 0 solutions with visualization metadata |
| **Fitness Scores** | Per-generation best fitness (for convergence chart) |
| **Convergence Status** | Whether early stopping triggered |

---

## Visual Summary

```
┌─────────────────────────────────────────────────┐
│                  NSGA-II Loop                    │
│                                                 │
│  Population of N chromosomes                    │
│       ↓                                         │
│  Evaluate 4 objectives + constraints            │
│       ↓                                         │
│  Non-dominated sorting → Front 0, 1, 2, ...     │
│       ↓                                         │
│  Crowding distance within each front            │
│       ↓                                         │
│  Tournament selection (rank + crowding)         │
│       ↓                                         │
│  Crossover + Mutation                           │
│       ↓                                         │
│  Elitism (preserve top N)                       │
│       ↓                                         │
│  Next generation                                │
│       ↓                                         │
│  Repeat for G generations (or early stop)       │
│       ↓                                         │
│  Return Front 0 solutions                       │
└─────────────────────────────────────────────────┘
```

---

## Real Example (from benchmark)

```
Input:  25 officers, 22 bottlenecks, afternoon shift
Output: Fitness 96.79, Coverage 100%, Response 87.14, Resource 100%

Top Solution:
  B0 → O3, O7          (2 officers)
  B1 → O1              (1 officer)
  B2 → O12, O15, O22   (3 officers)
  B3 → O5              (1 officer)
  ...
  Each bottleneck gets officers assigned by the optimizer
```

---

## Key Algorithm Properties

| Property | Value |
|----------|-------|
| Algorithm | NSGA-II (Non-dominated Sorting Genetic Algorithm II) |
| Selection | Tournament (size=3) with rank + crowding distance |
| Crossover | Two-point crossover, 80% rate |
| Mutation | Swap + random reassignment, 10% rate |
| Elitism | Top N individuals preserved (default 20) |
| Convergence | Hypervolume-based early stopping |
| Constraints | Hard penalties (fitness x 1e-6 on violation) |
| Default Population | 200 individuals |
| Default Generations | 300 |
