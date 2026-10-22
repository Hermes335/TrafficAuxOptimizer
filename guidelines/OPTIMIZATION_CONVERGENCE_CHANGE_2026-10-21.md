# Optimization convergence change — 2026-10-21

The HQ origin policy described in this release was subsequently replaced at the
user's request; see [the recorded-origin restoration](RECORDED_STARTING_LOCATIONS_2026-10-21.md).

Constant generation scores previously produced tiny floating-point differences in
their running mean. An automatically expanded chart axis magnified those differences
into visible steps while rounding all labels to the same value. Both optimization
screens now share a stable running mean, a minimum axis span, and distinct tick labels.
Saved search scores are unchanged. Flat histories are explicitly labelled.

The stopping heuristic now checks the best attained coverage, response-time score,
road-priority coverage, staffing efficiency, and weighted fitness across all feasible
candidates. It waits at least 50 generations and requires 20 generations without a
gain greater than 0.0001. Small gains accumulate against the last material baseline.
Missing, invalid, or entirely infeasible candidate scores cannot establish stability.
This remains a heuristic, not proof of Pareto convergence or global optimality.
`enable_early_stopping: false` still runs to the configured generation limit.
New run snapshots record the stopping policy and its parameters.

Completed recommendations with shortages or violated constraints now carry an amber
warning on progress and review screens. Completion alone does not establish that a
recommendation is publishable. Existing publication validation remains in force.

HQ remains the fallback origin. The officer editor allows an explicit confirmation
of valid starting coordinates, or clearing both coordinates. Ordinary edits omit
coordinates so they cannot refresh a stale location's server timestamp. Existing
same-day validity rules and recorded-post precedence remain unchanged. No roster
coordinates, officer statuses, or published schedules are rewritten by this release.

## Validation

- 340 frontend tests and 555 backend tests passed.
- Captured HQ case `opt-2fc6f702595544bea387b6478d173a7b`: stopping enabled
  used 50 generations; disabled used 300. Both returned final score 94.1877,
  no shortages, and no constraint violations.
- Captured varied-origin case `opt-c4a648c4f26a4419845f1301ab8bc357`:
  enabled used 127 generations with 35 distinct search scores; disabled used 300
  with 36 distinct scores. Both returned final score 89.972 under the current
  engine and retained the existing 29-post shortage. These are in-memory comparisons
  using identical inputs and seeds, not updates to the historical runs.
- The comparisons are regression evidence for these inputs, not a guarantee that
  every future early stop matches a full search.

## Restore point

Git tag `before-convergence-fixes-2026-10-21` preserves the complete pre-change
source at `dbefd59f25f9a4c2dfa28599221fcc7fd00f4a61`. To undo this release,
revert the scoped convergence-fix commit and redeploy frontend and backend together.
Do not reset the branch or overwrite subsequent unrelated work. The backend deployment
also preserves the original changed files under `/opt/trafficaux/backups/` and can
restore them without database migrations.

The restore point already includes HQ fallback. Returning to an older policy that
accepts undated saved coordinates is a separate change requiring the user's choice;
this release does not enable it. Historical run snapshots remain available for
comparison.
