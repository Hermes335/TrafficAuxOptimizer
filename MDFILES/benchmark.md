# GA Optimization Benchmark Results

**Date:** 2026-05-18 17:05 (UTC+8)
**Engine:** NSGA-II Multi-Objective Genetic Algorithm
**System:** Traffic DSS for Iloilo City (ICTMO)

---

## Test Configuration

| Parameter | Value |
|-----------|-------|
| Population Size (N) | 200 |
| Generations (G) | 300 |
| Mutation Rate (Pm) | 0.10 |
| Crossover Rate (Pc) | 0.80 |
| Elitism Count | 20 (10% of N) |
| Number of Runs | 30 |
| Officers | 25 (constrained from 321 total) |
| Bottlenecks | 22 |
| Weather Impact Factor | 1.0 (clear) |
| Seed Offset | 0 |

**Note:** Officers limited to 25 to create a constrained optimization problem (25 officers / 22 bottlenecks). With all 321 officers, the problem is trivially solvable.

---

## Results Summary

| Metric | Mean ± SD | Unit |
|--------|-----------|------|
| Best Fitness Score | 96.6267 ± 0.4854 | — |
| Convergence Generation | 11.3 ± 3.8 | generations |
| Execution Time | 484.8 ± 57.3 | milliseconds |
| Coefficient of Variation | 0.0050 | ratio |
| Coverage Efficiency (f1) | 99.55 ± 1.39 | % |
| Response Time Score (f2) | 87.14 | 0-100 |
| Weather Responsiveness (f3) | 100.00 | % |
| Resource Utilization (f4) | 100.00 | % |

**Successful runs:** 30/30
**Failed runs:** 0

---

## Range Data (for box plots / error bars)

| Metric | Min | Max |
|--------|-----|-----|
| Best Fitness | 95.1950 | 96.7858 |

---

## Raw Data

### Fitness Values (30 runs)
```
96.7858, 96.7858, 96.7858, 96.7858, 96.7858, 96.7858, 96.7858, 96.7858,
96.7858, 96.7858, 96.7858, 95.1950, 96.7858, 96.7858, 95.1950, 96.7858,
96.7858, 96.7858, 96.7858, 96.7858, 96.7858, 96.7858, 96.7858, 96.7858,
96.7858, 96.7858, 95.1950, 96.7858, 96.7858, 96.7858
```

### Convergence Generations (30 runs)
```
11, 12, 10, 15, 23, 16, 17, 8, 10, 12, 9, 7, 8, 10, 8, 15, 13, 10, 16,
9, 13, 16, 8, 6, 10, 9, 8, 9, 8, 13
```

### Execution Times (ms, 30 runs)
```
480.1, 491.5, 470.7, 545.7, 646.1, 543.3, 575.0, 424.4, 462.5, 500.5,
444.0, 417.8, 433.9, 452.7, 434.1, 538.9, 551.2, 464.7, 548.5, 445.9,
514.5, 556.3, 434.7, 405.9, 468.1, 445.5, 441.6, 451.0, 433.3, 520.0
```

---

## Interpretation

- **27/30 runs** (90%) converged to the optimal fitness of 96.79
- **3/30 runs** (10%) settled at a local optimum of 95.20
- **CV = 0.005** indicates very high consistency across independent runs
- **Convergence at generation ~11** shows the NSGA-II finds good solutions quickly
- **Average execution time ~485ms** is suitable for real-time deployment

---

## Reproduction

```bash
cd traffic_dss_backend
python manage.py benchmark_ga_performance --runs 30 --max-officers 25 --verbose-output
```
