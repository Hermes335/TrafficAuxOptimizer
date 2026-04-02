from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import OptimizationRun
from core.serializers import OptimizationRunSerializer
from core.utils import write_audit_log
from .progress_store import load_progress
from .tasks import run_optimization


DEFAULT_GA_PARAMETERS = {
	"population_size": 200,
	"generations": 300,
	"mutation_rate": 0.10,
	"crossover_rate": 0.80,
	"elitism_count": 5,
}


class OptimizationConfigureView(APIView):
	permission_classes = [permissions.AllowAny]

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

		if errors:
			return Response({"parameters": params, "valid": False, "errors": errors}, status=status.HTTP_400_BAD_REQUEST)
		return Response({"parameters": params, "valid": True})


class OptimizationStartView(APIView):
	permission_classes = [permissions.AllowAny]

	def post(self, request):
		params = {**DEFAULT_GA_PARAMETERS, **(request.data or {})}
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


class OptimizationStatusView(APIView):
	permission_classes = [permissions.AllowAny]

	def get(self, request, run_id: str):
		run = OptimizationRun.objects.filter(run_id=run_id, is_deleted=False).first()
		if not run:
			return Response({"detail": "Run not found."}, status=status.HTTP_404_NOT_FOUND)

		progress = load_progress(run_id)
		if progress:
			return Response(progress)

		generation = int((timezone.now() - run.timestamp).total_seconds()) % max(1, int(run.parameters.get("generations", 300)))
		current_fitness = 0.0
		if run.fitness_scores:
			current_fitness = float(run.fitness_scores[min(max(0, generation - 1), len(run.fitness_scores) - 1)])

		return Response(
			{
				"run_id": run.run_id,
				"status": run.status,
				"current_generation": generation,
				"total_generations": run.parameters.get("generations", 300),
				"current_fitness": current_fitness,
				"estimated_completion": (run.timestamp + timedelta(minutes=5)).isoformat(),
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
				"top_solutions": run.result_data.get("top_solutions", []),
			}
		)


class OptimizationHistoryView(APIView):
	permission_classes = [permissions.AllowAny]

	def get(self, request):
		runs = OptimizationRun.objects.filter(is_deleted=False).order_by("-timestamp")[:100]
		return Response(OptimizationRunSerializer(runs, many=True).data)
