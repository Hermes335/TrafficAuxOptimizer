from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import OptimizationRun
from core.realtime import broadcast
from core.serializers import OptimizationRunSerializer
from core.utils import write_audit_log
from .progress_store import load_progress, save_progress
from .tasks import run_optimization


DEFAULT_GA_PARAMETERS = {
	"population_size": 200,
	"generations": 300,
	"mutation_rate": 0.10,
	"crossover_rate": 0.80,
	"elitism_count": 5,
	"tsi_weight": 0.35,
	"wif_weight": 0.25,
	"rpw_weight": 0.25,
	"resource_utilization_weight": 0.15,
}


def _weight_total(params: dict) -> float:
	return float(params.get("tsi_weight", 0)) + float(params.get("wif_weight", 0)) + float(params.get("rpw_weight", 0)) + float(params.get("resource_utilization_weight", 0))


class OptimizationConfigureView(APIView):
	permission_classes = [permissions.IsAuthenticated]

	def post(self, request):
		params = {**DEFAULT_GA_PARAMETERS, **(request.data or {})}
		errors = {}
		if not 50 <= int(params["population_size"]) <= 500:
			errors["population_size"] = "Must be between 50 and 500."
		if not 50 <= int(params["generations"]) <= 1000:
			errors["generations"] = "Must be between 50 and 1000."
		if not 0.01 <= float(params["mutation_rate"]) <= 0.30:
			errors["mutation_rate"] = "Must be between 0.01 and 0.30."
		if not 0.50 <= float(params["crossover_rate"]) <= 0.95:
			errors["crossover_rate"] = "Must be between 0.50 and 0.95."
		if not 1 <= int(params["elitism_count"]) <= 20:
			errors["elitism_count"] = "Must be between 1 and 20."
		if not 0.0 <= float(params["tsi_weight"]) <= 1.0:
			errors["tsi_weight"] = "Must be between 0.00 and 1.00."
		if not 0.0 <= float(params["wif_weight"]) <= 1.0:
			errors["wif_weight"] = "Must be between 0.00 and 1.00."
		if not 0.0 <= float(params["rpw_weight"]) <= 1.0:
			errors["rpw_weight"] = "Must be between 0.00 and 1.00."
		if not 0.0 <= float(params["resource_utilization_weight"]) <= 1.0:
			errors["resource_utilization_weight"] = "Must be between 0.00 and 1.00."
		if _weight_total(params) <= 0:
			errors["weights"] = "At least one objective weight must be greater than 0."

		if errors:
			return Response({"parameters": params, "valid": False, "errors": errors}, status=status.HTTP_400_BAD_REQUEST)
		return Response({"parameters": params, "valid": True})


class OptimizationStartView(APIView):
	permission_classes = [permissions.IsAuthenticated]

	def post(self, request):
		params = {**DEFAULT_GA_PARAMETERS, **(request.data or {})}
		errors = {}
		if not 50 <= int(params.get("population_size", 200)) <= 500:
			errors["population_size"] = "Must be between 50 and 500."
		if not 50 <= int(params.get("generations", 300)) <= 1000:
			errors["generations"] = "Must be between 50 and 1000."
		if not 0.01 <= float(params.get("mutation_rate", 0.1)) <= 0.30:
			errors["mutation_rate"] = "Must be between 0.01 and 0.30."
		if not 0.50 <= float(params.get("crossover_rate", 0.8)) <= 0.95:
			errors["crossover_rate"] = "Must be between 0.50 and 0.95."
		if not 1 <= int(params.get("elitism_count", 5)) <= 20:
			errors["elitism_count"] = "Must be between 1 and 20."
		if errors:
			return Response({"detail": "Invalid parameters.", "errors": errors}, status=status.HTTP_400_BAD_REQUEST)
		if _weight_total(params) <= 0:
			return Response(
				{"detail": "At least one objective weight must be greater than 0."},
				status=status.HTTP_400_BAD_REQUEST,
			)
		created_by = request.user if getattr(request, "user", None) and request.user.is_authenticated else get_user_model().objects.order_by("id").first()
		if created_by is None:
			created_by = get_user_model().objects.create_user(username="desktop-runner")
		run = OptimizationRun.objects.create(
			run_id=f"opt-{timezone.now().strftime('%Y%m%d%H%M%S%f')}",
			timestamp=timezone.now(),
			parameters=params,
			fitness_scores=[],
			result_data={},
			status="running",
			created_by=created_by,
		)
		run_optimization.delay(run.run_id)
		write_audit_log(created_by, "create", "optimization_run", {"run_id": run.run_id})
		return Response(
			{
				"run_id": run.run_id,
				"status": run.status,
				"current_generation": 0,
				"total_generations": int(params.get("generations", 300)),
				"current_fitness": 0.0,
				"estimated_completion": (timezone.now() + timedelta(minutes=5)).isoformat(),
			},
			status=status.HTTP_202_ACCEPTED,
		)


class OptimizationCancelView(APIView):
	permission_classes = [permissions.IsAuthenticated]

	def post(self, request, run_id: str):
		run = OptimizationRun.objects.filter(run_id=run_id, is_deleted=False).first()
		if not run:
			return Response({"detail": "Run not found."}, status=status.HTTP_404_NOT_FOUND)
		if run.status in {"completed", "failed", "cancelled"}:
			return Response({"detail": f"Run is already {run.status}."}, status=status.HTTP_400_BAD_REQUEST)

		run.status = "cancelled"
		run.save(update_fields=["status", "updated_at"])
		actor = request.user if getattr(request, "user", None) and request.user.is_authenticated else get_user_model().objects.order_by("id").first()
		if actor is None:
			actor = get_user_model().objects.create_user(username="desktop-runner")
		write_audit_log(actor, "cancel", "optimization_run", {"run_id": run_id})
		payload = {
			"event": "optimization_cancelled",
			"run_id": run_id,
			"status": "cancelled",
			"current_generation": 0,
			"total_generations": int(run.parameters.get("generations", 300)),
			"current_fitness": 0.0,
			"updated_at": timezone.now().isoformat(),
		}
		save_progress(run_id, payload)
		broadcast("optimization_" + run_id, "optimization_event", payload)
		return Response({"run_id": run_id, "status": run.status})


class OptimizationStatusView(APIView):
	permission_classes = [permissions.AllowAny]

	def get(self, request, run_id: str):
		run = OptimizationRun.objects.filter(run_id=run_id, is_deleted=False).first()
		if not run:
			return Response({"detail": "Run not found."}, status=status.HTTP_404_NOT_FOUND)

		progress = load_progress(run_id)
		if progress:
			return Response(progress)

		total_gens = int(run.parameters.get("generations", 300))
		if run.status == "completed":
			current_gen = total_gens
		else:
			current_gen = len(run.fitness_scores) if run.fitness_scores else 0
		current_fitness = float(run.fitness_scores[-1]) if run.fitness_scores else 0.0

		return Response(
			{
				"run_id": run.run_id,
				"status": run.status,
				"current_generation": current_gen,
				"total_generations": total_gens,
				"current_fitness": current_fitness,
				"estimated_completion": run.updated_at.isoformat() if run.status in ("completed", "failed", "cancelled") else None,
			}
		)


class OptimizationResultsView(APIView):
	permission_classes = [permissions.AllowAny]

	def get(self, request, run_id: str):
		run = OptimizationRun.objects.filter(run_id=run_id, is_deleted=False).first()
		if not run:
			return Response({"detail": "Run not found."}, status=status.HTTP_404_NOT_FOUND)
		return Response(
			{
				"run_id": run.run_id,
				"status": run.status,
				"fitness_scores": run.fitness_scores or [],
				"total_generations": int((run.parameters or {}).get("generations", 300)),
				"top_solutions": run.result_data.get("top_solutions", []),
			}
		)


class OptimizationHistoryView(APIView):
	permission_classes = [permissions.AllowAny]

	def get(self, request):
		runs = OptimizationRun.objects.filter(is_deleted=False).order_by("-timestamp")[:100]
		return Response(OptimizationRunSerializer(runs, many=True).data)
