# Field Test Readiness Gaps

## Summary
This document lists the main gaps that still need to be addressed before the system is reliable enough for field-test use.

## Priority list

### P1 - Must fix before field test

#### 1. Replace hardcoded staffing requirements
- Current issue: the dashboard uses a fixed `required_officers: 2` for every bottleneck.
- Problem: this does not reflect real traffic demand, incident severity, or required staffing levels.
- Needed fix: compute required staffing dynamically from bottleneck type, TSI, risk level, and active incidents.

#### 2. Add real assignment validation rules
- Current issue: assignments are accepted without checking whether the officer is actually eligible.
- Problem: an officer may be assigned even when they are unavailable, already assigned elsewhere, or on the wrong shift.
- Needed fix: validate officer availability, shift, status, and overlap before publishing an assignment.

#### 3. Prevent duplicate or overlapping assignments
- Current issue: there is no strong server-side check preventing one officer from being assigned to multiple bottlenecks in the same time window.
- Problem: a single officer could appear at multiple locations simultaneously.
- Needed fix: block overlapping `Deployment` records for the same officer in the same shift/time window.

#### 4. Clean out placeholder or synthetic badge values
- Current issue: some live assignment data still contains obvious seed/test values such as `1001`, `0001`, and `2001`.
- Problem: these entries reduce trust in the assignment data and look like prototype/test records mixed into production data.
- Needed fix: remove or quarantine non-production seed data before field deployment.

### P2 - Should fix before broader rollout

#### 5. Improve assignment appropriateness logic
- Current issue: the system checks whether the assignment exists, not whether it is a good match.
- Problem: a triplet of numbers may be valid in the database but still not be the best assignment.
- Needed fix: score candidate officers using shift fit, proximity, workload, and skill match.

#### 6. Validate the dashboard against operational thresholds
- Current issue: the UI counts assignments but does not reflect operational quality.
- Problem: a bottleneck may appear fully staffed while officers are poorly placed or insufficiently qualified.
- Needed fix: include warnings for under-staffed, over-assigned, and misaligned coverage.

#### 7. Confirm production data quality before live use
- Current issue: some records look like generated test data rather than true field records.
- Problem: poor data quality undermines trust in optimization results and deployment plans.
- Needed fix: validate all imported officers, bottlenecks, and assignments against approved production data sources.

## Current assessment
The app is not completely broken, but it is not yet field-ready from an operations standpoint. The system is data-integrated and build-clean, but the assignment logic still needs stronger operational rules to ensure that assignments are appropriate, valid, and trustworthy.

## Recommended order of work
1. Fix staffing requirements
2. Add assignment validation
3. Prevent overlaps and duplicates
4. Remove seed/test records
5. Improve assignment scoring
6. Add operational warnings in the dashboard

## Final note
The current system can display assignments and counts correctly, but it still lacks the real-world rules needed to guarantee that each assignment is appropriate in the field.
