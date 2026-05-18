import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle, ChevronLeft, Clock, Target, TrendingDown, Users, TrendingUp } from "lucide-react";
import { ResponsiveContainer, ComposedChart, Scatter, Cell, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import { Link } from "react-router";
import PrettyCurve from "../components/PrettyCurve";
import { StatusBadge } from "../components/StatusBadge";
import { LoadingState, EmptyState } from "../components/LoadingState";
import {
  fetchOptimizationResults,
  fetchOptimizationStatus,
  publishDeploymentsFromOptimization,
  type OptimizationResults,
  type OptimizationStatus,
} from "../services/backend";
import { type ConvergencePoint, upsertConvergencePoint, getRunStatusToneClass } from "../types/optimization";

function buildConvergenceFromScores(scores: number[]): ConvergencePoint[] {
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
  const [convergenceData, setConvergenceData] = useState<ConvergencePoint[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);

  const onPublish = async () => {
    if (!runId) return;
    setPublishing(true);
    setPublishError(null);
    setPublishNotice(null);
    try {
      const result = await publishDeploymentsFromOptimization({ run_id: runId, shift: "afternoon", replace_existing: true });
      setPublishNotice(`Published ${result.created} deployments.`);
    } catch (e: unknown) {
      setPublishError(e instanceof Error ? e.message : "Failed to publish.");
    } finally {
      setPublishing(false);
    }
  };

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
          upsertConvergencePoint(prev, {
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
  const statusToneClass = getRunStatusToneClass(status?.status);

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
          <div className="min-w-0">
            <h1 className="mb-2 text-3xl font-bold">Optimization Engine</h1>
            <p className="text-gray-600">Backend-run optimization output and performance metrics.</p>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="mb-2 flex justify-end gap-2">
              <Link
                to="/optimization"
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Back to Optimization
              </Link>
              <Link
                to="/optimization"
                className="inline-flex items-center rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                New Run
              </Link>
              <span /> {/* spacer */}
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

        <div className="mb-6 flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0">
            <StatusBadge status={status?.status || "queued"} size="md" />
          </div>
          <span className="text-sm text-gray-600 min-w-0">Run ID: <code className="font-mono font-semibold">{runId ?? "Pending"}</code></span>
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
              label="Coverage Efficiency"
              value={bestSolution?.coverage_efficiency ? `${bestSolution.coverage_efficiency.toFixed(1)}%` : "pending"}
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
                <span className="text-gray-700">Best Fitness</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-gray-400" />
                <span className="text-gray-700">Average Fitness</span>
              </div>
            </div>

            <div className="h-80">
              <PrettyCurve
                values={convergenceData.map((p) => p.bestFitness)}
                secondaryValues={convergenceData.map((p) => p.avgFitness)}
                color="#facc15"
                colorSecondary="#9ca3af"
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
              {/* Group assignments by bottleneck */}
              {(() => {
                const grouped = new Map<string, typeof assignments>();
                for (const a of assignments) {
                  const key = a.bottleneck_id ?? "unknown";
                  const existing = grouped.get(key) ?? [];
                  existing.push(a);
                  grouped.set(key, existing);
                }
                return Array.from(grouped.entries()).map(([bnId, officers]) => (
                  <div key={bnId} className="rounded-lg border p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <div>
                        <div className="text-xs text-gray-500">{bnId}</div>
                        <div className="font-medium">{officers[0]?.bottleneck_name ?? "Unknown"}</div>
                      </div>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {officers.length} officer{officers.length > 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {officers.map((a, i) => (
                        <span key={i} className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                          {a.badge_number ?? "N/A"}
                        </span>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <h3 className="mb-3 font-semibold">Solution Summary</h3>
              <div className="space-y-2 text-sm text-gray-700">
                <div>Coverage Efficiency: {bestSolution?.coverage_efficiency ? `${bestSolution.coverage_efficiency.toFixed(1)}%` : "pending"}</div>
                <div>Avg Response Time: {bestSolution?.avg_response_time ? `${bestSolution.avg_response_time.toFixed(1)} min` : "pending"}</div>
                <div>Resource Utilization: {bestSolution?.resource_utilization ? `${bestSolution.resource_utilization.toFixed(1)}%` : "pending"}</div>
                <div>Road Priority Coverage: {bestSolution?.road_priority_coverage ? `${bestSolution.road_priority_coverage.toFixed(1)}%` : "pending"}</div>
              </div>
            </div>

            {/* Pareto Front Visualization */}
            {results?.pareto_curve_data && results.pareto_curve_data.length > 0 && (
              <div className="rounded-xl bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-yellow-500" />
                  <h2 className="font-semibold">Pareto Front (Trade-off Analysis)</h2>
                </div>
                <p className="mb-4 text-sm text-gray-600">
                  Each point represents a non-dominated solution. X = coverage efficiency, Y = response time efficiency.
                </p>

                {/* Scatter Chart */}
                <div className="mb-4 h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2ff" />
                      <XAxis
                        type="number"
                        dataKey="coverage_efficiency"
                        domain={[0, 100]}
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        label={{ value: "Coverage Efficiency (%)", position: "insideBottom", offset: -4, fontSize: 11, fill: "#6b7280" }}
                      />
                      <YAxis
                        type="number"
                        dataKey="inverse_response_time"
                        domain={[0, 100]}
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        width={45}
                        label={{ value: "Response Time Score (%)", angle: -90, position: "insideLeft", fontSize: 11, fill: "#6b7280" }}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0].payload;
                          return (
                            <div className="rounded border bg-white p-3 text-sm shadow-lg">
                              <div className="font-semibold mb-1">Solution</div>
                              <div>Coverage: {p.coverage_efficiency?.toFixed(1)}%</div>
                              <div>Response Score: {p.inverse_response_time?.toFixed(1)}%</div>
                              <div>Weather: {p.weather_responsiveness?.toFixed(1)}%</div>
                              <div>Balance: {p.resource_balance?.toFixed(1)}%</div>
                            </div>
                          );
                        }}
                      />
                      <Scatter
                        data={results.pareto_curve_data.map((p, i) => ({ ...p, index: i }))}
                        fill="#facc15"
                        stroke="#d97706"
                        strokeWidth={2}
                      >
                        {results.pareto_curve_data.map((point, i) => {
                          const balance = point.resource_balance ?? 50;
                          const fill = balance >= 70 ? "#22c55e" : balance >= 40 ? "#facc15" : "#ef4444";
                          return <Cell key={i} fill={fill} />;
                        })}
                      </Scatter>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Legend for scatter */}
                <div className="mb-4 flex gap-4 text-xs">
                  <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded-full bg-green-500" /> High Balance (70%+)</div>
                  <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded-full bg-yellow-400" /> Medium (40-70%)</div>
                  <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded-full bg-red-500" /> Low Balance (&lt;40%)</div>
                </div>

                {/* Data Table */}
                <div className="grid grid-cols-5 gap-2 text-xs font-medium text-gray-500 mb-2">
                  <span>Solution</span>
                  <span>Coverage</span>
                  <span>Response</span>
                  <span>Weather</span>
                  <span>Balance</span>
                </div>
                {results.pareto_curve_data.map((point, i) => {
                  const balanceColor = (point.resource_balance ?? 0) >= 70 ? "text-green-600" : (point.resource_balance ?? 0) >= 40 ? "text-yellow-600" : "text-red-600";
                  return (
                    <div key={i} className="grid grid-cols-5 gap-2 border-t py-2 text-sm">
                      <span className="font-medium text-gray-900">#{i + 1}</span>
                      <span>{point.coverage?.toFixed(1) ?? point.coverage_efficiency?.toFixed(1) ?? "—"}%</span>
                      <span>{point.inverse_response_time?.toFixed(1) ?? "—"}%</span>
                      <span>{point.weather_responsiveness?.toFixed(1) ?? "—"}%</span>
                      <span className={balanceColor}>{point.resource_balance?.toFixed(1) ?? "—"}%</span>
                    </div>
                  );
                })}
                {results.converged_early && (
                  <div className="mt-3 rounded-lg bg-green-50 p-2 text-xs text-green-700">
                    Converged early — hypervolume stabilized, no further improvement detected.
                  </div>
                )}
                {results.synthetic_data_used && results.synthetic_data_used.length > 0 && (
                  <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
                    Synthetic data used for: {results.synthetic_data_used.join(", ")}. Results are approximate.
                  </div>
                )}
              </div>
            )}

            {status?.status === "completed" && (
              <div className="rounded-xl bg-white p-6 shadow-sm">
                <h2 className="mb-3 font-semibold">Publish Deployment</h2>
                <p className="mb-3 text-sm text-gray-600">
                  Publish the top solution as the deployment schedule for this shift.
                </p>
                <button
                  onClick={onPublish}
                  disabled={publishing}
                  className="w-full rounded-lg bg-yellow-400 px-4 py-3 font-semibold text-white hover:bg-yellow-500 disabled:opacity-50"
                >
                  {publishing ? "Publishing..." : "Publish to Schedule"}
                </button>
                {publishError && <p className="mt-2 text-sm text-red-600">{publishError}</p>}
                {publishNotice && <p className="mt-2 text-sm text-green-600">{publishNotice}</p>}
              </div>
            )}

            <Link
              to="/gantt-chart"
              className="block rounded-lg border border-yellow-400 px-4 py-3 text-center font-medium text-yellow-700 hover:bg-yellow-50"
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
