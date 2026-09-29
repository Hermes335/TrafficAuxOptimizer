import { operationalTime } from "../services/operationalTime";
import { useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, Users, AlertCircle, Target, Clock, Activity, CheckCircle2, XCircle, ChevronLeft, AlertTriangle } from "lucide-react";
import { Link, useNavigate } from "react-router";
import PrettyCurve from "../components/PrettyCurve";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatusBadge } from "../components/StatusBadge";
import { ErrorFeedback } from "../components/ErrorFeedback";
import {
  cancelOptimizationRun,
  fetchOptimizationStatus,
  runOptimization,
  subscribeToOptimizationStream,
  type OptimizationStatus,
} from "../services/backend";
import { type ConvergencePoint, upsertConvergencePoint, getRunStatusToneClass, getOptimizationProgress, getOptimizationCompletionSummary } from "../types/optimization";

type RunEvent = {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger";
};

export function OptimizationRunning() {
  const navigate = useNavigate();
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const existingRunId = query.get("run_id");
  const [runId, setRunId] = useState<string | null>(existingRunId);
  const [status, setStatus] = useState<OptimizationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [convergenceData, setConvergenceData] = useState<ConvergencePoint[]>([]);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const startPromise = useRef<ReturnType<typeof runOptimization> | null>(null);
  const acceptedStatus = useRef<OptimizationStatus | null>(null);

  const progress = getOptimizationProgress(status);
  const completionSummary = getOptimizationCompletionSummary(status);

  const currentGen = status?.current_generation ?? 0;
  const totalGenerations = status?.total_generations ?? 0;
  const fitnessScore = status?.current_fitness ?? 0;
  const averageFitness = useMemo(() => {
    if (convergenceData.length === 0) {
      return 0;
    }
    const total = convergenceData.reduce((sum, point) => sum + point.bestFitness, 0);
    return total / convergenceData.length;
  }, [convergenceData]);

  const fitnessDeltaFromStart = useMemo(() => {
    if (convergenceData.length < 2) {
      return 0;
    }
    return convergenceData[convergenceData.length - 1].bestFitness - convergenceData[0].bestFitness;
  }, [convergenceData]);

  const config = useMemo(
    () => ({
      populationSize: Number(query.get("population_size") || 200),
      mutationRate: Number(query.get("mutation_rate") || 0.1),
      crossoverRate: Number(query.get("crossover_rate") || 0.8),
      tsiWeight: Number(query.get("tsi_weight") || 0.35),
      wifWeight: Number(query.get("wif_weight") || 0.25),
      rpwWeight: Number(query.get("rpw_weight") || 0.25),
      resourceUtilizationWeight: Number(query.get("resource_utilization_weight") || 0.15),
    }),
    [query],
  );

  const candidatePlans = useMemo(() => {
    const generated = config.populationSize * Math.max(1, currentGen);
    return generated.toLocaleString();
  }, [config.populationSize, currentGen]);

  const latestFitnessLabel = useMemo(() => {
    if (!status) {
      return "Waiting for backend run";
    }
    if (status.status === "completed") {
      return "Completed successfully";
    }
    if (status.status === "failed") {
      return "Run failed";
    }
    if (status.status === "cancelled") {
      return "Run cancelled";
    }
    return "Processing generations";
  }, [status]);

  const latestEventLabel = runEvents[runEvents.length - 1]?.label ?? "Waiting for optimization events...";

  const statusToneClass = getRunStatusToneClass(status?.status);

  const currentEventIcon = useMemo(() => {
    if (!status) {
      return Activity;
    }
    if (status.status === "completed") {
      return CheckCircle2;
    }
    if (status.status === "failed" || status.status === "cancelled") {
      return XCircle;
    }
    return Clock;
  }, [status]);

  const isRunActive = status?.status !== "completed" && status?.status !== "failed" && status?.status !== "cancelled";
  const ProgressStatusIcon = currentEventIcon;
  const progressIconClass =
    status?.status === "completed"
      ? "text-green-700"
      : status?.status === "failed"
        ? "text-red-700"
        : status?.status === "cancelled"
          ? "text-gray-700"
        : "text-white";

  const [cancelError, setCancelError] = useState<string | null>(null);

  const handleCancelRun = async () => {
    if (!runId) {
      navigate("/optimization");
      return;
    }

    try {
      await cancelOptimizationRun(runId);
      setCancelError(null);
      navigate("/optimization");
    } catch (cancelError: unknown) {
      const message = cancelError instanceof Error ? cancelError.message : "Failed to cancel optimization run";
      setCancelError(message);
    }
  };

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let pollTimer: number | undefined;
    const terminal = (value: string) => ["completed", "failed", "cancelled"].includes(value);
    const accept = (latest: OptimizationStatus) => {
      if (!active) return;
      if (acceptedStatus.current && terminal(acceptedStatus.current.status) && !terminal(latest.status)) return;
      latest = {...acceptedStatus.current, ...latest};
      acceptedStatus.current = latest;
      setStatus(latest); setError(latest.error ?? null);
      if (latest.current_generation > 0) {
        setConvergenceData(previous => {
          const next = upsertConvergencePoint(previous, {
            id: `point-${latest.current_generation}`, generation: latest.current_generation,
            bestFitness: latest.current_fitness ?? 0, avgFitness: 0,
          });
          let total = 0;
          return next.map((point, index) => { total += point.bestFitness; return {...point, avgFitness: total / (index + 1)}; });
        });
      }
      setRunEvents(previous => [...previous, {
        label: `${latest.status} · generation ${latest.current_generation ?? 0}`,
        tone: latest.status === "failed" ? "danger" as const : latest.status === "completed" ? "success" as const : "neutral" as const,
      }].slice(-8));
      if (terminal(latest.status) && pollTimer) { window.clearInterval(pollTimer); pollTimer = undefined; }
    };
    const connect = async (id: string) => {
      if (!active) return;
      setRunId(id);
      // Reloading this page reconnects to the persisted run.
      window.history.replaceState(null, "", "/optimization-running?run_id=" + encodeURIComponent(id));
      const poll = async () => {
        try { const latest = await fetchOptimizationStatus(id); accept(latest); }
        catch (e) { if (active) setError(e instanceof Error ? e.message : "Status refresh failed; data may be stale."); }
      };
      unsubscribe = subscribeToOptimizationStream(id, accept);
      pollTimer = window.setInterval(poll, 2000);
      await poll();
    };
    if (existingRunId) void connect(existingRunId);
    else {
      if (!startPromise.current) startPromise.current = runOptimization({
        shift: query.get("shift") ?? "afternoon",
        operational_date: query.get("operational_date") ?? undefined,
        mode: query.get("mode") === "shadow" ? "shadow" : "operational",
        session_id: query.get("session_id") ?? "",
        population_size: Number(query.get("population_size") ?? 200),
        generations: Number(query.get("generations") ?? 300),
        mutation_rate: Number(query.get("mutation_rate") ?? 0.1),
        crossover_rate: Number(query.get("crossover_rate") ?? 0.8),
        elitism_count: Number(query.get("elitism_count") ?? 5),
        tsi_weight: Number(query.get("tsi_weight") ?? 0.35),
        wif_weight: Number(query.get("wif_weight") ?? 0.25),
        rpw_weight: Number(query.get("rpw_weight") ?? 0.25),
        resource_utilization_weight: Number(query.get("resource_utilization_weight") ?? 0.15),
      });
      startPromise.current.then(run => { if (active) { accept(run); void connect(run.run_id); } })
        .catch(e => { if (active) setError(e instanceof Error ? e.message : "Unable to start optimization."); });
    }
    return () => { active = false; unsubscribe?.(); if (pollTimer) window.clearInterval(pollTimer); };
  }, [existingRunId, query]);

  return (
    <div className="flex h-full">
      {/* Left Panel - Configuration */}
      <div className="w-80 flex-shrink-0 border-r bg-white overflow-y-auto p-6">
        <div className="mb-6">
          <div className={`mb-2 inline-block rounded px-3 py-1 text-sm font-medium ${statusToneClass}`}>
            {status?.status ? status.status.toUpperCase() : "STARTING"}
          </div>
          <h2 className="text-lg font-bold">Session ID: {runId ?? "Starting..."}</h2>
          {error && (
            <div className="mt-2 rounded-lg border border-yellow-200 bg-yellow-50 p-2 text-xs text-yellow-700">
              {error}
            </div>
          )}
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
            <div className="mb-1 flex items-center gap-1 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" />
              Data Note
            </div>
            <p>This run uses real traffic coordinates with synthetic variation for missing officers. Production deployment requires complete real data.</p>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Link
              to="/optimization"
              className="rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {isRunActive ? "Back to Optimization" : "Start New Run"}
            </Link>
          </div>
          {isRunActive && (
            <p className="mt-2 text-xs text-gray-500">Leaving this page does not stop the backend run.</p>
          )}
        </div>

        <div className="mb-6">
          <h3 className="mb-4 font-semibold">ENGINE CONFIGURATION</h3>

          <div className="space-y-4">
            <details open className="group">
              <summary className="flex cursor-pointer items-center justify-between rounded-lg bg-gray-50 p-3">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-gray-600" />
                  <span className="font-medium">GA Parameters</span>
                </div>
              </summary>
              <div className="mt-3 space-y-3 px-3">
                <div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-gray-600">Population Size</span>
                    <span className="font-medium">{config.populationSize}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full bg-yellow-400" style={{ width: `${Math.min(100, Math.round((config.populationSize / 500) * 100))}%` }} />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-gray-600">Mutation Rate</span>
                    <span className="font-medium">{config.mutationRate.toFixed(2)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full bg-yellow-400" style={{ width: `${Math.min(100, Math.round(config.mutationRate * 100))}%` }} />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-gray-600">Crossover Rate</span>
                    <span className="font-medium">{config.crossoverRate.toFixed(2)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full bg-yellow-400" style={{ width: `${Math.min(100, Math.round(config.crossoverRate * 100))}%` }} />
                  </div>
                </div>
              </div>
            </details>

            <details open className="group">
              <summary className="flex cursor-pointer items-center justify-between rounded-lg bg-gray-50 p-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-gray-600" />
                  <span className="font-medium">Objective Weights</span>
                </div>
              </summary>
              <div className="mt-3 space-y-3 px-3">
                <div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-gray-600">TSI Weight</span>
                    <span className="font-medium">{config.tsiWeight.toFixed(2)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full bg-yellow-400" style={{ width: `${Math.min(100, Math.round(config.tsiWeight * 100))}%` }} />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-gray-600">WIF Weight</span>
                    <span className="font-medium">{config.wifWeight.toFixed(2)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full bg-yellow-400" style={{ width: `${Math.min(100, Math.round(config.wifWeight * 100))}%` }} />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-gray-600">RPW Weight</span>
                    <span className="font-medium">{config.rpwWeight.toFixed(2)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full bg-yellow-400" style={{ width: `${Math.min(100, Math.round(config.rpwWeight * 100))}%` }} />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-gray-600">Staffing Efficiency</span>
                    <span className="font-medium">{config.resourceUtilizationWeight.toFixed(2)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                    <div
                      className="h-full bg-yellow-400"
                      style={{ width: `${Math.min(100, Math.round(config.resourceUtilizationWeight * 100))}%` }}
                    />
                  </div>
                </div>
              </div>
            </details>
          </div>
        </div>

        <div className="mb-6 rounded-lg bg-yellow-50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-600" />
            <span className="font-semibold text-yellow-900">EXECUTION SNAPSHOT</span>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Status</span>
              <span className="font-medium text-gray-900">{status?.status ?? "starting"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Latest Fitness</span>
              <span className="font-medium text-gray-900">{fitnessScore.toFixed(4)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Last Update</span>
              <span className="font-medium text-gray-900">
                {status?.updated_at || status?.estimated_completion ? operationalTime(status.updated_at ?? status.estimated_completion!) : "pending"}
              </span>
            </div>
            <div className="rounded bg-white/70 p-2">
              <div className="mb-1 flex items-center gap-1 text-gray-700">
                <Activity className="h-3.5 w-3.5" />
                Recent backend events
              </div>
              <div className="mb-2 rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-600">
                Latest: {latestEventLabel}
              </div>
              <div className="space-y-1">
                {runEvents.length === 0 ? (
                  <div className="text-gray-500">Waiting for stream data...</div>
                ) : (
                  runEvents.map((entry, index) => (
                    <div
                      key={`${entry.label}-${index}`}
                      className={`rounded px-2 py-1 ${
                        entry.tone === "success"
                          ? "bg-green-50 text-green-700"
                          : entry.tone === "warning"
                            ? "bg-yellow-50 text-yellow-700"
                            : entry.tone === "danger"
                              ? "bg-red-50 text-red-700"
                              : "bg-gray-50 text-gray-700"
                      }`}
                    >
                      {entry.label}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Center Panel - Progress */}
      <div className="flex flex-1 flex-col min-w-0 bg-gray-50 p-8 overflow-y-auto">
        <div className="mb-8">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-[240px] flex-1 items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-yellow-400">
                <ProgressStatusIcon className={`h-8 w-8 ${progressIconClass} ${isRunActive ? "animate-spin" : ""}`} />
              </div>
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold">{progress}% Optimization Progress</h1>
                  <StatusBadge status={status?.status || "queued"} size="md" />
                </div>
                <p className="text-gray-600">
                  {status?.status === "completed"
                    ? "Optimization complete."
                    : status?.status === "failed"
                      ? "Optimization failed. Check backend logs and retry."
                      : status?.status === "cancelled"
                        ? "Optimization cancelled."
                        : latestFitnessLabel}
                </p>
                {completionSummary && <p className="mt-1 text-sm text-green-700">{completionSummary}</p>}
              </div>
            </div>
            <div className="flex gap-2">
              {status?.status === "completed" && (
                <Link
                  to="/gantt-chart"
                  className="inline-flex items-center gap-2 rounded-lg bg-yellow-400 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-yellow-500"
                >
                  Review Schedule
                  <ChevronLeft className="h-4 w-4 rotate-180" />
                </Link>
              )}
              <Link
                to="/optimization"
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Link>
              {isRunActive && (
                <ConfirmDialog
                  title="Cancel Optimization Run?"
                  description="This will stop the currently running genetic algorithm. The run ID will be marked as cancelled and results will not be saved."
                  confirmText="Cancel Run"
                  isDangerous
                  onConfirm={handleCancelRun}
                  trigger={
                    <button className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100">
                      <XCircle className="h-4 w-4" />
                      Cancel Run
                    </button>
                  }
                />
              )}
            </div>
          </div>

          {/* Show error feedback if cancel failed */}
          {cancelError && (
            <div className="mb-4">
              <ErrorFeedback
                error={cancelError}
                onRetry={handleCancelRun}
                onDismiss={() => setCancelError(null)}
                retryLabel="Retry Cancel"
              />
            </div>
          )}

          <div role="progressbar" aria-label="Optimization progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}
            className="mb-2 h-4 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full bg-yellow-400 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Fitness Convergence Curve */}
        {error && <p role="alert" className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-red-800">{error}</p>}
        <div className="mb-8 flex-1 rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-yellow-500" />
                <h2 className="font-semibold">Fitness Convergence Curve</h2>
              </div>
              <p className="text-sm text-gray-600">{latestFitnessLabel}</p>
            </div>
            <div className={`rounded-full px-3 py-1 ${statusToneClass}`}>
              <span className="text-sm font-medium">{status?.status ? `${status.status} stream` : "LIVE STREAM"}</span>
            </div>
          </div>

          {/* Legend and Axis Label */}
          <div className="mb-4 flex flex-col gap-2">
            <div className="flex gap-6 text-sm">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-yellow-400" />
                <span className="text-gray-700">Best Fitness (Per Generation)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-gray-400" />
                <span className="text-gray-700">Running mean of best fitness</span>
              </div>
            </div>
            {/* Y-axis indicator properly positioned to avoid overlap */}
            <div className="text-xs font-semibold text-gray-500 mt-2">Fitness Score &rarr;</div>
          </div>

          {/* Chart with axis labels */}
          <div className="relative h-80">
            <PrettyCurve
              values={convergenceData.map((d) => d.bestFitness)}
              secondaryValues={convergenceData.map((d) => d.avgFitness)}
              color="#facc15"
              colorSecondary="#6b7280"
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-yellow-50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-yellow-600" />
                <span className="font-medium">GEN {currentGen} · LIMIT {totalGenerations}</span>
              </div>
              <p className="text-sm text-gray-600">
                {status?.status === "completed"
                  ? status.estimated_completion ? `Finished at ${operationalTime(status.estimated_completion)}` : "Run finished."
                  : !isRunActive ? latestFitnessLabel
                    : status?.estimated_completion ? `Estimated completion ${operationalTime(status.estimated_completion)}`
                      : "Estimating completion from backend stream..."}
              </p>
            </div>
            <div className="rounded-lg bg-blue-50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-600" />
                <span className="font-medium">CANDIDATE PLANS (ESTIMATE)</span>
              </div>
              <p className="text-sm text-gray-600">{candidatePlans}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{runId ? `Run ${runId}` : "Awaiting run start"}</span>
          <div className="flex gap-6">
            <span>{status?.status ?? "starting"}</span>
            <span>{status?.current_generation ? `${status.current_generation} generations streamed` : "Awaiting first generation"}</span>
          </div>
        </div>
      </div>

      {/* Right Panel - Performance Monitoring */}
      <div className="w-80 border-l bg-white p-6">
        <h2 className="mb-6 font-semibold">ALGORITHM METRICS</h2>

        <div className="mb-6 space-y-4">
          <div className="rounded-lg border-2 border-yellow-400 bg-yellow-50 p-4">
            <div className="mb-1 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-yellow-600" />
              <span className="text-xs text-gray-600">Best Fitness Score</span>
            </div>
            <div className="flex items-end gap-2">
              <div className="text-3xl font-bold">{fitnessScore.toFixed(1)}</div>
              <div className="mb-1 text-sm text-yellow-600">SCORE</div>
            </div>
            <div className="mt-2 flex items-center gap-1 text-sm text-green-600">
              <TrendingUp className="h-4 w-4" />
              {fitnessDeltaFromStart >= 0 ? "+" : ""}
              {fitnessDeltaFromStart.toFixed(2)} from Gen 1
            </div>
          </div>

          <div className="rounded-lg bg-gray-50 p-4">
            <div className="mb-1 text-xs text-gray-600">Mean of best fitness</div>
            <div className="flex items-end gap-2">
              <div className="text-2xl font-bold">{averageFitness.toFixed(1)}</div>
              <div className="mb-1 text-sm text-gray-600">SCORE</div>
            </div>
            <div className="mt-2 flex items-center gap-1 text-sm text-gray-600">
              Based on {convergenceData.length} streamed generations
            </div>
          </div>

          <div className="rounded-lg bg-gray-50 p-4">
            <div className="mb-1 text-xs text-gray-600">{status?.status === "completed" ? "Generations completed" : "Current Generation"}</div>
            <div className="flex items-end gap-2">
              <div className="text-2xl font-bold">{currentGen}</div>
              <div className="mb-1 text-sm text-gray-600">of {totalGenerations} max</div>
            </div>
            <div className="mt-2 flex items-center gap-1 text-sm text-gray-600">
              {progress}% complete
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-gray-50 p-4 text-center">
          <div className="mb-2 text-sm text-gray-600">BACKEND RESULT VIEW</div>
          <Link
            to={runId ? `/optimization-engine?run_id=${encodeURIComponent(runId)}` : "/optimization-engine"}
            className="flex items-center justify-center gap-2 rounded-lg bg-yellow-400 py-3 font-medium text-white hover:bg-yellow-500"
          >
            <span className="rotate-90">⟳</span>
            Open Result Details
          </Link>
        </div>
      </div>
    </div>
  );
}
