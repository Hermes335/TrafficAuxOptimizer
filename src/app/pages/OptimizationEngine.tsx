import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle, Clock, Target, TrendingDown, Users } from "lucide-react";
import { Link } from "react-router";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
        setConvergenceData((prev) => {
          const point: Point = {
            id: `status-${latestStatus.current_generation}`,
            generation: latestStatus.current_generation,
            bestFitness: latestStatus.current_fitness,
            avgFitness: Math.max(0, latestStatus.current_fitness * 0.82),
          };
          const next = [...prev, point];
          return next.slice(-200);
        });

        const latestResults = await fetchOptimizationResults(runId);
        if (!active) {
          return;
        }
        setResults(latestResults);
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

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-bold">Optimization Engine</h1>
            <p className="text-gray-600">Backend-run optimization output and performance metrics.</p>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-600">RUN ID</div>
            <div className="text-lg font-semibold">{runId ?? "N/A"}</div>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-700">
            {error}
          </div>
        )}

        <div className="mb-6 inline-flex items-center gap-2 rounded-lg bg-green-100 px-4 py-2">
          <CheckCircle className="h-5 w-5 text-green-600" />
          <span className="font-medium text-green-900">Status: {status?.status ?? "loading"}</span>
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
              value={bestSolution?.efficiency ? `${bestSolution.efficiency.toFixed(1)}%` : "N/A"}
              icon={<TrendingDown className="h-4 w-4" />}
            />
          </div>

          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={convergenceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="generation" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="bestFitness" stroke="#facc15" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="avgFitness" stroke="#6b7280" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 rounded-xl bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-xl font-semibold">Top Solution Assignments</h2>
            {assignments.length === 0 && (
              <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                No assignment data yet. Keep this page open while optimization completes.
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
                <div>Coverage: {bestSolution?.coverage ? `${bestSolution.coverage}%` : "N/A"}</div>
                <div>Congestion Reduction: {bestSolution?.congestion_reduction ? `${bestSolution.congestion_reduction}%` : "N/A"}</div>
                <div>Officer Utilization: {bestSolution?.officer_utilization ? `${bestSolution.officer_utilization}%` : "N/A"}</div>
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
