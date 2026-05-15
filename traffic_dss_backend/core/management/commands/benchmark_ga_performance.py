"""
Django management command to benchmark GA optimization performance.

Run 30 independent GA runs and collect performance metrics for thesis Table X:
- Best Fitness Score
- Convergence Generation
- Execution Time
- Coefficient of Variation
- Coverage Efficiency (f1)
- Response Time Score (f2)
- Weather Responsiveness (f3)
- Resource Utilization (f4)

Usage:
    python manage.py benchmark_ga_performance
    python manage.py benchmark_ga_performance --runs 30 --verbose

Output format suitable for direct paste into thesis tables.
"""

import statistics
import time
from dataclasses import dataclass, field
from typing import Optional

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import Bottleneck, Officer
from optimization.engine import GeneticDeploymentOptimizer


@dataclass
class GARunMetrics:
    run_id: int
    seed: int
    best_fitness: float = 0.0
    convergence_gen: int = 0
    execution_time_ms: float = 0.0
    coverage_efficiency: float = 0.0
    response_time_score: float = 0.0
    road_priority_coverage: float = 0.0
    resource_utilization: float = 0.0
    status: str = "unknown"


@dataclass
class BenchmarkResults:
    runs: list[GARunMetrics] = field(default_factory=list)
    parameter_population_size: int = 0
    parameter_generations: int = 0
    parameter_mutation_rate: float = 0.0
    parameter_crossover_rate: float = 0.0
    parameter_elitism_count: int = 0


class Command(BaseCommand):
    help = "Benchmark GA performance over multiple independent runs"

    def add_arguments(self, parser):
        parser.add_argument(
            "--runs",
            type=int,
            default=30,
            help="Number of independent GA runs (default: 30)",
        )
        parser.add_argument(
            "--population",
            type=int,
            default=200,
            help="Population size N (default: 200)",
        )
        parser.add_argument(
            "--generations",
            type=int,
            default=300,
            help="Number of generations G (default: 300)",
        )
        parser.add_argument(
            "--mutation-rate",
            type=float,
            default=0.10,
            help="Mutation rate Pm (default: 0.10)",
        )
        parser.add_argument(
            "--crossover-rate",
            type=float,
            default=0.80,
            help="Crossover rate Pc (default: 0.80)",
        )
        parser.add_argument(
            "--elitism",
            type=int,
            default=20,
            help="Elitism count (default: 20, i.e., 10%% of N=200)",
        )
        parser.add_argument(
            "--seed-offset",
            type=int,
            default=0,
            help="Starting seed offset (for reproducibility)",
        )
        parser.add_argument(
            "--max-officers",
            type=int,
            default=None,
            help="Limit number of officers (creates constrained problem). Default: all officers",
        )
        parser.add_argument(
            "--verbose-output",
            action="store_true",
            default=False,
            help="Show detailed per-run output",
        )

    def _load_test_data(self, max_officers: int | None = None) -> tuple[list[dict], list[dict]]:
        """Load officers and bottlenecks from database for benchmarking."""
        bottlenecks = list(
            Bottleneck.objects.filter(is_deleted=False).values(
                "id", "name", "latitude", "longitude",
                "road_priority_weight", "bottleneck_type"
            )
        )
        if not bottlenecks:
            self.stderr.write("ERROR: No bottlenecks found in database. Run import_officers_bottlenecks first.")
            return [], []

        officers = list(
            Officer.objects.filter(is_deleted=False).values(
                "id", "badge_number", "name", "shift", "status",
                "current_latitude", "current_longitude"
            )
        )
        if not officers:
            self.stderr.write("ERROR: No officers found in database. Run import_officers_bottlenecks first.")
            return [], []

        # Limit officers to create constrained problem (harder optimization)
        if max_officers and max_officers < len(officers):
            officers = officers[:max_officers]
            self.stdout.write(self.style.WARNING(f"Limited to {max_officers} officers (constrained problem)"))

        self.stdout.write(f"Loaded {len(officers)} officers and {len(bottlenecks)} bottlenecks")
        return officers, bottlenecks

    def _find_convergence_generation(
        self,
        fitness_history: list[float],
        threshold: float = 0.001,
        window: int = 20
    ) -> int:
        """Find generation where fitness stabilizes (within threshold for window generations)."""
        if len(fitness_history) < window:
            return len(fitness_history)

        for start in range(len(fitness_history) - window):
            window_data = fitness_history[start:start + window]
            if max(window_data) - min(window_data) <= threshold:
                return start + 1
        return len(fitness_history)

    def _run_single_ga(
        self,
        optimizer: GeneticDeploymentOptimizer,
        officers: list[dict],
        bottlenecks: list[dict],
        parameters: dict,
        run_id: int,
        verbose: bool = False
    ) -> GARunMetrics:
        """Execute a single GA run and collect metrics."""
        seed = parameters.get("seed_offset", 0) + run_id
        metrics = GARunMetrics(run_id=run_id, seed=seed)

        start_time = time.perf_counter()

        result = optimizer.run(
            officers=officers,
            bottlenecks=bottlenecks,
            parameters=parameters,
            weather_impact_factor=1.0,
            seed=seed,
        )

        metrics.execution_time_ms = (time.perf_counter() - start_time) * 1000
        metrics.status = result.status

        if result.status == "completed" and result.top_solutions:
            best = result.top_solutions[0]
            metrics.best_fitness = best["fitness"]
            metrics.coverage_efficiency = best["coverage_efficiency"]
            metrics.response_time_score = 100.0 - (best["avg_response_time"] * 2.0)
            metrics.road_priority_coverage = best["road_priority_coverage"]
            metrics.resource_utilization = best["resource_utilization"]
            metrics.convergence_gen = self._find_convergence_generation(result.generation_fitness)

        if verbose:
            self.stdout.write(
                f"  Run {run_id:2d}: fitness={metrics.best_fitness:.4f}, "
                f"conv_gen={metrics.convergence_gen}, time={metrics.execution_time_ms:.1f}ms"
            )

        return metrics

    def _calculate_statistics(self, results: BenchmarkResults) -> dict:
        """Calculate summary statistics across all runs."""
        successful_runs = [r for r in results.runs if r.status == "completed"]

        if not successful_runs:
            return {"error": "No successful runs completed"}

        stats = {
            "n_successful": len(successful_runs),
            "n_failed": len(results.runs) - len(successful_runs),
        }

        # Best Fitness
        fitness_values = [r.best_fitness for r in successful_runs]
        stats["best_fitness"] = statistics.mean(fitness_values)
        stats["best_fitness_std"] = statistics.stdev(fitness_values) if len(fitness_values) > 1 else 0.0
        stats["best_fitness_min"] = min(fitness_values)
        stats["best_fitness_max"] = max(fitness_values)

        # Convergence Generation
        conv_values = [r.convergence_gen for r in successful_runs]
        stats["convergence_gen"] = statistics.mean(conv_values)
        stats["convergence_gen_std"] = statistics.stdev(conv_values) if len(conv_values) > 1 else 0.0

        # Execution Time
        time_values = [r.execution_time_ms for r in successful_runs]
        stats["execution_time_ms"] = statistics.mean(time_values)
        stats["execution_time_std"] = statistics.stdev(time_values) if len(time_values) > 1 else 0.0

        # Coefficient of Variation (CV)
        if statistics.mean(fitness_values) > 0:
            stats["cv"] = statistics.stdev(fitness_values) / statistics.mean(fitness_values)
        else:
            stats["cv"] = 0.0

        # Coverage Efficiency (f1)
        coverage_values = [r.coverage_efficiency for r in successful_runs]
        stats["coverage_efficiency"] = statistics.mean(coverage_values)
        stats["coverage_efficiency_std"] = statistics.stdev(coverage_values) if len(coverage_values) > 1 else 0.0

        # Response Time Score (f2)
        response_values = [r.response_time_score for r in successful_runs]
        stats["response_time_score"] = statistics.mean(response_values)
        stats["response_time_score_std"] = statistics.stdev(response_values) if len(response_values) > 1 else 0.0

        # Road Priority Coverage (proxy for Weather Responsiveness f3)
        priority_values = [r.road_priority_coverage for r in successful_runs]
        stats["weather_responsiveness"] = statistics.mean(priority_values)
        stats["weather_responsiveness_std"] = statistics.stdev(priority_values) if len(priority_values) > 1 else 0.0

        # Resource Utilization (f4)
        resource_values = [r.resource_utilization for r in successful_runs]
        stats["resource_utilization"] = statistics.mean(resource_values)
        stats["resource_utilization_std"] = statistics.stdev(resource_values) if len(resource_values) > 1 else 0.0

        return stats

    def _format_table_row(self, label: str, mean: float, std: float, unit: str = "") -> str:
        """Format a metric row for table output."""
        if std > 0:
            return f"| {label:<30} | {mean:>10.4f} ± {std:<10.4f} | {unit:<15} |"
        else:
            return f"| {label:<30} | {mean:>10.4f}              | {unit:<15} |"

    def handle(self, *args, **options):
        num_runs = options["runs"]
        verbose = options["verbose_output"]

        parameters = {
            "population_size": options["population"],
            "generations": options["generations"],
            "mutation_rate": options["mutation_rate"],
            "crossover_rate": options["crossover_rate"],
            "elitism_count": options["elitism"],
            "seed_offset": options["seed_offset"],
            "tsi_weight": 0.35,
            "wif_weight": 0.25,
            "rpw_weight": 0.25,
            "resource_utilization_weight": 0.15,
        }

        self.stdout.write(self.style.WARNING(
            f"\n{'='*70}\n"
            f"GA PERFORMANCE BENCHMARK\n"
            f"{'='*70}\n"
            f"Parameters:\n"
            f"  Population Size (N): {parameters['population_size']}\n"
            f"  Generations (G):    {parameters['generations']}\n"
            f"  Mutation Rate (Pm): {parameters['mutation_rate']}\n"
            f"  Crossover Rate (Pc): {parameters['crossover_rate']}\n"
            f"  Elitism Count:      {parameters['elitism_count']} ({100*parameters['elitism_count']/parameters['population_size']:.0f}%)\n"
            f"  Number of Runs:      {num_runs}\n"
            f"{'='*70}\n"
        ))

        # Load data
        officers, bottlenecks = self._load_test_data(options.get("max_officers"))
        if not officers or not bottlenecks:
            return

        # Initialize optimizer
        optimizer = GeneticDeploymentOptimizer(seed=options["seed_offset"])

        # Run benchmarks
        results = BenchmarkResults(
            parameter_population_size=parameters["population_size"],
            parameter_generations=parameters["generations"],
            parameter_mutation_rate=parameters["mutation_rate"],
            parameter_crossover_rate=parameters["crossover_rate"],
            parameter_elitism_count=parameters["elitism_count"],
        )

        self.stdout.write(f"\nRunning {num_runs} GA optimization runs...")
        for run_id in range(num_runs):
            metrics = self._run_single_ga(
                optimizer, officers, bottlenecks, parameters, run_id, verbose
            )
            results.runs.append(metrics)

            if (run_id + 1) % 5 == 0:
                self.stdout.write(f"  Completed {run_id + 1}/{num_runs} runs...")

        # Calculate statistics
        stats = self._calculate_statistics(results)

        # Output results
        self.stdout.write(self.style.SUCCESS(f"\n{'='*70}"))
        self.stdout.write(self.style.SUCCESS("BENCHMARK RESULTS"))
        self.stdout.write(self.style.SUCCESS(f"{'='*70}\n"))

        # Summary
        self.stdout.write(f"Successful runs: {stats['n_successful']}/{num_runs}")
        self.stdout.write(f"Failed runs: {stats['n_failed']}\n")

        # Table X Format (for thesis)
        self.stdout.write(self.style.WARNING("=" * 70))
        self.stdout.write(self.style.WARNING("TABLE X - GA OPTIMIZATION PERFORMANCE METRICS"))
        self.stdout.write(self.style.WARNING("=" * 70))
        self.stdout.write("| Metric                              | Mean ± SD          | Unit            |")
        self.stdout.write("|-------------------------------------|--------------------|-----------------|")
        self.stdout.write(self._format_table_row("Best Fitness Score", stats["best_fitness"], stats["best_fitness_std"]))
        self.stdout.write(self._format_table_row("Convergence Generation", stats["convergence_gen"], stats["convergence_gen_std"], "generations"))
        self.stdout.write(self._format_table_row("Execution Time", stats["execution_time_ms"], stats["execution_time_std"], "milliseconds"))
        self.stdout.write(self._format_table_row("Coefficient of Variation", stats["cv"], 0, "ratio"))
        self.stdout.write(self._format_table_row("Coverage Efficiency (f1)", stats["coverage_efficiency"], stats["coverage_efficiency_std"], "%"))
        self.stdout.write(self._format_table_row("Response Time Score (f2)", stats["response_time_score"], stats["response_time_score_std"], "0-100"))
        self.stdout.write(self._format_table_row("Weather Responsiveness (f3)", stats["weather_responsiveness"], stats["weather_responsiveness_std"], "%"))
        self.stdout.write(self._format_table_row("Resource Utilization (f4)", stats["resource_utilization"], stats["resource_utilization_std"], "%"))
        self.stdout.write("|                                     |                    |                 |")

        # Alternative format for direct paste (space-separated)
        self.stdout.write(self.style.WARNING("\n" + "=" * 70))
        self.stdout.write(self.style.WARNING("COPY-PASTE VALUES (for thesis table):"))
        self.stdout.write(self.style.WARNING("=" * 70))
        self.stdout.write(f"Best Fitness Score:          {stats['best_fitness']:.4f} ± {stats['best_fitness_std']:.4f}")
        self.stdout.write(f"Convergence Generation:      {stats['convergence_gen']:.1f} ± {stats['convergence_gen_std']:.1f} generations")
        self.stdout.write(f"Execution Time:            {stats['execution_time_ms']:.1f} ± {stats['execution_time_std']:.1f} ms")
        self.stdout.write(f"Coefficient of Variation:   {stats['cv']:.4f}")
        self.stdout.write(f"Coverage Efficiency (f1):  {stats['coverage_efficiency']:.2f} ± {stats['coverage_efficiency_std']:.2f} %")
        self.stdout.write(f"Response Time Score (f2):  {stats['response_time_score']:.2f} ± {stats['response_time_score_std']:.2f}")
        self.stdout.write(f"Weather Responsiveness (f3):{stats['weather_responsiveness']:.2f} ± {stats['weather_responsiveness_std']:.2f} %")
        self.stdout.write(f"Resource Utilization (f4):  {stats['resource_utilization']:.2f} ± {stats['resource_utilization_std']:.2f} %")

        # Min/Max range
        self.stdout.write(self.style.WARNING("\n" + "=" * 70))
        self.stdout.write(self.style.WARNING("RANGE DATA (for box plots, error bars):"))
        self.stdout.write(self.style.WARNING("=" * 70))
        self.stdout.write(f"Best Fitness Range:         {stats['best_fitness_min']:.4f} - {stats['best_fitness_max']:.4f}")

        # Raw per-run data (for statistical tests)
        self.stdout.write(self.style.WARNING("\n" + "=" * 70))
        self.stdout.write(self.style.WARNING("RAW DATA (for ANOVA, post-hoc tests):"))
        self.stdout.write(self.style.WARNING("=" * 70))
        fitness_raw = [f"{r.best_fitness:.4f}" for r in results.runs if r.status == "completed"]
        self.stdout.write(f"Fitness values ({len(fitness_raw)} runs):\n  [{', '.join(fitness_raw)}]")

        conv_raw = [str(r.convergence_gen) for r in results.runs if r.status == "completed"]
        self.stdout.write(f"Convergence generations ({len(conv_raw)} runs):\n  [{', '.join(conv_raw)}]")

        time_raw = [f"{r.execution_time_ms:.1f}" for r in results.runs if r.status == "completed"]
        self.stdout.write(f"Execution times ms ({len(time_raw)} runs):\n  [{', '.join(time_raw)}]")

        self.stdout.write(self.style.SUCCESS(f"\n{'='*70}"))
        self.stdout.write("BENCHMARK COMPLETE")
        self.stdout.write(self.style.SUCCESS(f"{'='*70}\n"))