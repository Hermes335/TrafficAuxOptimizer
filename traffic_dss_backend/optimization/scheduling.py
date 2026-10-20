"""Optimize captured time periods and preserve feasible officer continuity."""
from copy import deepcopy
from datetime import datetime

from core.skills import preferred_skills_for
from .engine import GeneticDeploymentOptimizer, GARunResult
from .matching import match_officers


def plan_periods(bottlenecks, officers=()):
    boundaries = sorted({datetime.fromisoformat(w[key]) for b in bottlenecks
                         for w in b.get("staffing_windows", []) for key in ("start_time", "end_time")})
    if boundaries:
        boundaries = sorted(set(boundaries) | {datetime.fromisoformat(b[key]) for o in officers for b in o.get("time_blocks", [])
            for key in ("start_time", "end_time") if boundaries[0] < datetime.fromisoformat(b[key]) < boundaries[-1]})
    return list(zip(boundaries, boundaries[1:]))


def _continuous_assignments(engine, officers, nodes, proposed, previous, start, wif):
    return match_officers(engine, officers, nodes, proposed, previous, start, wif)


def run_schedule(*, officers, bottlenecks, parameters, weather_impact_factor=1, incidents=None,
                 pois=None, seed=0, progress_callback=None, cancel_check=None):
    bottlenecks = [{**node, "preferred_skills": node.get("preferred_skills", preferred_skills_for(node, incidents or []))}
                   for node in deepcopy(bottlenecks)]
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
            # Match and score from the same period-specific origins and POI-adjusted priorities.
            metric_nodes = deepcopy(nodes)
            if pois:
                engine._apply_poi_boosts(metric_nodes, pois)
            origins = [{**officer, "current_latitude": previous[rank][officer["id"]]["latitude"],
                        "current_longitude": previous[rank][officer["id"]]["longitude"]}
                       if officer["id"] in previous[rank] else officer for officer in available]
            distances = engine._precompute_distance_matrix(origins, metric_nodes)
            metrics = engine._evaluate(chromosome, available, metric_nodes, weather_impact_factor,
                                       engine._clamp_parameters(parameters), engine._compute_incident_boosts(metric_nodes, incidents or []), distances)
            visualization = engine._compute_pareto_visualization(metrics, available, metric_nodes, chromosome, weather_impact_factor)
            for key in ("weather_responsiveness", "resource_balance"):
                total[key] = total.get(key, 0) + visualization[key] * (end-start).total_seconds()/duration_total
            shortages = {b["id"]: b["staffing_target"] - chromosome.count(i) for i, b in enumerate(nodes)
                         if chromosome.count(i) < b["staffing_target"]}
            total["constraints_violated"] |= metrics["constraints_violated"] or bool(shortages)
            for node_id, shortage in shortages.items():
                total["staffing_shortages"][node_id] = max(shortage, total["staffing_shortages"].get(node_id, 0))
            for node in nodes:
                total["staffing_targets"][node["id"]] = max(node["staffing_target"], total["staffing_targets"].get(node["id"], 0))
            for key in ("fitness", "coverage_efficiency", "avg_response_time", "resource_utilization", "staffing_efficiency", "road_priority_coverage", "response_time_score"):
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
    # Re-rank the final feasible schedules, not the period proposals.
    fronts = engine._fast_non_dominated_sort([(None, total) for total in totals])
    ranks = {idx: rank for rank, front in enumerate(fronts) for idx in front}
    ordered = sorted(enumerate(totals), key=lambda row: (row[1]["constraints_violated"], ranks[row[0]], -row[1]["fitness"]))
    pareto = [{**{key: total.get(key, 0) for key in ("fitness", "coverage_efficiency", "avg_response_time",
               "resource_utilization", "road_priority_coverage", "weather_responsiveness", "resource_balance")},
               "coverage": total["coverage_efficiency"],
               "inverse_response_time": max(0, 100-total["avg_response_time"]*2)}
              for idx, total in ordered if ranks[idx] == 0 and not total["constraints_violated"]]
    totals = [total for _, total in ordered]
    for rank, total in enumerate(totals, 1):
        total["rank"] = rank
    return GARunResult(totals[0]["fitness"] if totals else (history[-1] if history else 0), totals, history,
                       "completed", pareto_curve_data=pareto, converged_early=converged)
