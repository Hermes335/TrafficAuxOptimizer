import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle, ChevronLeft, Clock, Target, TrendingDown, Users, TrendingUp } from "lucide-react";
import { Link } from "react-router";
import PrettyCurve from "../components/PrettyCurve";
import { StatusBadge } from "../components/StatusBadge";
import { LoadingState, EmptyState } from "../components/LoadingState";
import {
  fetchOptimizationResults,
  fetchOptimizationStatus,
  type OptimizationResults,
  type OptimizationStatus,
} from "../services/backend";

interface Point {
  id: string;
  generation: number;
  bestFitness: number;
  avgFitness: number;
}

function upsertPoint(prev: Point[], nextPoint: Point) {
  const index = prev.findIndex((item) => item.generation === nextPoint.generation);
  if (index >= 0) {
    const next = [...prev];
    next[index] = nextPoint;
    return next;
  }
  return [...prev, nextPoint].slice(-200);
}

function buildConvergenceFromScores(scores: number[]): Point[] {
  let runningTotal = 0;
  return scores.map((score, index) => {
    runningTotal += score;
    return {
      id: `result-${index + 1}`,
      generation: index + 1,
      bestFitness: score,
      avgFitness: runningTotal / (index + 1),
    };
  });
}

export function OptimizationEngine() {
  const runId = useMemo(() => new URLSearchParams(window.location.search).get("run_id"), []);
  const [status, setStatus] = useState<OptimizationStatus | null>(null);
  const [results, setResults] = useState<OptimizationResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [convergenceData, setConvergenceData] = useState<Point[]>([]);

  useEffect(() => {
    if (!runId) {
      setError("Missing run_id. Start an optimization run first.");
      return;
    }

    let active = true;
    let timer: number | undefined;

    const sync = async () => {
      try {
        const latestStatus = await fetchOptimizationStatus(runId);
        if (!active) {
          return;
        }
        setStatus(latestStatus);
        setConvergenceData((prev) =>
          upsertPoint(prev, {
            id: `status-${latestStatus.current_generation}`,
            generation: latestStatus.current_generation,
            bestFitness: latestStatus.current_fitness,
            avgFitness: prev.length === 0
              ? latestStatus.current_fitness
              : ((prev[prev.length - 1].avgFitness * prev.length) + latestStatus.current_fitness) / (prev.length + 1),
          }),
        );

        const latestResults = await fetchOptimizationResults(runId);
        if (!active) {
          return;
        }
        setResults(latestResults);

        if (Array.isArray(latestResults.fitness_scores) && latestResults.fitness_scores.length > 0) {
          const rebuilt = buildConvergenceFromScores(latestResults.fitness_scores);
          setConvergenceData(rebuilt.slice(-200));
        }

        if (latestStatus.status === "completed" || latestStatus.status === "failed") {
          if (timer) {
            window.clearInterval(timer);
            timer = undefined;
          }
        }
      } catch (syncError: unknown) {
        if (!active) {
          return;
        }
        const message = syncError instanceof Error ? syncError.message : "Failed to fetch optimization results";
        setError(message);
      }
    };

    sync();
    timer = window.setInterval(sync, 2000);

    return () => {
      active = false;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, [runId]);

  const progress = useMemo(() => {
    if (!status || status.total_generations <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((status.current_generation / status.total_generations) * 100));
  }, [status]);

  const bestSolution = results?.top_solutions?.[0];
  const assignments = bestSolution?.assignments ?? [];
  const statusToneClass =
    status?.status === "completed"
      ? "bg-green-100 text-green-700"
      : status?.status === "failed"
        ? "bg-red-100 text-red-700"
        : status?.status === "cancelled"
          ? "bg-gray-100 text-gray-700"
        : "bg-yellow-100 text-yellow-700";

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-bold">Optimization Engine</h1>
            <p className="text-gray-600">Backend-run optimization output and performance metrics.</p>
          </div>
          <div className="text-right">
            <div className="mb-2 flex justify-end gap-2">
              <Link
                to={runId ? `/optimization-running?run_id=${encodeURIComponent(runId)}` : "/optimization-running"}
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Link>
              <Link
                to="/optimization"
                className="inline-flex items-center rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                New Run
              </Link>
            </div>
            <div className="text-sm text-gray-600">RUN ID</div>
            <div className="text-lg font-semibold">{runId ?? "Pending"}</div>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-700">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          </div>
        )}

        <div className="mb-6 flex items-center gap-3">
          <StatusBadge status={status?.status || "queued"} size="md" />
          <span className="text-sm text-gray-600">Run ID: <code className="font-mono font-semibold">{runId ?? "Pending"}</code></span>
        </div>

        <div className="mb-8 rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-4 grid grid-cols-4 gap-4">
            <StatCard label="Progress" value={`${progress}%`} icon={<Clock className="h-4 w-4" />} />
            <StatCard
              label="Best Fitness"
              value={status ? status.current_fitness.toFixed(2) : "0.00"}
              icon={<Target className="h-4 w-4" />}
            />
            <StatCard
              label="Generations"
              value={`${status?.current_generation ?? 0}/${status?.total_generations ?? 0}`}
              icon={<Users className="h-4 w-4" />}
            />
            <StatCard
              label="Predicted Efficiency"
              value={bestSolution?.efficiency ? `${bestSolution.efficiency.toFixed(1)}%` : "pending"}
              icon={<TrendingDown className="h-4 w-4" />}
            />
          </div>

          {/* Convergence Chart Section */}
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-yellow-500" />
                <h3 className="font-semibold">Fitness Convergence</h3>
              </div>
              <p className="text-sm text-gray-600">Best fitness achieved across all generations</p>
            </div>

            {/* Legend */}
            <div className="flex gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-yellow-400" />
                <span className="text-gray-700">Best Fitness (Per Generation)</span>
              </div>
            </div>

            <div className="h-80">
              <PrettyCurve 
                values={convergenceData.map((p) => p.bestFitness)} 
                color="#facc15" 
                yAxisFormatter={(v) => v.toFixed(1)}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 rounded-xl bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-xl font-semibold">Top Solution Assignments</h2>
            {assignments.length === 0 && (
              <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                Awaiting backend solution assignments.
              </div>
            )}
            <div className="space-y-3">
              {assignments.map((assignment, index) => (
                <div key={`${assignment.bottleneck_id ?? "b"}-${index}`} className="rounded-lg border p-4">
                  <div className="mb-1 text-xs text-gray-500">{assignment.bottleneck_id ?? "BOTTLENECK"}</div>
                  <div className="font-medium">{assignment.bottleneck_name ?? "Unknown"}</div>
                  <div className="mt-1 text-sm text-gray-600">
                    Required: {assignment.required_officers ?? 0} | Assigned: {assignment.officers?.length ?? 0}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <h3 className="mb-3 font-semibold">Solution Summary</h3>
              <div className="space-y-2 text-sm text-gray-700">
                <div>Coverage: {bestSolution?.coverage ? `${bestSolution.coverage}%` : "pending"}</div>
                <div>Congestion Reduction: {bestSolution?.congestion_reduction ? `${bestSolution.congestion_reduction}%` : "pending"}</div>
                <div>Officer Utilization: {bestSolution?.officer_utilization ? `${bestSolution.officer_utilization}%` : "pending"}</div>
              </div>
            </div>

            <Link
              to="/gantt-chart"
              className="block rounded-lg bg-yellow-400 px-4 py-3 text-center font-semibold text-white hover:bg-yellow-500"
            >
              Open Deployment Schedule
            </Link>

            <Link
              to="/optimization"
              className="block rounded-lg border px-4 py-3 text-center font-medium text-gray-700 hover:bg-gray-50"
            >
              Start New Optimization
            </Link>
          </div>
        </div>

        {!runId && (
          <div className="mt-6 flex items-center gap-2 text-sm text-amber-700">
            <AlertCircle className="h-4 w-4" />
            Start from Optimization to create a run and automatically open this page with a run id.
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-1 flex items-center gap-2 text-xs text-gray-600">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
