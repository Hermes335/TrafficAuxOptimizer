import { useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, Users, AlertCircle, Target, Clock, Activity, CheckCircle2, XCircle } from "lucide-react";
import { Link } from "react-router";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  fetchOptimizationResults,
  fetchOptimizationStatus,
  runOptimization,
  subscribeToOptimizationStream,
  type OptimizationStatus,
} from "../services/backend";

type ConvergencePoint = { id: string; x: number; best: number; avg: number };
type RunEvent = {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger";
};

function upsertConvergencePoint(prev: ConvergencePoint[], nextPoint: ConvergencePoint) {
  const existingIndex = prev.findIndex((item) => item.x === nextPoint.x);
  if (existingIndex >= 0) {
    const next = [...prev];
    next[existingIndex] = nextPoint;
    return next;
  }
  return [...prev, nextPoint].slice(-120);
}

export function OptimizationRunning() {
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<OptimizationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [convergenceData, setConvergenceData] = useState<ConvergencePoint[]>([]);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const startedRef = useRef(false);

  const progress = useMemo(() => {
    if (!status || status.total_generations <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((status.current_generation / status.total_generations) * 100));
  }, [status]);

  const currentGen = status?.current_generation ?? 0;
  const totalGenerations = status?.total_generations ?? 0;
  const fitnessScore = status?.current_fitness ?? 0;
  const averageFitness = useMemo(() => {
    if (convergenceData.length === 0) {
      return 0;
    }
    const total = convergenceData.reduce((sum, point) => sum + point.best, 0);
    return total / convergenceData.length;
  }, [convergenceData]);

  const fitnessDeltaFromStart = useMemo(() => {
    if (convergenceData.length < 2) {
      return 0;
    }
    return convergenceData[convergenceData.length - 1].best - convergenceData[0].best;
  }, [convergenceData]);

  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const config = useMemo(
    () => ({
      populationSize: Number(query.get("population_size") || 200),
      mutationRate: Number(query.get("mutation_rate") || 0.1),
      crossoverRate: Number(query.get("crossover_rate") || 0.8),
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
    return "Processing generations";
  }, [status]);

  const latestEventLabel = runEvents[runEvents.length - 1]?.label ?? "Waiting for optimization events...";

  const statusToneClass =
    status?.status === "completed"
      ? "bg-green-100 text-green-700"
      : status?.status === "failed"
        ? "bg-red-100 text-red-700"
        : "bg-yellow-100 text-yellow-700";

  const currentEventIcon = useMemo(() => {
    if (!status) {
      return Activity;
    }
    if (status.status === "completed") {
      return CheckCircle2;
    }
    if (status.status === "failed") {
      return XCircle;
    }
    return Clock;
  }, [status]);

  const isRunActive = status?.status !== "completed" && status?.status !== "failed";
  const ProgressStatusIcon = currentEventIcon;
  const progressIconClass =
    status?.status === "completed"
      ? "text-green-700"
      : status?.status === "failed"
        ? "text-red-700"
        : "text-white";

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    let unsubscribe: (() => void) | undefined;
    let pollTimer: number | undefined;

    const payload = {
      shift: "afternoon",
      population_size: Number(query.get("population_size") || 200),
      generations: Number(query.get("generations") || 300),
      mutation_rate: Number(query.get("mutation_rate") || 0.1),
      crossover_rate: Number(query.get("crossover_rate") || 0.8),
      elitism_count: Number(query.get("elitism_count") || 5),
    };

    runOptimization(payload)
      .then((run) => {
        setRunId(run.run_id);
        setStatus(run);
        setRunEvents([{ label: `Run started: ${run.run_id}`, tone: "success" }]);

        unsubscribe = subscribeToOptimizationStream(run.run_id, (event) => {
          if (event.current_generation !== undefined) {
            setConvergenceData((prev) =>
              upsertConvergencePoint(prev, {
                id: `point-${event.current_generation}`,
                x: event.current_generation,
                best: event.current_fitness ?? 0,
                avg: Math.max(0, (event.current_fitness ?? 0) * 0.82),
              }),
            );
          }
          setStatus((prev) => ({ ...prev, ...event }));
          const eventTone: RunEvent["tone"] =
            event.status === "completed"
              ? "success"
              : event.status === "failed"
                ? "danger"
                : "neutral";

          setRunEvents((prev) => [
            ...prev,
            {
              label: `${event.event ?? "optimization_event"} • gen ${event.current_generation ?? 0}`,
              tone: eventTone,
            },
          ].slice(-8));

          if (event.status === "completed" || event.status === "failed") {
            if (pollTimer) {
              window.clearInterval(pollTimer);
              pollTimer = undefined;
            }
          }
        });

        pollTimer = window.setInterval(() => {
          fetchOptimizationStatus(run.run_id)
            .then((latest) => {
              const pollTone: RunEvent["tone"] =
                latest.status === "completed" ? "success" : latest.status === "failed" ? "danger" : "neutral";

              setStatus(latest);
              setRunEvents((prev) => [
                ...prev,
                {
                  label: `Polled status: ${latest.status} • gen ${latest.current_generation}/${latest.total_generations}`,
                  tone: pollTone,
                },
              ].slice(-8));
              setConvergenceData((prev) =>
                upsertConvergencePoint(prev, {
                  id: `poll-${latest.current_generation}`,
                  x: latest.current_generation,
                  best: latest.current_fitness,
                  avg: Math.max(0, latest.current_fitness * 0.82),
                }),
              );

              if (latest.status === "completed" || latest.status === "failed") {
                if (pollTimer) {
                  window.clearInterval(pollTimer);
                  pollTimer = undefined;
                }
                fetchOptimizationResults(run.run_id)
                  .then((result) => {
                    if (!Array.isArray(result.fitness_scores) || result.fitness_scores.length === 0) {
                      return;
                    }
                    const rebuilt = result.fitness_scores.map((score, index) => ({
                      id: `final-${index + 1}`,
                      x: index + 1,
                      best: score,
                      avg: Math.max(0, score * 0.82),
                    }));
                    setConvergenceData(rebuilt.slice(-120));
                  })
                  .catch(() => {
                    return;
                  });
              }
            })
            .catch(() => {
              // keep UI alive while websocket updates are active
            });
        }, 1500);
      })
      .catch((runError: unknown) => {
        const message = runError instanceof Error ? runError.message : "Failed to start optimization";
        setError(message);
      });

    return () => {
      if (pollTimer) {
        window.clearInterval(pollTimer);
      }
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [query]);

  return (
    <div className="flex h-full">
      {/* Left Panel - Configuration */}
      <div className="w-80 border-r bg-white p-6">
        <div className="mb-6">
          <div className={`mb-2 inline-block rounded px-3 py-1 text-sm font-medium ${statusToneClass}`}>
            {status?.status ? status.status.toUpperCase() : "STARTING"}
          </div>
            <h2 className="text-lg font-bold">Session ID: {runId ?? "Starting..."}</h2>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
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
                    <span className="font-medium">0.35</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full bg-yellow-400" style={{ width: "35%" }} />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-gray-600">WIF Weight</span>
                    <span className="font-medium">0.25</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full bg-yellow-400" style={{ width: "25%" }} />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-gray-600">RPW Weight</span>
                    <span className="font-medium">0.25</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full bg-yellow-400" style={{ width: "25%" }} />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-gray-600">Resource Utilization</span>
                    <span className="font-medium">0.15</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full bg-yellow-400" style={{ width: "15%" }} />
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
                {status?.estimated_completion ? new Date(status.estimated_completion).toLocaleTimeString() : "pending"}
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

        <div className="rounded-lg bg-gray-50 p-4 text-center">
          <div className="mb-2 text-sm text-gray-600">OPEN BACKEND RESULT VIEW</div>
          <Link
            to={runId ? `/optimization-engine?run_id=${encodeURIComponent(runId)}` : "/optimization-engine"}
            className="flex items-center justify-center gap-2 rounded-lg bg-yellow-400 py-3 font-medium text-white hover:bg-yellow-500"
          >
            <span className="rotate-90">⟳</span>
            View Optimization Output
          </Link>
        </div>
      </div>

      {/* Center Panel - Progress */}
      <div className="flex flex-1 flex-col bg-gray-50 p-8">
        <div className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-400">
                <ProgressStatusIcon className={`h-8 w-8 ${progressIconClass} ${isRunActive ? "animate-spin" : ""}`} />
              </div>
              <div>
                <h1 className="text-2xl font-bold">{progress}% Optimization Progress</h1>
                <p className="text-gray-600">
                  {status?.status === "completed"
                    ? "Optimization complete."
                    : status?.status === "failed"
                      ? "Optimization failed. Check backend logs and retry."
                      : latestFitnessLabel}
                </p>
              </div>
            </div>
          </div>

          <div className="mb-2 h-4 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full bg-yellow-400 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Fitness Convergence Curve */}
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

          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={convergenceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="x"
                tick={{ fontSize: 11 }}
                label={{ value: "Generation", position: "insideBottom", offset: -5 }}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                domain={[30, 100]}
                label={{ value: "Fitness Score", angle: -90, position: "insideLeft" }}
              />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="best"
                stroke="#facc15"
                strokeWidth={3}
                dot={false}
                name="Best Fitness"
                isAnimationActive={false}
                key="running-best-fitness"
              />
              <Line
                type="monotone"
                dataKey="avg"
                stroke="#6b7280"
                strokeWidth={2}
                dot={false}
                name="Average Fitness"
                isAnimationActive={false}
                key="running-avg-fitness"
              />
            </LineChart>
          </ResponsiveContainer>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-yellow-50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-yellow-600" />
                <span className="font-medium">GEN {currentGen} / {totalGenerations}</span>
              </div>
              <p className="text-sm text-gray-600">
                {status?.estimated_completion
                  ? `Estimated completion ${new Date(status.estimated_completion).toLocaleTimeString()}`
                  : "Estimating completion from backend stream..."}
              </p>
            </div>
            <div className="rounded-lg bg-blue-50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-600" />
                <span className="font-medium">CANDIDATE PLANS</span>
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
            <div className="mb-1 text-xs text-gray-600">Average Fitness</div>
            <div className="flex items-end gap-2">
              <div className="text-2xl font-bold">{averageFitness.toFixed(1)}</div>
              <div className="mb-1 text-sm text-gray-600">SCORE</div>
            </div>
            <div className="mt-2 flex items-center gap-1 text-sm text-gray-600">
              Based on {convergenceData.length} streamed generations
            </div>
          </div>

          <div className="rounded-lg bg-gray-50 p-4">
            <div className="mb-1 text-xs text-gray-600">Current Generation</div>
            <div className="flex items-end gap-2">
              <div className="text-2xl font-bold">{currentGen}</div>
              <div className="mb-1 text-sm text-gray-600">/ {totalGenerations}</div>
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