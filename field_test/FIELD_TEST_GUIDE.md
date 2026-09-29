# Field Test Protocol — Diversion Road + Jaro District

**Current application:** follow [APPLICATION_WORKFLOW.md](APPLICATION_WORKFLOW.md) for explicit shadow mode, exports, and dated comparisons. The historical workflow below predates publication revisions. Replace `YYYY-MM-DD` and `RUN_ID` in comparison examples with the selected recommendation's date and ID. Use the deployment board to verify manual assignments before a recommendation exists.

## Current shadow session: Prime State (2026-09-25)

Prime State is bottleneck `B-TEST-VERIFY-2`. Use
`shadow_pilot_observations_2026-09-25.csv` for measured field conditions and
`shadow_pilot_recommendations_2026-09-25.csv` for the application's afternoon
shift recommendation. The supervisor expects 2–3 officers; enter the confirmed
assignment and actual on-site count when observed.

Record the time in Asia/Manila. Run optimization only after checking the current
roster and input freshness, then copy the Prime State recommendation and run ID
to the recommendation CSV. Leave the operational deployment unchanged: do not
confirm publication or import the shadow recommendation as an assignment.
The Week 2 publication steps below describe a separate intervention phase.

## Overview
Compare manual ICTTMO deployment vs GA-optimized deployment over 1 week (5 afternoon shifts).

## Test District: Diversion Road + Jaro (7 Bottlenecks)

| # | Bottleneck | ID | Has Traffic Data |
|---|---|---|---|
| 1 | Commission Civil St → Diversion Rd | bn-ea7c3e9c87 | ✓ |
| 2 | Diversion Rd → Donato Pison Ave | bn-f2de3c0ae6 | ✓ |
| 3 | SM City Iloilo Access Road | bn-3214db616f | ✓ |
| 4 | Diversion Rd → Megaworld / Festive Walk | bn-a46b4bc59e | ✓ |
| 5 | Diversion Rd → Smallville Intersection | bn-d40322601d | ✓ |
| 6 | Jaro Plaza | bn-44a0c33f20 | ✓ |
| 7 | Taft North Intersection | bn-8bfd0f9a7d | ✓ |

## Schedule

### Week 1: Manual ICTTMO Baseline (June 2-6)
- Each afternoon shift (2:00 PM - 10:00 PM)
- ICTTMO assigns officers to the 7 intersections manually
- Record assignments in: `field_test/icttmo_manual_assignments.csv`
- System automatically records TSI data via TomTom

### Week 2: Optimized Deployment (June 9-13)
- Each afternoon shift, run optimization via the dashboard
- System generates assignments for the 7 intersections
- Publish assignments to deployment schedule
- System automatically records TSI data via TomTom

## How to Record Manual Assignments

1. Open `field_test/icttmo_manual_assignments.csv`
2. For each date, fill in:
   - `Officer_Name`: Name of the officer assigned
   - `Officer_Badge`: Badge number
   - `Notes`: Any special conditions (weather, incidents, etc.)
3. One row per officer-bottleneck assignment

Example:
```
Date,Shift,Officer_Name,Officer_Badge,Bottleneck_Name,Bottleneck_ID,Start_Time,End_Time,Notes
2026-06-02,afternoon,Juan Dela Cruz,1234,Commission Civil St → Diversion Rd,bn-ea7c3e9c87,14:00,22:00,
2026-06-02,afternoon,Maria Santos,5678,Diversion Rd → Donato Pison Ave,bn-f2de3c0ae6,14:00,22:00,Rainy
```

## How to Run Optimization (Week 2)

1. Open the dashboard → Optimization page
2. Select shift: Afternoon
3. Click "Run Algorithm"
4. Wait for completion
5. Review results → Click "Publish to Schedule"
6. Confirm publish

## How to Compare Results

The comparison reads the database (manual deployments imported from the CSV,
optimized deployments published from the optimization run). After both weeks
are complete, run:

```bash
python manage.py field_test_compare --location "Diversion Road + Jaro" --shift afternoon --date YYYY-MM-DD --run-id RUN_ID
```

This outputs:
- Manual vs optimized coverage comparison
- Officer deployment counts
- Per-bottleneck assignment breakdown
- TSI readings for each bottleneck

## Metrics to Record

| Metric | Manual (Week 1) | Optimized (Week 2) |
|---|---|---|
| Coverage (%) | | |
| Officers deployed | | |
| Avg response time | | |
| Bottlenecks covered | /7 | /7 |
| Incidents during shift | | |
| Weather conditions | | |

## Notes for Thesis

- The fitness function formula is documented in `FITNESS_FUNCTION.md`
- Baseline comparison results are in `BASELINE_COMPARISON.md`
- The GA parameters can be adjusted on the Optimization page
- TSI data is collected automatically every 5 minutes
- All deployments are tagged with `source=manual` or `source=optimized` for comparison
