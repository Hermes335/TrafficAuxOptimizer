from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from rest_framework.views import APIView
from core.models import OptimizationRun
from core.permissions import IsSupervisor
from core.realtime import broadcast
from core.serializers import OptimizationHistorySerializer
from core.utils import write_audit_log
from .progress_store import load_progress, save_progress
from .services import OptimizationInput, start_run


class OptimizationConfigureView(APIView):
    permission_classes = [IsSupervisor]

    def post(self, request):
        serializer = OptimizationInput(data=request.data)
        valid = serializer.is_valid()
        return Response({"valid": valid, "parameters": serializer.validated_data if valid else request.data,
            "errors": {k: str(v[0]) if isinstance(v, list) else str(v) for k, v in serializer.errors.items()}},
            status=200 if valid else 400)


class OptimizationStartView(APIView):
    permission_classes = [IsSupervisor]

    def post(self, request):
        run, queued = start_run(request.user, request.data)
        return Response({"run_id": run.run_id, "status": run.status, "current_generation": 0,
            "total_generations": run.parameters["generations"], "current_fitness": 0,
            **({} if queued else {"detail": "The background queue is unavailable. Retry when it recovers."})},
            status=202 if queued else 503)


class OptimizationCancelView(APIView):
	permission_classes = [IsSupervisor]

	def post(self, request, run_id: str):
		run = OptimizationRun.objects.filter(run_id=run_id, is_deleted=False).first()
		if not run:
			return Response({"detail": "Run not found."}, status=status.HTTP_404_NOT_FOUND)
		if run.status in {"completed", "failed", "cancelled"}:
			return Response({"detail": f"Run is already {run.status}."}, status=status.HTTP_400_BAD_REQUEST)

		if not OptimizationRun.objects.filter(pk=run.pk, status__in=["queued", "running"]).update(status="cancelled", updated_at=timezone.now()):
			return Response({"detail": "Run already finished."}, status=409)
		actor = request.user
		write_audit_log(actor, "cancel", "optimization_run", {"run_id": run_id})
		payload = {
			"event": "optimization_cancelled",
			"run_id": run_id,
			"status": "cancelled",
			"current_generation": 0,
			"total_generations": int(run.parameters.get("total_generations", run.parameters.get("generations", 300))),
			"current_fitness": 0.0,
			"updated_at": timezone.now().isoformat(),
		}
		save_progress(run_id, payload)
		broadcast("optimization_" + run_id, "optimization_event", payload)
		return Response({"run_id": run_id, "status": "cancelled"})


class OptimizationStatusView(APIView):
	permission_classes = [permissions.IsAuthenticated]
	throttle_scope = "operational_read"

	def get(self, request, run_id: str):
		from .recovery import expire_abandoned_runs
		expire_abandoned_runs()
		run = OptimizationRun.objects.filter(run_id=run_id, is_deleted=False).first()
		if not run:
			return Response({"detail": "Run not found."}, status=status.HTTP_404_NOT_FOUND)

		progress = load_progress(run_id)
		if progress and run.status in {"queued", "running"}:
			return Response(progress)

		total_gens = int(run.parameters.get("total_generations", run.parameters.get("generations", 300)))
		current_gen = len(run.fitness_scores) if run.fitness_scores else 0
		current_fitness = float(run.fitness_scores[-1]) if run.fitness_scores else 0.0
		if run.status == "completed":
			current_fitness = float(run.result_data.get("best_fitness", current_fitness))

		return Response(
			{
				"run_id": run.run_id,
				"status": run.status,
				"current_generation": current_gen,
				"total_generations": total_gens,
				"current_fitness": current_fitness,
				"converged_early": bool(run.result_data.get("converged_early", False)),
				"updated_at": run.updated_at.isoformat(),
				"estimated_completion": run.updated_at.isoformat() if run.status in ("completed", "failed", "cancelled") else None,
				"started_at": run.timestamp.isoformat(), "heartbeat_at": run.heartbeat_at,
				"error": run.result_data.get("error") if run.status == "failed" else None,
			}
		)


class OptimizationResultsView(APIView):
	permission_classes = [permissions.IsAuthenticated]
	throttle_scope = "operational_read"

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
				**run.result_data,
				"parameters": run.parameters,
				"top_solutions": run.result_data.get("top_solutions", []),
			}
		)


class OptimizationHistoryView(APIView):
	permission_classes = [permissions.IsAuthenticated]
	throttle_scope = "operational_read"

	def get(self, request):
		runs = OptimizationRun.objects.filter(is_deleted=False).order_by("-timestamp", "-id")
		if request.query_params.get("status"):
			runs = runs.filter(status=request.query_params["status"])
		paginator = PageNumberPagination()
		paginator.page_size_query_param = "page_size"
		paginator.max_page_size = 100
		page = paginator.paginate_queryset(runs, request, view=self)
		return paginator.get_paginated_response(OptimizationHistorySerializer(page, many=True).data)
