# TrafficOffOptimizer evaluation verification

## Runtime

Install `traffic_dss_backend/requirements.txt` into the root `.venv`, then run
`npm run check:backend`. The check reads the declared Django range and rejects
an incompatible selected interpreter before a service starts. Backend, Celery
worker, scheduler, Electron backend, and the demo launcher share this check.
`TRAFFIC_PYTHON` selects an alternate interpreter for all those launchers.

Restart existing services after upgrading the environment. Run migrations as a
separate release step after a database backup; verification uses isolated test
settings and does not migrate the operational database.

## Regression checks

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- From `traffic_dss_backend`: run the selected Python with
  `-m pytest --ds=config.test_settings -p no:cacheprovider -q`.
- `npm run test:browser` after building. Browser API writes are fixtures.

Confirmation coverage includes pending-state visibility, duplicate-click and
Escape protection, failed-action retry, typed confirmation, failed deletion,
and a successful schedule clear followed by a display-refresh failure. A failed
refresh after a completed clear does not offer to execute the clear again.

The browser script uses the current editor labels, inline field errors, and
publication-warning popover. Set `BROWSER_DIST` to test an alternate build and
`BROWSER_ARTIFACTS` to select an output directory.

## Optimization timing

Run `npm run benchmark:evaluation`. The default benchmark uses three seeds per
scenario, population 200 and a 300-generation limit per staffing period:

| Scenario | Officers | Locations | Staffing periods |
|---|---:|---:|---:|
| Small | 25 | 10 | 1 |
| Typical | 60 | 22 | 1 |
| Field-sized timed | 161 | 30 | 3 |

The larger synthetic scenario follows the field-sized roster coverage used by
existing engine tests; it is not a claim about current live staffing. Reports
include each run's duration, executed generations, early-stop flag and assignment
count, with median and slowest durations. Optional arguments include
`--repeats`, `--population`, `--generations`, and `--output`.

For quiet timing runs, finish builds and regression tests first. The benchmark
calls the same timed scheduling function used by the optimization task, with
synthetic input and no database or broker. Queue wait, database persistence,
network delay, traffic outcomes and hosted concurrent-user performance require
separate staging measurements. The report leaves queue wait unmeasured.

## Cold-load profile

Set `BROWSER_PROFILE_LOAD=1` when running `scripts/browser-review.cjs`. The first
dashboard navigation uses a cold browser cache, 150 ms emulated latency and
1.6 Mbps download throughput. It records first contentful paint, observed map
readiness and asset transfers to `load-profile.json`, then restores normal
network settings for the remaining regression checks. It also checks that
anonymous login does not request the MapLibre JavaScript engine.

In profiling mode, the local fixture server uses gzip compression and immutable
caching for generated assets. Encoded and decoded byte counts are recorded so
the cost of the large map library can be assessed. These measurements describe
that test harness; they do not establish Vercel compression, CDN-cache
behavior, production WebSocket performance or live map-provider latency. Verify
those on the hosted evaluation URL. The MapLibre chunk-size warning remains
visible rather than being hidden by changing the build warning threshold.
