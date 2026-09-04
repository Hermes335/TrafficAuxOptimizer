# P2 Implementation Plan: Should-Fix Before Broader Rollout

## Overview
This plan covers the three P2 items that should be addressed before broader rollout, after the P1 must-fix work is complete and stable:

1. Improve assignment appropriateness logic
2. Add operational threshold warnings to the dashboard
3. Harden production data quality validation

The goal is not just to make assignments valid, but to make them good, defensible, and trustworthy for live operations.

---

## Recommended order
1. P2.1 - Assignment appropriateness scoring
2. P2.2 - Dashboard operational thresholds
3. P2.3 - Production data quality validation

Why this order:
- Appropriateness scoring improves decision quality before users see the assignment plan.
- Dashboard warnings make the operational quality visible to supervisors.
- Data quality validation prevents bad operational assumptions from entering the system in the first place.

---

## P2.1: Improve assignment appropriateness logic

### Objective
The system should not only validate whether an assignment is allowed; it should prefer assignments that are operationally sensible.

### Current gap
The system currently checks whether an officer is eligible to be assigned, but it does not rank whether that assignment is the best choice among several valid candidates.

### Proposed solution
Create a reusable assignment-scoring model that ranks candidate officers for each bottleneck using:
- shift fit
- workload balance
- geographic proximity
- skill match
- current status and availability
- recent assignment history

### Technical design
#### A. Add a scoring utility
Create a new module, for example:
- `traffic_dss_backend/core/assignment_scoring.py`

Functions:
- `score_candidate_officer(officer, bottleneck, context)`
- `rank_candidates_for_bottleneck(bottleneck, officer_queryset, context)`
- `select_best_officer_for_bottleneck(...)`

#### B. Inputs to scoring
Per candidate officer:
- `status` in {available, deployed}
- `shift` matches assignment shift
- `distance_to_bottleneck` if coordinates available
- `current_workload` from active deployments
- `skill_tags` vs bottleneck requirements / incident type
- `recency_penalty` for recently assigned officers
- `coverage_balance` across nearby bottlenecks

#### C. Example scoring formula
A simple weighted score can be used initially:

- shift match: +30
- status available: +25
- proximity to bottleneck: +20 to +40
- skill match: +10 to +30
- workload balance: +5 to +20
- recent reassignment penalty: -10 to -30

Use a threshold to reject low-quality candidates rather than always choosing the max score.

### Implementation tasks
1. Add a score model or utility function
2. Compute candidate pool for each bottleneck
3. Sort candidates by score and return top-ranked officer(s)
4. Add optional “reason” details in API output for operator transparency
5. Expose score metadata in the dashboard response for debugging and approval

### Acceptance criteria
- A valid assignment is selected based on quality, not just existence
- A low-quality candidate can be filtered out before assignment publication
- The system exposes a ranked list of preferred officers for a bottleneck
- Supervisors can see why a candidate was selected or rejected

### Effort estimate
- 3–5 days

### Risks
- Overfitting the scoring model too early
- Poor data quality in officer location or skill fields
- Human supervisors disagreeing with algorithmic decisions without explanation

### Mitigation
- Start with a transparent, explainable weighted model
- Log the score factors for each assignment
- Allow manual override with an audit trail

---

## P2.2: Validate dashboard against operational thresholds

### Objective
The dashboard should warn operators when a bottleneck looks staffed on paper but is actually operationally weak.

### Current gap
The dashboard currently counts assigned officers and required officers, but it does not flag:
- under-staffed bottlenecks
- over-assigned bottlenecks
- mismatched skill coverage
- unhealthy coverage patterns

### Proposed solution
Add a dashboard quality layer that computes a small set of operational health indicators, for example:
- `coverage_status`: healthy / warning / critical
- `staffing_gap`: required minus assigned
- `misaligned_coverage`: count of low-fit assignments
- `over_assignment_warning`: assigned > required and workload is high
- `alert_flags`: array of warnings

### Technical design
Extend the dashboard bottleneck payload to include fields such as:
- `staffing_gap`
- `coverage_status`
- `operational_alerts[]`
- `assigned_officer_count`
- `required_officer_count`
- `skill_coverage_score`

Rules:
- If assigned officers < required officers → warning or critical
- If assigned officers > required officers but all are low-fit or overburdened → warning
- If critical incident exists and no qualified officer is assigned → critical
- If officer shift mismatch or backlog is present → warning

### Implementation tasks
1. Add threshold utility module
2. Compute quality values for each bottleneck
3. Show warnings in the dashboard UI and API response
4. Add a human-readable summary for supervisors
5. Create test cases for healthy vs degraded coverage patterns

### Acceptance criteria
- Operators see a clear warning when required coverage is not met
- Over-assignment and misalignment are visible
- Alerts are tied to real operational conditions, not just raw counts
- Dashboard can distinguish between counts and operational quality

### Effort estimate
- 2–3 days

### Risks
- Data can be noisy if threshold rules are too strict
- UI overload if every warning becomes visible
- Operators may not trust the alert system if it is not explainable

### Mitigation
- Keep thresholds conservative at first
- Limit alert categories to 3 or 4 high-signal warnings
- Add “why this warning exists” metadata in the UI

---

## P2.3: Confirm production data quality before live use

### Objective
The system should reject or quarantine obviously non-production data before it becomes operationally visible.

### Current gap
Some records may still look synthetic, incomplete, or imported from prototype runs. This undermines trust in the dashboard and in optimization results.

### Proposed solution
Introduce a lightweight data-quality validation layer for officers, bottlenecks, and assignments.

### Validation checks
For officers:
- badge number format is valid
- active status is not placeholder-like
- shift is valid
- record is not soft-deleted if active in operations

For bottlenecks:
- latitude and longitude are valid
- location is in approved districts or controlled geography
- required staffing values are within allowed range
- TSI values are in expected range 0–1

For deployments:
- assignment references existing active officer and bottleneck
- no placeholder badge values are present
- assignment do not violate current shift or status rules
- assignment is mapped to an approved source type

### Technical design
Create a validation module, for example:
- `traffic_dss_backend/core/data_quality_checks.py`

Functions:
- `validate_officer_record(officer)`
- `validate_bottleneck_record(bottleneck)`
- `validate_deployment_record(deployment)`
- `get_data_quality_issues(queryset)`

Add an API or admin summary that reports:
- total invalid records
- issue counts by category
- quality score per dataset

### Implementation tasks
1. Define a production data policy
2. Implement validation rules for each domain model
3. Add a report endpoint or admin summary
4. Flag suspicious rows instead of silently accepting them
5. Create a remediation workflow for invalid records

### Acceptance criteria
- Placeholder or synthetic badges are quarantined or rejected
- Malformed or missing geographic data is caught early
- A data-quality report is visible to operators
- Production imports are validated before being treated as live records

### Effort estimate
- 2–4 days

### Risks
- False positives from legitimate but unusual records
- Bypass by manual admin inserts
- Data-quality rules becoming a bottleneck for operational imports

### Mitigation
- Keep the initial rules narrow and high-confidence
- Allow admin override with reason codes
- Log all quarantined records for review

---

## Suggested implementation schedule

### Phase 1: Design and scoring prototype (Week 1)
- P2.1 score model and candidate ranking
- define weighting and thresholds
- produce first operator-visible reasons

### Phase 2: Dashboard quality layer (Week 1–2)
- add staffing-gap and health indicators
- expose warnings in dashboard API and UI
- validate with sample data

### Phase 3: Data quality enforcement (Week 2)
- add validation module
- add report endpoint
- test against imported data and production-like records

### Phase 4: UAT and rollout gate (Week 2–3)
- run operational review with supervisors
- test manual override and explainability
- confirm broader rollout readiness metrics

---

## Success metrics for broader rollout
The following should be true before the system is considered ready for broader rollout:

- 95%+ of assignments are ranked with a clear quality score and explanation
- dashboard warnings identify genuine operational risk with low noise
- no placeholder or synthetic badge values remain in active production records
- data-quality validation report shows zero critical issues on approved datasets
- supervisor override rate is measurable and explainable

---

## Definition of done for P2
The P2 work is complete when:
- assignment appropriateness is calculated and visible
- operational health warnings are available in the dashboard
- production data quality checks are active and reportable
- a supervisor can understand why the system chose or rejected a candidate
- no obviously synthetic active records remain in the live deployment data

---

## Final recommendation
Treat P2 as the transition from “system works” to “system is operationally trustworthy.”
This is the layer that makes the application usable for broader rollout, not just demonstration or controlled testing.
