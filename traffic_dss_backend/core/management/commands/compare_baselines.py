"""
Compare manual (ICTTMO) deployments against GA-optimized deployments.

Runs the GA engine's fitness function on both sets of deployments
and outputs a side-by-side comparison.

Usage:
  python manage.py compare_baselines
  python manage.py compare_baselines --shift morning
  python manage.py compare_baselines --run-id <optimization_run_id>
"""

from collections import Counter

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import Bottleneck, Deployment, Officer, WeatherData
from optimization.engine import GeneticDeploymentOptimizer


class Command(BaseCommand):
    help = "Compare manual (ICTTMO) deployments against GA-optimized deployments"

    def add_arguments(self, parser):
        parser.add_argument(
            "--shift",
            choices=["morning", "afternoon"],
            default="afternoon",
            help="Shift to evaluate (default: afternoon)",
        )
        parser.add_argument(
            "--run-id",
            default=None,
            help="Optimization run ID to compare against (default: latest completed)",
        )

    def handle(self, *args, **options):
        shift = options["shift"]
        run_id = options["run_id"]

        # ── Load data ─────────────────────────────────────────────────────
        officers = list(
            Officer.objects.filter(
                is_deleted=False, shift=shift, status__in=["available", "deployed"]
            ).values("id", "badge_number", "current_latitude", "current_longitude")
        )
        bottlenecks = list(
            Bottleneck.objects.filter(is_deleted=False).values(
                "id", "name", "latitude", "longitude", "tsi", "road_priority_weight"
            )
        )

        weather = WeatherData.objects.filter(is_deleted=False).order_by("-timestamp").first()
        wif = float(getattr(weather, "weather_impact_factor", 1.0))

        if not officers or not bottlenecks:
            self.stdout.write(self.style.ERROR("No officers or bottlenecks found."))
            return

        self.stdout.write(f"Shift: {shift}")
        self.stdout.write(f"Officers: {len(officers)}")
        self.stdout.write(f"Bottlenecks: {len(bottlenecks)}")
        self.stdout.write(f"WIF: {wif}")
        self.stdout.write("")

        # ── Evaluate manual deployments ────────────────────────────────────
        manual_deps = list(
            Deployment.objects.filter(
                is_deleted=False, source="manual", shift=shift
            ).select_related("officer", "bottleneck")
        )

        if not manual_deps:
            self.stdout.write(self.style.WARNING(
                "No manual (ICTTMO) deployments found. Run import_icttmo_schedule first."
            ))
        else:
            # Build chromosome: only officers with actual ICTTMO assignments
            # Use the assigned officers as the evaluation pool (same pool GA would use)
            assigned_officer_ids = list(set(dep.officer_id for dep in manual_deps))
            assigned_officers_qs = Officer.objects.filter(
                id__in=assigned_officer_ids, is_deleted=False
            ).order_by("id")

            bottleneck_list = list(Bottleneck.objects.filter(is_deleted=False).order_by("id"))
            bn_index = {bn.id: i for i, bn in enumerate(bottleneck_list)}

            # Build chromosome: each officer -> their assigned bottleneck
            eval_officers = list(assigned_officers_qs)
            chromosome = []
            for officer in eval_officers:
                dep = next((d for d in manual_deps if d.officer_id == officer.id), None)
                if dep:
                    bi = bn_index.get(dep.bottleneck_id, 0)
                    chromosome.append(bi)
                else:
                    chromosome.append(0)

            # Build eval officer dicts
            eval_officer_dicts = [
                {
                    "id": o.id,
                    "badge_number": o.badge_number,
                    "current_latitude": o.current_latitude,
                    "current_longitude": o.current_longitude,
                }
                for o in eval_officers
            ]

            opt = GeneticDeploymentOptimizer(seed=42)
            config = opt._clamp_parameters({})

            # Evaluate objectives only (skip constraint penalties for manual baseline)
            objectives = opt._evaluate_objectives(chromosome, eval_officer_dicts, bottlenecks, wif, {})
            manual_eval = {
                "fitness": (
                    (objectives["coverage_efficiency"] * config["tsi_weight"])
                    + (objectives["response_time_score"] * config["wif_weight"])
                    + (objectives["road_priority_coverage"] * config["rpw_weight"])
                    + (objectives["resource_utilization"] * config["resource_utilization_weight"])
                ),
                **objectives,
                "constraints_violated": False,
            }

            # Count coverage
            covered = set(idx for idx in chromosome if 0 <= idx < len(bottlenecks))

            self.stdout.write(self.style.SUCCESS("=== Manual (ICTTMO) Deployment ==="))
            self.stdout.write(f"  Officers: {len(eval_officers)}")
            self.stdout.write(f"  Assignments: {len(manual_deps)}")
            self.stdout.write(f"  Covered bottlenecks: {len(covered)}/{len(bottlenecks)}")
            self.stdout.write(f"  Coverage Efficiency: {manual_eval['coverage_efficiency']:.1f}%")
            self.stdout.write(f"  Response Time Score: {manual_eval['response_time_score']:.1f}")
            self.stdout.write(f"  Avg Response Time: {manual_eval['avg_response_time']:.1f} min")
            self.stdout.write(f"  Road Priority Coverage: {manual_eval['road_priority_coverage']:.1f}%")
            self.stdout.write(f"  Resource Utilization: {manual_eval['resource_utilization']:.1f}%")
            self.stdout.write(f"  Fitness: {manual_eval['fitness']:.2f}")
            self.stdout.write("")

        # ── Evaluate GA-optimized deployments ──────────────────────────────
        from core.models import OptimizationRun

        if run_id:
            ga_run = OptimizationRun.objects.filter(run_id=run_id, status="completed").first()
        else:
            ga_run = OptimizationRun.objects.filter(
                is_deleted=False, status="completed"
            ).order_by("-timestamp").first()

        if not ga_run:
            self.stdout.write(self.style.WARNING("No completed optimization run found."))
        else:
            top_solution = ga_run.result_data.get("top_solutions", [{}])[0] if ga_run.result_data else {}
            ga_fitness = top_solution.get("fitness", 0)
            ga_coverage = top_solution.get("coverage_efficiency", 0)
            ga_response = top_solution.get("avg_response_time", 0)
            ga_resource = top_solution.get("resource_utilization", 0)
            ga_road = top_solution.get("road_priority_coverage", 0)

            self.stdout.write(self.style.SUCCESS(f"=== GA Optimized (Run: {ga_run.run_id}) ==="))
            self.stdout.write(f"  Parameters: pop={ga_run.parameters.get('population_size')}, gen={ga_run.parameters.get('generations')}")
            self.stdout.write(f"  Coverage Efficiency: {ga_coverage:.1f}%")
            self.stdout.write(f"  Response Time Score: {top_solution.get('response_time_score', 0):.1f}")
            self.stdout.write(f"  Avg Response Time: {ga_response:.1f} min")
            self.stdout.write(f"  Road Priority Coverage: {ga_road:.1f}%")
            self.stdout.write(f"  Resource Utilization: {ga_resource:.1f}%")
            self.stdout.write(f"  Fitness: {ga_fitness:.2f}")
            self.stdout.write("")

        # ── Side-by-side comparison ────────────────────────────────────────
        if manual_deps and ga_run:
            self.stdout.write(self.style.SUCCESS("=== Improvement (GA vs Manual) ==="))
            m = manual_eval
            g_fitness = ga_fitness
            g_coverage = ga_coverage
            g_response_time = ga_response
            g_resource = ga_resource

            def pct_diff(manual_val, ga_val):
                if manual_val == 0:
                    return "N/A"
                diff = ((ga_val - manual_val) / abs(manual_val)) * 100
                sign = "+" if diff > 0 else ""
                return f"{sign}{diff:.1f}%"

            self.stdout.write(f"  Coverage Efficiency: {m['coverage_efficiency']:.1f}% -> {g_coverage:.1f}% ({pct_diff(m['coverage_efficiency'], g_coverage)})")
            self.stdout.write(f"  Avg Response Time:   {m['avg_response_time']:.1f}min -> {g_response_time:.1f}min ({pct_diff(m['avg_response_time'], g_response_time)})")
            self.stdout.write(f"  Resource Utilization: {m['resource_utilization']:.1f}% -> {g_resource:.1f}% ({pct_diff(m['resource_utilization'], g_resource)})")
            self.stdout.write(f"  Fitness: {m['fitness']:.2f} -> {g_fitness:.2f} ({pct_diff(m['fitness'], g_fitness)})")
            self.stdout.write("")

            # Write to benchmark file
            self._write_benchmark(m, ga_run, shift)

    def _write_benchmark(self, manual_eval, ga_run, shift):
        """Append comparison to benchmark file."""
        import os

        benchmark_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            "BASELINE_COMPARISON.md",
        )

        top = ga_run.result_data.get("top_solutions", [{}])[0] if ga_run.result_data else {}

        with open(benchmark_path, "w", encoding="utf-8") as f:
            f.write("# Baseline Comparison: Manual ICTTMO vs GA Optimized\n\n")
            f.write(f"**Date:** {timezone.now().strftime('%Y-%m-%d %H:%M')}\n")
            f.write(f"**Shift:** {shift}\n")
            f.write(f"**GA Run ID:** {ga_run.run_id}\n\n")

            f.write("## Manual (ICTTMO) Deployment\n\n")
            f.write(f"- Coverage Efficiency: {manual_eval['coverage_efficiency']:.1f}%\n")
            f.write(f"- Response Time Score: {manual_eval['response_time_score']:.1f}\n")
            f.write(f"- Avg Response Time: {manual_eval['avg_response_time']:.1f} min\n")
            f.write(f"- Road Priority Coverage: {manual_eval['road_priority_coverage']:.1f}%\n")
            f.write(f"- Resource Utilization: {manual_eval['resource_utilization']:.1f}%\n")
            f.write(f"- Fitness: {manual_eval['fitness']:.2f}\n\n")

            f.write("## GA Optimized Deployment\n\n")
            f.write(f"- Coverage Efficiency: {top.get('coverage_efficiency', 0):.1f}%\n")
            f.write(f"- Avg Response Time: {top.get('avg_response_time', 0):.1f} min\n")
            f.write(f"- Road Priority Coverage: {top.get('road_priority_coverage', 0):.1f}%\n")
            f.write(f"- Resource Utilization: {top.get('resource_utilization', 0):.1f}%\n")
            f.write(f"- Fitness: {top.get('fitness', 0):.2f}\n\n")

            f.write("## Improvement\n\n")
            m = manual_eval
            g = top
            for label, mkey, gkey in [
                ("Coverage Efficiency", "coverage_efficiency", "coverage_efficiency"),
                ("Avg Response Time", "avg_response_time", "avg_response_time"),
                ("Resource Utilization", "resource_utilization", "resource_utilization"),
                ("Fitness", "fitness", "fitness"),
            ]:
                mv = m[mkey]
                gv = g.get(gkey, 0)
                if mv > 0:
                    diff = ((gv - mv) / abs(mv)) * 100
                    sign = "+" if diff > 0 else ""
                    f.write(f"- {label}: {mv:.2f} -> {gv:.2f} ({sign}{diff:.1f}%)\n")
                else:
                    f.write(f"- {label}: {mv:.2f} -> {gv:.2f}\n")

        self.stdout.write(f"\nComparison written to: {benchmark_path}")
