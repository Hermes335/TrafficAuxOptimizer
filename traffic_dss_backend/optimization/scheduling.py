"""Optimize captured time periods and preserve feasible officer continuity."""
from copy import deepcopy
from datetime import datetime
from math import ceil

from .engine import GeneticDeploymentOptimizer, GARunResult


def plan_periods(bottlenecks, officers=()):
    boundaries = sorted({datetime.fromisoformat(w[key]) for b in bottlenecks
                         for w in b.get("staffing_windows", []) for key in ("start_time", "end_time")})
    if boundaries:
        boundaries = sorted(set(boundaries) | {datetime.fromisoformat(b[key]) for o in officers for b in o.get("time_blocks", [])
            for key in ("start_time", "end_time") if boundaries[0] < datetime.fromisoformat(b[key]) < boundaries[-1]})
    return list(zip(boundaries, boundaries[1:]))


def _continuous_assignments(engine, officers, nodes, proposed, previous, start, wif):
    """Match desired posts to officers, keeping continuing posts first.

    A move after a previous post needs an unassigned gap at least as long as the
    existing travel model estimates. Initially officers may be prepositioned.
    """
    by_node = {b["id"]: b for b in nodes}
    by_officer = {o["id"]: o for o in officers}
    slots = [a["bottleneck_id"] for a in proposed]
    preferred = {(a["officer_id"], a["bottleneck_id"]) for a in proposed}
    options = []
    for node_id in slots:
        node = by_node[node_id]
        eligible = []
        for officer in officers:
            prior = previous.get(officer["id"])
            origin = officer if not prior else {**officer, "current_latitude": prior["latitude"], "current_longitude": prior["longitude"]}
            minutes = engine._distance_km(origin, node) / max(8, 28 * (1 - float(node.get("tsi", 0)))) * 60 * wif
            continuing = bool(prior and prior["node_id"] == node_id)
            if prior and not continuing and (start - prior["end"]).total_seconds() < ceil(minutes * 60):
                continue
            eligible.append((not continuing, (officer["id"], node_id) not in preferred, minutes, officer["id"]))
        options.append([row[-1] for row in sorted(eligible)])
    matched = {}

    def match(slot, visited):
        for officer_id in options[slot]:
            if officer_id in visited:
                continue
            visited.add(officer_id)
            if officer_id not in matched or match(matched[officer_id], visited):
                matched[officer_id] = slot
                return True
        return False

    for slot in sorted(range(len(slots)), key=lambda i: len(options[i])):
        match(slot, set())
    return [{"officer_id": officer_id, "badge_number": by_officer[officer_id].get("badge_number"),
             "bottleneck_id": slots[slot], "bottleneck_name": by_node[slots[slot]].get("name")}
            for officer_id, slot in sorted(matched.items())]


def run_schedule(*, officers, bottlenecks, parameters, weather_impact_factor=1, incidents=None,
                 pois=None, seed=0, progress_callback=None, cancel_check=None):
    periods = plan_periods(bottlenecks, officers)
    if not periods:
        return GeneticDeploymentOptimizer().run(officers=officers, bottlenecks=bottlenecks, parameters=parameters,
            weather_impact_factor=weather_impact_factor, incidents=incidents, pois=pois, seed=seed,
            progress_callback=progress_callback, cancel_check=cancel_check)
    engine = GeneticDeploymentOptimizer(seed=seed)
    history, totals, previous = [], [], [{}, {}, {}]
    generation_limit = engine._clamp_parameters(parameters)["generations"] * len(periods)
    duration_total = (periods[-1][1] - periods[0][0]).total_seconds()
    converged = False
    for period_index, (start, end) in enumerate(periods):
        available = [o for o in officers if not any(datetime.fromisoformat(b["start_time"]) < end and datetime.fromisoformat(b["end_time"]) > start for b in o.get("time_blocks", []))]
        if cancel_check and cancel_check():
            return GARunResult(0, [], history, "cancelled")
        nodes = deepcopy(bottlenecks)
        requirements = []
        for node in nodes:
            window = next(w for w in node["staffing_windows"]
                          if datetime.fromisoformat(w["start_time"]) <= start < datetime.fromisoformat(w["end_time"]))
            node["min_officers_required"] = node["staffing_target"] = window["required"]
            requirements.append({"bottleneck_id": node["id"], "required": window["required"], "reason": window["reason"]})
        prior_count = len(history)

        def progress(generation, _limit, fitness):
            if progress_callback:
                progress_callback(prior_count + generation, generation_limit, fitness)

        result = engine.run(officers=available, bottlenecks=nodes, parameters=parameters,
            weather_impact_factor=weather_impact_factor, incidents=incidents, pois=pois,
            seed=seed + period_index, progress_callback=progress, cancel_check=cancel_check)
        if not available and result.status == "failed":
            # Keep a visible shortage for periods where every officer is reserved.
            result = GARunResult(0, [{"assignments": []} for _ in range(3)], [], "completed")
        history.extend(result.generation_fitness)
        converged |= result.converged_early
        if result.status != "completed":
            return GARunResult(result.best_fitness, [], history, result.status)
        for rank, solution in enumerate(result.top_solutions):
            while len(totals) <= rank:
                totals.append({"rank": rank + 1, "assignments": [], "time_periods": [], "staffing_targets": {},
                               "staffing_shortages": {}, "constraints_violated": False, "reserve_officers": len(officers)})
            total = totals[rank]
            assignments = _continuous_assignments(engine, available, nodes, solution["assignments"], previous[rank], start, weather_impact_factor)
            node_index = {b["id"]: idx for idx, b in enumerate(nodes)}
            officer_nodes = {a["officer_id"]: node_index[a["bottleneck_id"]] for a in assignments}
            chromosome = [officer_nodes.get(o["id"], -1) for o in available]
            metrics = engine._evaluate(chromosome, available, nodes, weather_impact_factor,
                                       engine._clamp_parameters(parameters), engine._compute_incident_boosts(nodes, incidents or []))
            shortages = {b["id"]: b["staffing_target"] - chromosome.count(i) for i, b in enumerate(nodes)
                         if chromosome.count(i) < b["staffing_target"]}
            total["constraints_violated"] |= metrics["constraints_violated"] or bool(shortages)
            for node_id, shortage in shortages.items():
                total["staffing_shortages"][node_id] = max(shortage, total["staffing_shortages"].get(node_id, 0))
            for node in nodes:
                total["staffing_targets"][node["id"]] = max(node["staffing_target"], total["staffing_targets"].get(node["id"], 0))
            for key in ("fitness", "coverage_efficiency", "avg_response_time", "resource_utilization", "staffing_efficiency", "road_priority_coverage"):
                total[key] = total.get(key, 0) + metrics[key] * (end - start).total_seconds() / duration_total
            reserve = len(available) - len(assignments)
            total["reserve_officers"] = min(total["reserve_officers"], reserve)
            total["time_periods"].append({"start_time": start.isoformat(), "end_time": end.isoformat(),
                "requirements": requirements, "assigned_officers": len(assignments), "reserve_officers": reserve,
                "staffing_shortages": shortages})
            for assignment in assignments:
                node = nodes[node_index[assignment["bottleneck_id"]]]
                prior_row = next((a for a in reversed(total["assignments"]) if a["officer_id"] == assignment["officer_id"]), None)
                if prior_row and prior_row["bottleneck_id"] == assignment["bottleneck_id"] and prior_row["end_time"] == start.isoformat():
                    prior_row["end_time"] = end.isoformat()
                else:
                    total["assignments"].append({**assignment, "start_time": start.isoformat(), "end_time": end.isoformat()})
                previous[rank][assignment["officer_id"]] = {"node_id": node["id"], "latitude": node["latitude"],
                                                          "longitude": node["longitude"], "end": end}
    return GARunResult(totals[0]["fitness"] if totals else (history[-1] if history else 0), totals, history, "completed", converged_early=converged)
