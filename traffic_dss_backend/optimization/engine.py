from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Callable
from random import Random

from geopy.distance import geodesic


@dataclass
class GARunResult:
    best_fitness: float
    top_solutions: list[dict]
    generation_fitness: list[float]
    status: str


class GeneticDeploymentOptimizer:
    """Constraint-aware GA for officer-to-bottleneck assignments."""

    def __init__(self, seed: int = 42):
        self.rng = Random(seed)

    @staticmethod
    def _clamp_parameters(parameters: dict) -> dict:
        return {
            "population_size": max(50, min(500, int(parameters.get("population_size", 200)))),
            "generations": max(50, min(1000, int(parameters.get("generations", 300)))),
            "mutation_rate": max(0.01, min(0.30, float(parameters.get("mutation_rate", 0.10)))),
            "crossover_rate": max(0.50, min(0.95, float(parameters.get("crossover_rate", 0.80)))),
            "elitism_count": max(1, min(20, int(parameters.get("elitism_count", 5)))),
            "tournament_size": 3,
        }

    def _distance_km(self, officer: dict, bottleneck: dict) -> float:
        lat = officer.get("current_latitude")
        lng = officer.get("current_longitude")
        if lat is None or lng is None:
            return 3.0
        return geodesic((lat, lng), (bottleneck["latitude"], bottleneck["longitude"])).km

    def _evaluate(self, chromosome: list[int], officers: list[dict], bottlenecks: list[dict], weather_impact_factor: float) -> dict:
        assigned_indices = [idx for idx in chromosome if 0 <= idx < len(bottlenecks)]
        assigned_count = len(assigned_indices)
        covered = set(assigned_indices)

        coverage_efficiency = (len(covered) / max(1, len(bottlenecks))) * 100
        resource_utilization = (assigned_count / max(1, len(officers))) * 100

        response_minutes = []
        weighted_coverage_bonus = 0.0
        for officer_idx, bottleneck_idx in enumerate(chromosome):
            if bottleneck_idx < 0 or bottleneck_idx >= len(bottlenecks):
                continue
            officer = officers[officer_idx]
            bottleneck = bottlenecks[bottleneck_idx]
            weighted_coverage_bonus += float(bottleneck.get("road_priority_weight", 1.0))
            speed_kmh = max(8.0, 28.0 * (1.0 - float(bottleneck.get("tsi", 0.0))))
            travel_minutes = (self._distance_km(officer, bottleneck) / speed_kmh) * 60.0
            response_minutes.append(travel_minutes * weather_impact_factor)

        coverage_efficiency = min(100.0, coverage_efficiency + min(20.0, weighted_coverage_bonus))
        avg_response_time = sum(response_minutes) / max(1, len(response_minutes))
        response_time_score = max(0.0, 100.0 - (avg_response_time * 2.0))

        fitness = (coverage_efficiency * 0.40) + (response_time_score * 0.35) + (resource_utilization * 0.25)
        return {
            "fitness": round(fitness, 4),
            "coverage_efficiency": round(coverage_efficiency, 3),
            "avg_response_time": round(avg_response_time, 3),
            "resource_utilization": round(resource_utilization, 3),
        }

    def _init_population(self, population_size: int, officer_count: int, bottleneck_count: int) -> list[list[int]]:
        population = []
        for _ in range(population_size):
            chromosome = [self.rng.randrange(0, bottleneck_count) for _ in range(officer_count)]
            population.append(chromosome)
        return population

    def _tournament_select(self, scored_population: list[tuple[list[int], dict]], tournament_size: int) -> list[int]:
        contenders = self.rng.sample(scored_population, k=min(tournament_size, len(scored_population)))
        contenders.sort(key=lambda item: item[1]["fitness"], reverse=True)
        return contenders[0][0][:]

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

    def run(
        self,
        officers: list[dict],
        bottlenecks: list[dict],
        parameters: dict,
        weather_impact_factor: float = 1.0,
        progress_callback: Callable[[int, int, float], None] | None = None,
    ) -> GARunResult:
        if not officers or not bottlenecks:
            return GARunResult(best_fitness=0.0, top_solutions=[], generation_fitness=[], status="failed")

        config = self._clamp_parameters(parameters)
        pop = self._init_population(config["population_size"], len(officers), len(bottlenecks))
        generation_fitness: list[float] = []
        best_population: list[tuple[list[int], dict]] = []

        for generation in range(config["generations"]):
            scored = [(chromosome, self._evaluate(chromosome, officers, bottlenecks, weather_impact_factor)) for chromosome in pop]
            scored.sort(key=lambda item: item[1]["fitness"], reverse=True)
            best_population = scored
            best_score = scored[0][1]["fitness"]
            generation_fitness.append(best_score)

            if progress_callback:
                progress_callback(generation + 1, config["generations"], best_score)

            next_population = [chrom[:] for chrom, _ in scored[: config["elitism_count"]]]
            while len(next_population) < config["population_size"]:
                parent1 = self._tournament_select(scored, config["tournament_size"])
                parent2 = self._tournament_select(scored, config["tournament_size"])
                child1, child2 = self._crossover(parent1, parent2, config["crossover_rate"])
                self._mutate(child1, len(bottlenecks), config["mutation_rate"])
                self._mutate(child2, len(bottlenecks), config["mutation_rate"])
                next_population.append(child1)
                if len(next_population) < config["population_size"]:
                    next_population.append(child2)
            pop = next_population

        top_solutions = []
        for rank, (chromosome, metrics) in enumerate(best_population[:3], start=1):
            assignments = []
            for officer_idx, bottleneck_idx in enumerate(chromosome):
                officer = officers[officer_idx]
                bottleneck = bottlenecks[bottleneck_idx]
                assignments.append(
                    {
                        "officer_id": officer.get("id"),
                        "badge_number": officer.get("badge_number"),
                        "bottleneck_id": bottleneck.get("id"),
                        "bottleneck_name": bottleneck.get("name"),
                    }
                )

            top_solutions.append(
                {
                    "rank": rank,
                    "fitness": metrics["fitness"],
                    "coverage_efficiency": metrics["coverage_efficiency"],
                    "avg_response_time": metrics["avg_response_time"],
                    "resource_utilization": metrics["resource_utilization"],
                    "generated_at": datetime.now(UTC).isoformat(),
                    "assignments": assignments,
                }
            )

        return GARunResult(
            best_fitness=generation_fitness[-1] if generation_fitness else 0.0,
            top_solutions=top_solutions,
            generation_fitness=[round(item, 4) for item in generation_fitness],
            status="completed",
        )
