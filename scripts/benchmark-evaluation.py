"""Repeatable synthetic scheduling benchmark; no database, broker, or API writes."""
import argparse
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import platform
import statistics
import sys
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "traffic_dss_backend"))
from optimization.scheduling import run_schedule  # noqa: E402


def sample_inputs(officer_count, location_count, periods):
    start = datetime(2099, 1, 1, 6, tzinfo=timezone(timedelta(hours=8)))
    officers = [{"id": i + 1, "badge_number": f"BENCH-{i + 1}",
        "current_latitude": 10.70 + (i % 10) * .003,
        "current_longitude": 122.54 + (i % 8) * .003,
        "time_blocks": []} for i in range(officer_count)]
    nodes = []
    for i in range(location_count):
        boundaries = [start + timedelta(hours=8 * p / periods) for p in range(periods + 1)]
        windows = [{"start_time": left.isoformat(), "end_time": right.isoformat(),
                    "required": 2 + int(p == 1 and i % 3 == 0), "reason": "Synthetic review scenario"}
                   for p, (left, right) in enumerate(zip(boundaries, boundaries[1:]))]
        nodes.append({"id": f"BENCH-{i + 1}", "name": f"Test location {i + 1}",
            "latitude": 10.70 + (i % 6) * .006, "longitude": 122.54 + (i // 6) * .006,
            "tsi": .25 + (i % 6) * .1, "road_priority_weight": 1 + (i % 3) * .25,
            "min_officers_required": 2, "staffing_target": 2, "max_officers_allowed": 5,
            "staffing_windows": windows})
    return officers, nodes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--population", type=int, default=200)
    parser.add_argument("--generations", type=int, default=300)
    parser.add_argument("--output", type=Path, default=ROOT / "evaluation_form" / "validation" / "optimization-benchmark.json")
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error("--repeats must be positive")
    params = {"population_size": args.population, "generations": args.generations,
              "mutation_rate": .1, "crossover_rate": .8, "elitism_count": 5,
              "tsi_weight": .35, "wif_weight": .25, "rpw_weight": .25,
              "resource_utilization_weight": .15}
    report = {"scope": "Local synthetic timed scheduling; no database or live data",
        "python": platform.python_version(), "platform": platform.platform(),
        "logical_cpus": os.cpu_count(), "parameters": params, "repeats": args.repeats,
        "queue_wait_seconds": None, "limitations": "Excludes broker queue, database persistence, network and hosted concurrency. Three repeats describe this machine only.",
        "scenarios": []}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for name, roster_size, locations, periods in [("small", 25, 10, 1),
            ("typical", 60, 22, 1), ("field_sized_timed", 161, 30, 3)]:
        officers, nodes = sample_inputs(roster_size, locations, periods)
        scenario = {"name": name, "officers": roster_size, "locations": locations,
                    "periods": periods, "trials": []}
        report["scenarios"].append(scenario)
        for trial in range(args.repeats):
            seed = 100 + trial
            print(f"Starting {name}, seed {seed}", flush=True)
            began = perf_counter()
            result = run_schedule(officers=deepcopy(officers), bottlenecks=deepcopy(nodes),
                parameters=params.copy(), seed=seed)
            elapsed = perf_counter() - began
            if result.status != "completed":
                raise RuntimeError(f"Benchmark scenario did not complete: {name}: {result.status}")
            row = {"seed": seed, "seconds": round(elapsed, 4), "status": result.status,
                   "executed_generations": len(result.generation_fitness),
                   "converged_early": result.converged_early,
                   "assignments": len(result.top_solutions[0]["assignments"])}
            scenario["trials"].append(row)
            print(json.dumps({"scenario": name, **row}), flush=True)
            args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        seconds = [t["seconds"] for t in scenario["trials"]]
        scenario["median_seconds"] = round(statistics.median(seconds), 4)
        scenario["slowest_seconds"] = max(seconds)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {args.output}")


if __name__ == "__main__":
    main()
