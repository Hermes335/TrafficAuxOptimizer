# Field Test Documentation
## Traffic Deployment DSS vs Manual ICTTMO Deployment

### Diversion Road + Jaro District | 1 Week Comparison

---

## 1. Objective

To evaluate whether the Genetic Algorithm (GA) optimization system produces better traffic officer deployments than the current manual process used by the Iloilo City Traffic Management Office (ICTTMO).

The comparison measures:
- **Coverage** — percentage of bottleneck intersections with at least one officer assigned
- **Resource utilization** — how efficiently officers are distributed across bottlenecks
- **Response time** — estimated travel time from officer location to bottleneck
- **Traffic severity** — TSI readings at covered vs uncovered bottlenecks

## 1A. Controlled Shadow Pilot

The first field activity uses **Atrium Rotonda** as a data-collection pilot. Manual ICTTMO deployment remains the operational decision. The application runs in shadow mode: its recommendation is recorded for comparison but is not published or used to redirect officers.

### Pilot files

- `field_test/shadow_pilot_observations.csv` — actual field conditions and manual deployment observations
- `field_test/shadow_pilot_recommendations.csv` — application recommendations and supervisor decision
- `field_test/icttmo_manual_assignments.csv` — reserved for importing approved manual deployments; do not use it for app recommendations

### Pilot procedure

1. Before the shift, confirm the location, date, shift, available roster, and manual assignment with the ICTTMO supervisor.
2. Verify that Atrium Rotonda is registered as a bottleneck and that its traffic data is current.
3. Record the manual assignment and starting conditions in `shadow_pilot_observations.csv`.
4. Run the application using the same shift and available officer roster. Record its recommendation in `shadow_pilot_recommendations.csv`.
5. Do not click **Publish Schedule** and do not change field assignments based only on the app recommendation.
6. At a fixed interval, preferably every 15 or 30 minutes, record actual officers present, TSI, weather, incidents, queue condition, and any deviation from the manual plan.
7. At the end of the shift, record the supervisor's decision and any data-quality problems in the recommendation file.

### Data separation rules

- Keep `manual` and `app-shadow` records separate.
- Do not import shadow recommendations as `source="optimized"` deployments.
- Do not create synthetic incidents to fill missing observations.
- Record real incidents separately from ordinary traffic observations.
- The ICTTMO supervisor retains final authority over live deployment decisions.

The existing automated comparison command is configured for the original Diversion Road + Jaro district. For the Atrium Rotonda pilot, compare the two shadow-pilot CSV files manually until the selected locations and comparison workflow are configured.

---

## 2. Test District

### Bottlenecks (7 total)

| # | Name | ID | Coordinates | Road Type |
|---|---|---|---|---|
| 1 | Commission Civil St → Diversion Rd | bn-ea7c3e9c87 | 10.7222, 122.5599 | Major intersection |
| 2 | Diversion Rd → Donato Pison Ave | bn-f2de3c0ae6 | 10.7082, 122.5490 | Major intersection |
| 3 | SM City Iloilo Access Road | bn-3214db616f | 10.7144, 122.5523 | Commercial area |
| 4 | Diversion Rd → Megaworld / Festive Walk | bn-a46b4bc59e | 10.7186, 122.5478 | Commercial area |
| 5 | Diversion Rd → Smallville Intersection | bn-d40322601d | 10.7288, 122.5457 | Nightlife district |
| 6 | Jaro Plaza | bn-44a0c33f20 | 10.7244, 122.5561 | Heritage/commercial |
| 7 | Taft North Intersection | bn-8bfd0f9a7d | 10.7196, 122.5521 | University area |

All 7 bottlenecks are on major roads with verified TomTom traffic flow data.

### Why This District

- All intersections have real-time traffic data from TomTom
- Mix of road types (commercial, university, heritage, nightlife)
- Concentrated area — officers can realistically cover multiple points
- Diversion Road is a primary arterial with consistent congestion patterns

---

## 3. Requirements

### System Requirements

| Component | Requirement | Status |
|---|---|---|
| Django backend | Running on port 8000 | Must be on |
| Celery worker | Processing background tasks | Must be on |
| Celery beat | Periodic traffic/weather fetch | Must be on |
| Redis | Message broker | Must be on |
| TomTom API | Traffic flow data | Active key configured |
| PostgreSQL + PostGIS | Spatial database | Running |

### Data Requirements

| Data | Source | Update Frequency |
|---|---|---|
| Traffic flow (TSI) | TomTom API | Every 5 minutes |
| Weather (WIF) | OpenMeteo API | Every 15 minutes |
| Officer locations | Manual entry or GPS | Per shift |
| Incident reports | Dashboard or API | As needed |
| POI data | OpenStreetMap import | Static (already imported) |

### Personnel Requirements

| Role | Responsibility |
|---|---|
| ICTTMO Supervisor | Approves manual assignments for Week 1 |
| Traffic Officer(s) | Assigned to intersections per schedule |
| Researcher | Records data, runs optimization, documents results |

---

## 4. Schedule

### Week 1: Manual ICTTMO Baseline (June 2-6, 2026)

| Day | Date | Shift | Activity |
|---|---|---|---|
| Monday | June 2 | 2:00 PM - 10:00 PM | ICTTMO assigns officers manually |
| Tuesday | June 3 | 2:00 PM - 10:00 PM | ICTTMO assigns officers manually |
| Wednesday | June 4 | 2:00 PM - 10:00 PM | ICTTMO assigns officers manually |
| Thursday | June 5 | 2:00 PM - 10:00 PM | ICTTMO assigns officers manually |
| Friday | June 6 | 2:00 PM - 10:00 PM | ICTTMO assigns officers manually |

### Week 2: Optimized Deployment (June 9-13, 2026)

| Day | Date | Shift | Activity |
|---|---|---|---|
| Monday | June 9 | 2:00 PM - 10:00 PM | Run optimization, publish assignments |
| Tuesday | June 10 | 2:00 PM - 10:00 PM | Run optimization, publish assignments |
| Wednesday | June 11 | 2:00 PM - 10:00 PM | Run optimization, publish assignments |
| Thursday | June 12 | 2:00 PM - 10:00 PM | Run optimization, publish assignments |
| Friday | June 13 | 2:00 PM - 10:00 PM | Run optimization, publish assignments |

---

## 5. How to Collect the Baseline (Week 1)

### Step 1: Get Manual Assignments from ICTTMO

Each afternoon before the shift starts (before 2:00 PM):
1. Ask ICTTMO supervisor which officers are assigned to which intersections
2. Record in `field_test/icttmo_manual_assignments.csv`

### Step 2: Fill the CSV Template

The CSV is pre-filled with dates and bottleneck IDs. Fill in the officer details:

```
Date,Shift,Officer_Name,Officer_Badge,Bottleneck_Name,Bottleneck_ID,Start_Time,End_Time,Notes
2026-06-02,afternoon,Juan Dela Cruz,1234,Commission Civil St -> Diversion Rd,bn-ea7c3e9c87,14:00,22:00,
2026-06-02,afternoon,Maria Santos,5678,Diversion Rd -> Donato Pison Ave,bn-f2de3c0ae6,14:00,22:00,Light rain
```

**Important:**
- One row per officer-bottleneck assignment
- If one officer covers multiple bottlenecks, add a row for each
- If a bottleneck has no officer, leave the officer fields empty
- Add notes about weather, incidents, or special conditions

### Step 3: Import into the System

After collecting the CSV, import it:

```bash
cd traffic_dss_backend
python manage.py import_icttmo_schedule ../field_test/icttmo_manual_assignments.csv --shift afternoon
```

This creates Deployment records with `source=manual` for comparison.

### Step 4: Verify Import

```bash
python manage.py field_test_compare --shift afternoon
```

Should show manual assignments for each bottleneck.

---

## 6. How to Run the Optimization (Week 2)

### Step 1: Open the Dashboard

Navigate to `http://localhost:8080` and log in.

### Step 2: Check Current Conditions

On the Dashboard, verify:
- Traffic data is updating (bottleneck markers show TSI values)
- Weather data is current
- No critical incidents affecting the test district

### Step 3: Run Optimization

1. Go to **Optimization** page
2. Select shift: **Afternoon**
3. Review auto-suggested weights (or use preset: Normal)
4. Click **Run Algorithm**
5. Wait for completion (typically 2-5 minutes)

### Step 4: Review Results

On the results page:
- Check coverage percentage
- Review officer assignments per bottleneck
- Verify all 7 test district bottlenecks are covered
- Check the convergence chart for fitness improvement

### Step 5: Publish Assignments

1. Click **Publish to Schedule**
2. Confirm the publish action
3. Verify deployments appear in the Gantt Chart

### Step 6: Record Conditions

In the CSV Notes column or a separate log, record:
- Weather conditions during the shift
- Any incidents that occurred
- Any deviations from the published schedule

---

## 7. How to Compare Results

### Automated Comparison

After both weeks are complete:

```bash
cd traffic_dss_backend
python manage.py field_test_compare --shift afternoon
```

This outputs:
- Manual vs optimized coverage
- Officer deployment counts
- Per-bottleneck assignment breakdown
- TSI readings for each bottleneck

### Manual Comparison Metrics

Record these metrics for each day:

| Metric | How to Measure |
|---|---|
| Coverage (%) | Bottlenecks with >= 1 officer / 7 total |
| Officers deployed | Count of unique officers assigned |
| Avg officers per bottleneck | Total assignments / 7 |
| TSI at covered bottlenecks | Average TSI where officers are present |
| TSI at uncovered bottlenecks | Average TSI where no officers are present |
| Incidents during shift | Count of reported incidents |
| Weather impact factor | WIF value from system |

### Fitness Score Comparison

The system's fitness function combines:
- Coverage efficiency (35%)
- Response time (25%)
- Road priority weight (25%)
- Resource utilization (15%)

Run the baseline comparison command to get fitness scores:

```bash
python manage.py field_test_compare --shift afternoon
```

---

## 8. Expected Outcomes

### Hypothesis

The GA-optimized deployment will achieve:
- **Higher or equal coverage** with the same number of officers
- **Lower average response time** due to optimized officer placement
- **Better resource utilization** by avoiding over-assignment at low-priority bottlenecks
- **Higher fitness score** when evaluated against the same formula

### Possible Scenarios

| Scenario | Interpretation |
|---|---|
| Optimized > Manual on all metrics | GA is clearly better |
| Optimized > Manual on most metrics | GA is better with minor trade-offs |
| Optimized ≈ Manual | Both approaches are equivalent; GA adds automation value |
| Manual > Optimized on some metrics | ICTTMO has domain knowledge the GA lacks; investigate which metrics |

---

## 9. Data Collection Checklist

### Before the Test Starts

- [ ] TomTom API key is active and working
- [ ] Celery worker and beat are running
- [ ] All 7 bottlenecks are tagged with district "Diversion Road + Jaro"
- [ ] Officer data is up to date (names, badge numbers, shifts)
- [ ] CSV template is ready in `field_test/`
- [ ] ICTTMO supervisor is briefed on the protocol

### Each Day (Week 1 - Manual)

- [ ] Get manual assignments from ICTTMO before 2:00 PM
- [ ] Record in CSV template
- [ ] Note weather conditions
- [ ] Note any incidents during the shift
- [ ] Import CSV into system at end of day

### Each Day (Week 2 - Optimized)

- [ ] Check dashboard data is current
- [ ] Run optimization before 2:00 PM
- [ ] Review and publish assignments
- [ ] Note weather conditions
- [ ] Note any incidents during the shift
- [ ] Record any deviations from optimized schedule

### After the Test

- [ ] Run comparison command
- [ ] Compile results into table
- [ ] Calculate fitness scores for both weeks
- [ ] Document findings and conclusions

---

## 10. Troubleshooting

### TomTom Data Not Updating

```bash
# Check if Celery worker is running
npm run dev:worker

# Check latest traffic data
python manage.py shell -c "
from core.models import Bottleneck
b = Bottleneck.objects.filter(is_deleted=False).first()
print(f'{b.name}: TSI={b.tsi}, updated={b.updated_at}')
"
```

### Optimization Fails to Start

- Check Redis is running: `redis-cli ping`
- Check Celery worker logs for errors
- Verify officer data has GPS coordinates

### Publish Schedule Fails

- Check that the optimization completed successfully
- Verify the `source` field exists on the Deployment model
- Check Django logs for IntegrityError

### Comparison Command Shows No Data

- Verify bottlenecks have `district="Diversion Road + Jaro"`
- Verify deployments have `source="manual"` or `source="optimized"`
- Check that the shift parameter matches (default: afternoon)

---

## 11. Files Reference

| File | Purpose |
|---|---|
| `field_test/icttmo_manual_assignments.csv` | CSV template for manual assignments |
| `field_test/FIELD_TEST_GUIDE.md` | Quick reference guide |
| `field_test/FIELD_TEST.md` | This document |
| `core/management/commands/field_test_compare.py` | Comparison command |
| `core/management/commands/import_icttmo_schedule.py` | CSV import command |
| `BASELINE_COMPARISON.md` | Previous simulation baseline results |
| `FITNESS_FUNCTION.md` | Fitness function formula documentation |
| `HOW_OPTIMIZATION_WORKS.md` | NSGA-II algorithm explanation |

---

## 12. Contact

For questions about the field test protocol, contact the research team.

For system issues, check:
- Django logs: `traffic_dss_backend/logs/`
- Celery logs: terminal running `npm run dev:worker`
- Frontend: browser console (F12)
