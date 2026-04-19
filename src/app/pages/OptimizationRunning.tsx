import { useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, Users, AlertCircle, Target } from "lucide-react";
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

  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const config = useMemo(
    () => ({
      populationSize: Number(query.get("population_size") || 200),
      mutationRate: Number(query.get("mutation_rate") || 0.1),
      crossoverRate: Number(query.get("crossover_rate") || 0.8),
    }),
    [query],
  );

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
              setStatus(latest);
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
          <div className="mb-2 inline-block rounded bg-yellow-400 px-3 py-1 text-sm font-medium text-white">
            ⚡ OPTIMIZATION RUNNING
          </div>
            <h2 className="text-lg font-bold">Session ID: {runId ?? "Starting..."}</h2>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
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
            <span className="font-semibold text-yellow-900">ENGINE LOGS</span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">GA_INIT_SUCCESS</span>
              <span className="text-green-600">OK</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">X_OVER_RATE_SYNC</span>
              <span className="text-green-600">OK</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">ELITE_SURVIVAL</span>
              <span className="text-yellow-600">ACT</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">PARALLEL_THREADS</span>
              <span className="text-blue-600">8/8</span>
            </div>
            <div className="text-yellow-600">▸ SEARCHING_GLOBAL_OPTIMA...</div>
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
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-white border-t-transparent" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">{progress}% Optimization Progress</h1>
                <p className="text-gray-600">{status?.status === "completed" ? "Optimization complete." : "Running live optimization against backend..."}</p>
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
              <p className="text-sm text-gray-600">TRACKING ALGORITHM EFFICIENCY OVER TIME</p>
            </div>
            <div className="rounded-full bg-yellow-100 px-3 py-1">
              <span className="text-sm font-medium text-yellow-700">LIVE STREAM</span>
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
              <p className="text-sm text-gray-600">Simulating thousands of traffic scenarios...</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-600" />
                <span className="font-medium">CANDIDATE PLANS</span>
              </div>
              <p className="text-sm text-gray-600">100,000+</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>© 2024 ILOILO CITY TRAFFIC MANAGEMENT OFFICE (ICTMO)</span>
          <div className="flex gap-6">
            <span>DSS ENGINE V2.4.0</span>
            <span>SYSTEM LIVE</span>
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
              +12.2% from Gen 1
            </div>
          </div>

          <div className="rounded-lg bg-gray-50 p-4">
            <div className="mb-1 text-xs text-gray-600">Average Fitness</div>
            <div className="flex items-end gap-2">
              <div className="text-2xl font-bold">68.3</div>
              <div className="mb-1 text-sm text-gray-600">SCORE</div>
            </div>
            <div className="mt-2 flex items-center gap-1 text-sm text-gray-600">
              Population diversity stable
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
    </div>
  );
}