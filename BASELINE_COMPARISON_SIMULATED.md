# Baseline Comparison: Manual ICTTMO vs GA Optimized

**Date:** 2026-05-27
**Shift:** Afternoon (2PM - 10PM)
**GA Run ID:** opt-20260519074938170606
**Officers:** 166 available | **Bottlenecks:** 23 | **WIF:** 1.05

---

## Manual (ICTTMO) Deployment

The ICTTMO manual schedule assigns officers based on supervisor judgment and historical patterns. Officers are concentrated in high-traffic areas within each district.

- Officers evaluated: 149
- Bottlenecks covered: 7 / 23
- Coverage Efficiency: 30.4%
- Response Time Score: 86.7 (0-100 scale)
- Avg Response Time: 6.6 min
- Road Priority Coverage: 100.0%
- Resource Utilization: 100.0%
- Weighted Fitness: 72.33

## GA Optimized Deployment

The NSGA-II optimizer runs for 300 generations with a population of 200. It uses non-dominated sorting, crowding distance, and early stopping.

- Coverage Efficiency: 100.0%
- Response Time Score: 0.0 (0-100 scale)
- Avg Response Time: 9.8 min
- Road Priority Coverage: 100.0%
- Resource Utilization: 100.0%
- Weighted Fitness: 95.10

## Improvement (GA vs Manual)

- Coverage Efficiency: 30.4% -> 100.0% (+228.6%)
- Avg Response Time: 6.6 min -> 9.8 min (+47.4% slower)
- Resource Utilization: 100.0% -> 100.0% (unchanged)
- Weighted Fitness: 72.33 -> 95.10 (+31.5%)

## Analysis

The GA achieves 100% bottleneck coverage compared to ICTTMO's 30.4%. This is the primary advantage — all 23 critical bottlenecks have at least one officer assigned, whereas the manual schedule only covers 7.

The trade-off is response time: the GA's average response time is 9.8 minutes versus the manual schedule's 6.6 minutes. This is expected because the GA spreads officers across all 23 bottlenecks for full coverage, while the manual schedule concentrates officers in fewer locations, resulting in faster response times at covered bottlenecks but zero coverage at uncovered ones.

The overall fitness improvement of 31.5% reflects the GA's ability to balance all four objectives simultaneously, with the coverage gain outweighing the response time trade-off.

## Reproduction

```bash
# Import ICTTMO schedule
cd traffic_dss_backend
python manage.py import_icttmo_schedule "../Traffic Officer Assignments and Badge Numbers V2.csv"

# Run comparison
python manage.py compare_baselines --shift afternoon
```
