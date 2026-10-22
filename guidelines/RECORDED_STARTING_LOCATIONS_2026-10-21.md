# Restore recorded starting locations — 2026-10-21

At the user's request, automatic HQ starting positions and the daily expiry of
saved coordinates are removed. The origin policy again matches the recorded-location
behavior used by `opt-538e109b9d974e9ebc8acab3a688f5db` and
`opt-c4a648c4f26a4419845f1301ab8bc357`:

1. A recent recorded post or committed assignment prefix takes priority.
2. Otherwise, use the officer's valid saved coordinates until updated or cleared.
3. If no coordinates are available, leave the position unknown and estimate a
   3 km travel distance, as those historical runs did.

No default geographic position is invented. Both scalar and cached travel scoring
use the same distance policy. Run snapshots and CSV exports record the restored
policy explicitly. Historical snapshots retain their original assumptions, including
HQ where it was used at the time. The corrected chart arithmetic, objective checks,
constraint warnings, and current scheduling validation remain in place.

The Azure roster had no saved coordinates, which would have left every officer
using the same 3 km distance estimate after removing HQ. The user separately approved
copying valid local coordinates to the 316 officers with matching badges and empty
Azure coordinates. This source contains 43 distinct positions; 203 matching officers
are currently eligible. The import preserves original observation timestamps
(all absent in this source), all other officer fields, and published schedules.
These stored planning locations are not labelled as live GPS observations.

Validation passed 556 backend tests and 342 frontend tests, plus TypeScript and the
web build. In-memory replays preserved the 12 distinct origins from each reference
run and produced real search improvements: 88.3233 to 88.9548 (40 distinct scores)
and 89.6855 to 89.9720 (35 distinct scores). These checks do not overwrite the saved
runs or imply that every new roster will produce an increasing curve.

Source version `21e7b620` preserves the preceding HQ policy. Reverting this scoped
change restores that code without overwriting other work. Backend deployment and
coordinate import each keep separate backups under `/opt/trafficaux/backups/`.
Restoring source alone does not remove approved imported coordinates; data rollback
must use the coordinate import's original-values backup and verify that no later
coordinate edits would be overwritten.
