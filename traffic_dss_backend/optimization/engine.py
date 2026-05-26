from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Callable
from random import Random, randint
from math import inf

from geopy.distance import geodesic


@dataclass
class GARunResult:
    best_fitness: float
    top_solutions: list[dict]
    generation_fitness: list[float]
    status: str
    pareto_curve_data: list[dict] = field(default_factory=list)
    converged_early: bool = False


SCENARIO_PRESETS = {
    "typhoon": {
        "tsi_weight": 0.30,
        "wif_weight": 0.50,
        "rpw_weight": 0.15,
        "resource_utilization_weight": 0.05,
    },
    "special_event": {
        "tsi_weight": 0.50,
        "wif_weight": 0.15,
        "rpw_weight": 0.25,
        "resource_utilization_weight": 0.10,
    },
    "balanced": {
        "tsi_weight": 0.25,
        "wif_weight": 0.25,
        "rpw_weight": 0.25,
        "resource_utilization_weight": 0.25,
    },
}


class GeneticDeploymentOptimizer:
    """NSGA-II multi-objective optimizer for officer-to-bottleneck assignments."""

    def __init__(self, seed: int | None = None):
        if seed is None:
            seed = randint(0, 2**31 - 1)
        self.rng = Random(seed)
        self.seed = seed

    @staticmethod
    def _clamp_parameters(parameters: dict) -> dict:
        scenario = parameters.get("scenario", "")
        if scenario and scenario in SCENARIO_PRESETS:
            preset = SCENARIO_PRESETS[scenario]
            tsi_weight = preset["tsi_weight"]
            wif_weight = preset["wif_weight"]
            rpw_weight = preset["rpw_weight"]
            resource_utilization_weight = preset["resource_utilization_weight"]
        else:
            tsi_weight = max(0.0, min(1.0, float(parameters.get("tsi_weight", 0.35))))
            wif_weight = max(0.0, min(1.0, float(parameters.get("wif_weight", 0.25))))
            rpw_weight = max(0.0, min(1.0, float(parameters.get("rpw_weight", 0.25))))
            resource_utilization_weight = max(0.0, min(1.0, float(parameters.get("resource_utilization_weight", 0.15))))

        total_weight = tsi_weight + wif_weight + rpw_weight + resource_utilization_weight
        if total_weight <= 0:
            raise ValueError("At least one optimization weight must be greater than zero.")

        return {
            "population_size": max(50, min(500, int(parameters.get("population_size", 200)))),
            "generations": max(50, min(1000, int(parameters.get("generations", 300)))),
            "mutation_rate": max(0.01, min(0.30, float(parameters.get("mutation_rate", 0.10)))),
            "crossover_rate": max(0.50, min(0.95, float(parameters.get("crossover_rate", 0.80)))),
            "elitism_count": max(1, min(20, int(parameters.get("elitism_count", 5)))),
            "tsi_weight": tsi_weight / total_weight,
            "wif_weight": wif_weight / total_weight,
            "rpw_weight": rpw_weight / total_weight,
            "resource_utilization_weight": resource_utilization_weight / total_weight,
            "tournament_size": 3,
            "enable_early_stopping": bool(parameters.get("enable_early_stopping", True)),
            "scenario": scenario,
        }

    def _distance_km(self, officer: dict, bottleneck: dict) -> float:
        lat = officer.get("current_latitude")
        lng = officer.get("current_longitude")
        if lat is None or lng is None:
            return 3.0
        return geodesic((lat, lng), (bottleneck["latitude"], bottleneck["longitude"])).km

    @staticmethod
    def _compute_incident_boosts(
        bottlenecks: list[dict],
        incidents: list[dict],
        radius_km: float = 0.5,
    ) -> dict[int, dict]:
        """For each bottleneck, compute priority boosts from nearby incidents.
        Incidents increase road_priority_weight so the optimizer assigns more officers there."""
        boosts: dict[int, dict] = {}
        severity_multiplier = {"critical": 3.0, "major": 2.0, "minor": 1.0}

        for b_idx, bn in enumerate(bottlenecks):
            priority_boost = 0.0
            nearby_count = 0

            for inc in incidents:
                inc_lat = inc.get("latitude")
                inc_lng = inc.get("longitude")
                if inc_lat is None or inc_lng is None:
                    continue
                dist = geodesic((inc_lat, inc_lng), (bn["latitude"], bn["longitude"])).km
                if dist <= radius_km:
                    sev = inc.get("severity", "minor")
                    mult = severity_multiplier.get(sev, 1.0)
                    # Closer incidents have stronger effect
                    proximity = 1.0 - (dist / radius_km)
                    priority_boost += mult * proximity
                    nearby_count += 1

            if nearby_count > 0:
                boosts[b_idx] = {
                    "priority_boost": priority_boost,
                    "incident_count": nearby_count,
                }

        return boosts

    def _evaluate_objectives(
        self,
        chromosome: list[int],
        officers: list[dict],
        bottlenecks: list[dict],
        weather_impact_factor: float,
        incident_boosts: dict[int, dict] | None = None,
    ) -> dict:
        """Evaluate 4 independent objectives (no weighting). Returns raw scores."""
        assigned_indices = [idx for idx in chromosome if 0 <= idx < len(bottlenecks)]
        assigned_count = len(assigned_indices)
        covered = set(assigned_indices)

        coverage_efficiency = (len(covered) / max(1, len(bottlenecks))) * 100
        resource_utilization = (assigned_count / max(1, len(officers))) * 100

        response_minutes = []
        assigned_priority_weight = 0.0
        for officer_idx, bottleneck_idx in enumerate(chromosome):
            if bottleneck_idx < 0 or bottleneck_idx >= len(bottlenecks):
                continue
            officer = officers[officer_idx]
            bottleneck = bottlenecks[bottleneck_idx]

            # Apply incident boost to priority (not TSI - boosting TSI penalizes assignments)
            effective_tsi = float(bottleneck.get("tsi", 0.0))
            effective_priority = max(0.0, float(bottleneck.get("road_priority_weight", 1.0)))
            if incident_boosts and bottleneck_idx in incident_boosts:
                effective_priority += incident_boosts[bottleneck_idx]["priority_boost"]

            assigned_priority_weight += effective_priority
            speed_kmh = max(8.0, 28.0 * (1.0 - effective_tsi))
            travel_minutes = (self._distance_km(officer, bottleneck) / speed_kmh) * 60.0
            response_minutes.append(travel_minutes * weather_impact_factor)

        priority_denominator = sum(max(0.0, float(item.get("road_priority_weight", 1.0))) for item in bottlenecks)
        # Add incident priority boosts to denominator
        if incident_boosts:
            for b_idx, boost in incident_boosts.items():
                priority_denominator += boost["priority_boost"]
        road_priority_coverage = 100.0 if priority_denominator <= 0 else min(100.0, (assigned_priority_weight / priority_denominator) * 100.0)
        avg_response_time = sum(response_minutes) / max(1, len(response_minutes))
        response_time_score = max(0.0, 100.0 - (avg_response_time * 2.0))

        # Incident coverage: bonus for assigning officers to bottlenecks near incidents
        incident_coverage_score = 0.0
        if incident_boosts:
            incident_bottlenecks = set(incident_boosts.keys())
            incident_covered = incident_bottlenecks & covered
            if incident_bottlenecks:
                incident_coverage_score = (len(incident_covered) / len(incident_bottlenecks)) * 100.0

        return {
            "coverage_efficiency": round(coverage_efficiency, 3),
            "response_time_score": round(response_time_score, 3),
            "road_priority_coverage": round(road_priority_coverage, 3),
            "resource_utilization": round(resource_utilization, 3),
            "avg_response_time": round(avg_response_time, 3),
            "incident_coverage_score": round(incident_coverage_score, 3),
        }

    def _check_constraints(
        self,
        chromosome: list[int],
        officers: list[dict],
        bottlenecks: list[dict],
    ) -> tuple[bool, list[str]]:
        """Check hard constraints. Returns (violated, list_of_violation_reasons)."""
        violations = []

        # Constraint 1: Minimum coverage
        # If officers < bottlenecks, can't reach 60% — require at least officers/bottlenecks ratio
        # If officers >= bottlenecks, require 60% minimum
        covered = set(idx for idx in chromosome if 0 <= idx < len(bottlenecks))
        coverage_ratio = len(covered) / max(1, len(bottlenecks))
        max_possible_coverage = len(officers) / max(1, len(bottlenecks))
        min_coverage = min(0.60, max_possible_coverage * 0.9)
        if coverage_ratio < min_coverage:
            violations.append(f"coverage_below_{min_coverage:.0%}:{coverage_ratio:.2f}")

        # Constraint 2: No severe over-assignment
        # Allow up to 3x the fair share (total_officers / total_bottlenecks)
        # This accounts for the reality that officer count may far exceed bottleneck count
        fair_share = len(officers) / max(1, len(bottlenecks))
        max_allowed = max(4, int(fair_share * 3))

        bottleneck_counts: dict[int, int] = {}
        for idx in chromosome:
            if 0 <= idx < len(bottlenecks):
                bottleneck_counts[idx] = bottleneck_counts.get(idx, 0) + 1
        for b_idx, count in bottleneck_counts.items():
            if count > max_allowed:
                violations.append(f"over_assigned:{bottlenecks[b_idx].get('id', b_idx)}:{count}>{max_allowed}")

        return (len(violations) > 0, violations)

    def _evaluate(
        self,
        chromosome: list[int],
        officers: list[dict],
        bottlenecks: list[dict],
        weather_impact_factor: float,
        weights: dict,
        incident_boosts: dict[int, dict] | None = None,
    ) -> dict:
        """Full evaluation: 4 objectives + weighted fitness + constraint penalty."""
        objectives = self._evaluate_objectives(chromosome, officers, bottlenecks, weather_impact_factor, incident_boosts)
        constraints_violated, violations = self._check_constraints(chromosome, officers, bottlenecks)

        fitness = (
            (objectives["coverage_efficiency"] * weights["tsi_weight"])
            + (objectives["response_time_score"] * weights["wif_weight"])
            + (objectives["road_priority_coverage"] * weights["rpw_weight"])
            + (objectives["resource_utilization"] * weights["resource_utilization_weight"])
        )

        # Incident coverage bonus: reward covering bottlenecks near active incidents
        # Uses a fixed 15% weight when incidents are present
        if incident_boosts and objectives.get("incident_coverage_score", 0) > 0:
            fitness += objectives["incident_coverage_score"] * 0.15

        # Hard constraint penalty: multiply by 1e-6
        if constraints_violated:
            fitness *= 1e-6

        return {
            "fitness": round(fitness, 4),
            "coverage_efficiency": objectives["coverage_efficiency"],
            "avg_response_time": objectives["avg_response_time"],
            "resource_utilization": objectives["resource_utilization"],
            "road_priority_coverage": objectives["road_priority_coverage"],
            "response_time_score": objectives["response_time_score"],
            "constraints_violated": constraints_violated,
            "violations": violations,
        }

    # ─── NSGA-II: Non-dominated sorting ───────────────────────────────────

    @staticmethod
    def _dominates(a: dict, b: dict) -> bool:
        """Check if solution a dominates solution b (all objectives >=, at least one >)."""
        objs = ["coverage_efficiency", "response_time_score", "road_priority_coverage", "resource_utilization"]
        at_least_one_better = False
        for obj in objs:
            if a[obj] < b[obj]:
                return False
            if a[obj] > b[obj]:
                at_least_one_better = True
        return at_least_one_better

    def _fast_non_dominated_sort(self, scored: list[tuple[list[int], dict]]) -> list[list[int]]:
        """NSGA-II fast non-dominated sorting. Returns list of fronts."""
        n = len(scored)
        domination_count = [0] * n
        dominated_set = [[] for _ in range(n)]
        fronts = [[]]

        for i in range(n):
            for j in range(i + 1, n):
                if self._dominates(scored[i][1], scored[j][1]):
                    dominated_set[i].append(j)
                    domination_count[j] += 1
                elif self._dominates(scored[j][1], scored[i][1]):
                    dominated_set[j].append(i)
                    domination_count[i] += 1

        for i in range(n):
            if domination_count[i] == 0:
                fronts[0].append(i)

        current_front = 0
        while fronts[current_front]:
            next_front = []
            for i in fronts[current_front]:
                for j in dominated_set[i]:
                    domination_count[j] -= 1
                    if domination_count[j] == 0:
                        next_front.append(j)
            current_front += 1
            if next_front:
                fronts.append(next_front)
            else:
                break

        return fronts

    @staticmethod
    def _crowding_distance(scored: list[tuple[list[int], dict]], front: list[int]) -> dict[int, float]:
        """Compute crowding distance for solutions in a front."""
        distances = {i: 0.0 for i in front}
        if len(front) <= 2:
            for i in front:
                distances[i] = inf
            return distances

        objs = ["coverage_efficiency", "response_time_score", "road_priority_coverage", "resource_utilization"]
        for obj in objs:
            sorted_front = sorted(front, key=lambda i: scored[i][1][obj])
            distances[sorted_front[0]] = inf
            distances[sorted_front[-1]] = inf
            obj_range = scored[sorted_front[-1]][1][obj] - scored[sorted_front[0]][1][obj]
            if obj_range <= 0:
                continue
            for k in range(1, len(sorted_front) - 1):
                distances[sorted_front[k]] += (
                    scored[sorted_front[k + 1]][1][obj] - scored[sorted_front[k - 1]][1][obj]
                ) / obj_range

        return distances

    def _nsga2_select(self, scored: list[tuple[list[int], dict]], tournament_size: int) -> list[int]:
        """NSGA-II tournament selection: rank first, then crowding distance."""
        contenders = self.rng.sample(scored, k=min(tournament_size, len(scored)))

        # Compute fronts for contenders only
        contender_indices = list(range(len(contenders)))
        # Simple pairwise dominance among contenders
        best = contenders[0]
        best_rank = 0
        best_crowding = 0.0

        for c in contenders:
            c_dominates_best = self._dominates(c[1], best[1])
            best_dominates_c = self._dominates(best[1], c[1])
            if c_dominates_best and not best_dominates_c:
                best = c
            elif not c_dominates_best and not best_dominates_c:
                # Same rank - use fitness as tiebreaker (crowding proxy)
                if c[1]["fitness"] > best[1]["fitness"]:
                    best = c

        return best[0][:]

    # ─── Hypervolume (2D approximation) ───────────────────────────────────

    @staticmethod
    def _compute_hypervolume_2d(pareto_front: list[dict], ref_point: tuple[float, float] = (0.0, 0.0)) -> float:
        """Compute 2D hypervolume for Pareto front (coverage_efficiency, response_time_score)."""
        if not pareto_front:
            return 0.0

        # Sort by first objective descending
        points = sorted(
            [(p["coverage_efficiency"], p["response_time_score"]) for p in pareto_front],
            key=lambda x: x[0],
            reverse=True,
        )

        hv = 0.0
        prev_y = ref_point[1]
        for x, y in points:
            if y > prev_y:
                hv += x * (y - prev_y)
                prev_y = y
        return hv

    # ─── Pareto visualization data ────────────────────────────────────────

    @staticmethod
    def _compute_pareto_visualization(
        solution: dict,
        officers: list[dict],
        bottlenecks: list[dict],
        chromosome: list[int],
        weather_impact_factor: float,
    ) -> dict:
        """Compute bubble plot metadata for a solution."""
        coverage = solution["coverage_efficiency"]
        inv_response = max(0, 100 - solution["avg_response_time"] * 2)

        # Weather responsiveness: % of officers at weather-affected bottlenecks (WIF > 1.0)
        weather_affected = 0
        total_assigned = 0
        for officer_idx, bottleneck_idx in enumerate(chromosome):
            if 0 <= bottleneck_idx < len(bottlenecks):
                total_assigned += 1
                bn = bottlenecks[bottleneck_idx]
                if float(bn.get("tsi", 0.0)) > 0.3:
                    weather_affected += 1
        weather_responsiveness = (weather_affected / max(1, total_assigned)) * 100

        # Resource balance: inverse of coefficient of variation of bottleneck assignments
        from statistics import stdev, mean
        bottleneck_counts: dict[int, int] = {}
        for idx in chromosome:
            if 0 <= idx < len(bottlenecks):
                bottleneck_counts[idx] = bottleneck_counts.get(idx, 0) + 1
        counts = list(bottleneck_counts.values()) if bottleneck_counts else [0]
        avg_count = mean(counts) if counts else 0
        cv = (stdev(counts) / max(avg_count, 0.001)) if len(counts) > 1 else 0
        resource_balance = max(0, min(100, 100 / (1 + cv)))

        return {
            "coverage": round(coverage, 1),
            "inverse_response_time": round(inv_response, 1),
            "weather_responsiveness": round(weather_responsiveness, 1),
            "resource_balance": round(resource_balance, 1),
        }

    # ─── Population initialization ────────────────────────────────────────

    def _init_population(self, population_size: int, officer_count: int, bottleneck_count: int) -> list[list[int]]:
        """Initialize population with feasibility-checked chromosomes.
        Ensures minimum coverage (each bottleneck gets at least one officer if possible)
        before distributing remaining officers randomly."""
        population = []
        min_coverage_target = min(bottleneck_count, officer_count)

        for _ in range(population_size):
            chromosome = []

            # Phase 1: Assign one officer to each bottleneck (ensures coverage)
            bottleneck_order = list(range(bottleneck_count))
            self.rng.shuffle(bottleneck_order)
            for i in range(min(min_coverage_target, officer_count)):
                chromosome.append(bottleneck_order[i % bottleneck_count])

            # Phase 2: Distribute remaining officers randomly
            for _ in range(officer_count - min_coverage_target):
                chromosome.append(self.rng.randrange(0, bottleneck_count))

            # Shuffle so the coverage officers aren't always first
            self.rng.shuffle(chromosome)
            population.append(chromosome)

        return population

    # ─── Genetic operators ────────────────────────────────────────────────

    def _crossover(self, p1: list[int], p2: list[int], crossover_rate: float) -> tuple[list[int], list[int]]:
        if len(p1) < 2 or self.rng.random() > crossover_rate:
            return p1[:], p2[:]
        a = self.rng.randint(0, len(p1) - 2)
        b = self.rng.randint(a + 1, len(p1) - 1)
        c1 = p1[:a] + p2[a:b] + p1[b:]
        c2 = p2[:a] + p1[a:b] + p2[b:]
        return c1, c2

    def _mutate(self, chromosome: list[int], bottleneck_count: int, mutation_rate: float):
        if self.rng.random() > mutation_rate or len(chromosome) < 2:
            return
        i, j = self.rng.sample(range(len(chromosome)), 2)
        chromosome[i], chromosome[j] = chromosome[j], chromosome[i]
        if self.rng.random() < mutation_rate:
            chromosome[self.rng.randrange(0, len(chromosome))] = self.rng.randrange(0, bottleneck_count)

    def _repair_coverage(self, chromosome: list[int], bottleneck_count: int):
        """Repair operator: ensure minimum coverage after crossover/mutation.
        If any bottleneck is uncovered, reassign one officer from an over-assigned bottleneck."""
        covered = set(chromosome)
        uncovered = [b for b in range(bottleneck_count) if b not in covered]

        if not uncovered:
            return  # All bottlenecks covered

        # Build bottleneck -> officers mapping
        bottleneck_officers: dict[int, list[int]] = {}
        for officer_idx, bn in enumerate(chromosome):
            bottleneck_officers.setdefault(bn, []).append(officer_idx)

        # Reassign officers from over-assigned bottlenecks to uncovered ones
        for bottleneck_idx in uncovered:
            over_assigned = [bn for bn, officers in bottleneck_officers.items() if len(officers) >= 2]
            if not over_assigned:
                break  # No spare officers available

            donor_bn = self.rng.choice(over_assigned)
            donor_officer = self.rng.choice(bottleneck_officers[donor_bn])
            chromosome[donor_officer] = bottleneck_idx

            # Update tracking
            bottleneck_officers[donor_bn].remove(donor_officer)
            bottleneck_officers[bottleneck_idx] = [donor_officer]

    # ─── Main run loop ────────────────────────────────────────────────────

    def run(
        self,
        officers: list[dict],
        bottlenecks: list[dict],
        parameters: dict,
        weather_impact_factor: float = 1.0,
        incidents: list[dict] | None = None,
        seed: int | None = None,
        cancel_check: Callable[[], bool] | None = None,
        progress_callback: Callable[[int, int, float], None] | None = None,
    ) -> GARunResult:
        if seed is not None:
            self.rng = Random(seed)
        if not officers or not bottlenecks:
            return GARunResult(best_fitness=0.0, top_solutions=[], generation_fitness=[], status="failed")

        config = self._clamp_parameters(parameters)

        # Pre-compute incident boosts for each bottleneck
        incident_boosts = self._compute_incident_boosts(bottlenecks, incidents or []) if incidents else {}
        pop = self._init_population(config["population_size"], len(officers), len(bottlenecks))
        generation_fitness: list[float] = []
        hypervolume_history: list[float] = []
        no_improvement_count = 0

        for generation in range(config["generations"]):
            if cancel_check and cancel_check():
                return GARunResult(
                    best_fitness=generation_fitness[-1] if generation_fitness else 0.0,
                    top_solutions=[],
                    generation_fitness=[round(item, 4) for item in generation_fitness],
                    status="cancelled",
                )

            # Evaluate all individuals
            scored = [
                (chromosome, self._evaluate(chromosome, officers, bottlenecks, weather_impact_factor, config, incident_boosts))
                for chromosome in pop
            ]

            # NSGA-II non-dominated sorting
            fronts = self._fast_non_dominated_sort(scored)

            # Compute crowding distance for each front
            crowding = {}
            for front in fronts:
                cd = self._crowding_distance(scored, front)
                crowding.update(cd)

            # Assign rank to each individual
            rank_map = {}
            for rank, front in enumerate(fronts):
                for idx in front:
                    rank_map[idx] = rank

            # Pre-compute sort keys: constraint-violated always last, then rank, crowding, fitness
            scored_with_keys = [
                (1 if s[1]["constraints_violated"] else 0, rank_map.get(i, 999), -crowding.get(i, 0.0), -s[1]["fitness"], s)
                for i, s in enumerate(scored)
            ]
            scored_with_keys.sort(key=lambda x: (x[0], x[1], x[2], x[3]))
            scored = [item[4] for item in scored_with_keys]

            best_score = scored[0][1]["fitness"]
            generation_fitness.append(best_score)

            # Convergence detection via hypervolume
            if config["enable_early_stopping"]:
                pareto_front = [s[1] for s in scored if not s[1]["constraints_violated"]][:10]
                hv = self._compute_hypervolume_2d(pareto_front)
                hypervolume_history.append(hv)

                if len(hypervolume_history) >= 20:
                    recent = hypervolume_history[-20:]
                    improvement = abs(recent[-1] - recent[0]) / max(abs(recent[0]), 1e-10)
                    if improvement < 1e-4:
                        no_improvement_count += 1
                        if no_improvement_count >= 3:
                            # Early stop
                            best_population = scored
                            top_solutions = self._build_top_solutions(
                                best_population[:3], officers, bottlenecks, weather_impact_factor
                            )
                            pareto_data = self._build_pareto_data(
                                best_population[:5], officers, bottlenecks, weather_impact_factor
                            )
                            return GARunResult(
                                best_fitness=best_score,
                                top_solutions=top_solutions,
                                generation_fitness=[round(item, 4) for item in generation_fitness],
                                status="completed",
                                pareto_curve_data=pareto_data,
                                converged_early=True,
                            )
                    else:
                        no_improvement_count = 0

            if progress_callback:
                progress_callback(generation + 1, config["generations"], best_score)

            # Elitism: preserve top individuals from first front
            elite_count = min(config["elitism_count"], len(scored))
            next_population = [chrom[:] for chrom, _ in scored[:elite_count]]

            # Fill rest with NSGA-II tournament selection + crossover + mutation + repair
            while len(next_population) < config["population_size"]:
                parent1 = self._nsga2_select(scored, config["tournament_size"])
                parent2 = self._nsga2_select(scored, config["tournament_size"])
                child1, child2 = self._crossover(parent1, parent2, config["crossover_rate"])
                self._mutate(child1, len(bottlenecks), config["mutation_rate"])
                self._mutate(child2, len(bottlenecks), config["mutation_rate"])
                # Repair operator: ensure minimum coverage after genetic operators
                self._repair_coverage(child1, len(bottlenecks))
                self._repair_coverage(child2, len(bottlenecks))
                next_population.append(child1)
                if len(next_population) < config["population_size"]:
                    next_population.append(child2)
            pop = next_population

        # Final evaluation
        scored = [
            (chromosome, self._evaluate(chromosome, officers, bottlenecks, weather_impact_factor, config, incident_boosts))
            for chromosome in pop
        ]
        fronts = self._fast_non_dominated_sort(scored)
        crowding = {}
        for front in fronts:
            cd = self._crowding_distance(scored, front)
            crowding.update(cd)
        rank_map = {}
        for rank, front in enumerate(fronts):
            for idx in front:
                rank_map[idx] = rank
        scored_with_keys = [
            (1 if s[1]["constraints_violated"] else 0, rank_map.get(i, 999), -crowding.get(i, 0.0), -s[1]["fitness"], s)
            for i, s in enumerate(scored)
        ]
        scored_with_keys.sort(key=lambda x: (x[0], x[1], x[2], x[3]))
        scored = [item[4] for item in scored_with_keys]

        best_population = scored
        top_solutions = self._build_top_solutions(best_population[:3], officers, bottlenecks, weather_impact_factor)
        pareto_data = self._build_pareto_data(best_population[:5], officers, bottlenecks, weather_impact_factor)

        return GARunResult(
            best_fitness=generation_fitness[-1] if generation_fitness else 0.0,
            top_solutions=top_solutions,
            generation_fitness=[round(item, 4) for item in generation_fitness],
            status="completed",
            pareto_curve_data=pareto_data,
        )

    def _build_top_solutions(
        self,
        population: list[tuple[list[int], dict]],
        officers: list[dict],
        bottlenecks: list[dict],
        weather_impact_factor: float,
    ) -> list[dict]:
        top_solutions = []
        for rank, (chromosome, metrics) in enumerate(population, start=1):
            assignments = []
            for officer_idx, bottleneck_idx in enumerate(chromosome):
                officer = officers[officer_idx]
                bottleneck = bottlenecks[bottleneck_idx]
                assignments.append({
                    "officer_id": officer.get("id"),
                    "badge_number": officer.get("badge_number"),
                    "bottleneck_id": bottleneck.get("id"),
                    "bottleneck_name": bottleneck.get("name"),
                })
            top_solutions.append({
                "rank": rank,
                "fitness": metrics["fitness"],
                "coverage_efficiency": metrics["coverage_efficiency"],
                "avg_response_time": metrics["avg_response_time"],
                "resource_utilization": metrics["resource_utilization"],
                "road_priority_coverage": metrics["road_priority_coverage"],
                "constraints_violated": metrics.get("constraints_violated", False),
                "generated_at": datetime.now(UTC).isoformat(),
                "assignments": assignments,
            })
        return top_solutions

    def _build_pareto_data(
        self,
        population: list[tuple[list[int], dict]],
        officers: list[dict],
        bottlenecks: list[dict],
        weather_impact_factor: float,
    ) -> list[dict]:
        pareto_data = []
        for chromosome, metrics in population:
            viz = self._compute_pareto_visualization(metrics, officers, bottlenecks, chromosome, weather_impact_factor)
            pareto_data.append({
                "fitness": metrics["fitness"],
                "coverage_efficiency": metrics["coverage_efficiency"],
                "avg_response_time": metrics["avg_response_time"],
                "resource_utilization": metrics["resource_utilization"],
                "road_priority_coverage": metrics["road_priority_coverage"],
                **viz,
            })
        return pareto_data
