import { RememberedDetails } from "../components/RememberedDetails";
import { OptimizationDetailsSection, MeasuredResultChart } from "../components/OptimizationDetailsSection";
import { RunPublicationStatus } from "../components/RunPublicationStatus";
import { PublishScheduleButton } from "../components/PublishScheduleButton";
import { RecommendationExportButton } from "../components/RecommendationExportButton";
import { operationalTime } from "../services/operationalTime";
import { useAuth } from "../contexts/AuthContext";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronLeft, Clock, Target, TrendingDown, Users, TrendingUp } from "lucide-react";
import { ResponsiveContainer, ComposedChart, Scatter, Cell, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import { Link, useLocation } from "react-router";
import PrettyCurve from "../components/PrettyCurve";
import { StatusBadge } from "../components/StatusBadge";
import { officerSkillLabel } from "../services/officerSkills";
import { describeTravelOrigin } from "../services/travelTimeModel";
import { OptimizationScoreBreakdown } from "../components/OptimizationScoreBreakdown";
import {
  fetchOptimizationResults,
  fetchOptimizationStatus,
  subscribeToDashboardStream,
  type OptimizationResults,
  type OptimizationStatus,
} from "../services/backend";
import { type ConvergencePoint, upsertConvergencePoint, getOptimizationProgress, getOptimizationCompletionSummary } from "../types/optimization";

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
  const { user } = useAuth();
  const canManage = user?.role === "supervisor" || user?.role === "administrator";
  const location = useLocation();
  const runId = useMemo(() => new URLSearchParams(location.search || window.location.search).get("run_id"), [location.search]);
  const [status, setStatus] = useState<OptimizationStatus | null>(null);
  const [results, setResults] = useState<OptimizationResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [convergenceData, setConvergenceData] = useState<ConvergencePoint[]>([]);
  const [publicationUnavailable, setPublicationUnavailable] = useState(false);

  useEffect(() => {
    if (!runId) {
      setError("No recommendation selected. Choose a saved run or start a new optimization.");
      return;
    }

    let active = true;
    let timer: number | undefined;
    let inFlight = false;
    let pendingRefresh = false;
    let terminal = false;
    let savedResultsLoaded = false;
    setStatus(null);
    setResults(null);
    setConvergenceData([]);
    setPublicationUnavailable(false);
    setError(null);

    const sync = async () => {
      if (!active) return;
      if (inFlight) { pendingRefresh = true; return; }
      inFlight = true;
      if (timer) window.clearTimeout(timer);
      try {
        // Terminal execution is immutable; only publication provenance changes.
        // Read it through results without regressing completed progress.
        const latestStatus = terminal ? null : await fetchOptimizationStatus(runId);
        if (!active) {
          return;
        }
        if (latestStatus) setStatus(latestStatus);
        // Completion reports the finalized schedule score, not a GA generation.
        // Saved fitness_scores below are authoritative for the search curve.
        if (latestStatus?.status === "running" && Number.isInteger(latestStatus.current_generation) && latestStatus.current_generation > 0 && Number.isFinite(latestStatus.current_fitness)) {
          setConvergenceData((prev) => {
            const next = upsertConvergencePoint(prev, {
              id: `status-${latestStatus.current_generation}`,
              generation: latestStatus.current_generation,
              bestFitness: latestStatus.current_fitness,
              avgFitness: 0,
            }).sort((left, right) => left.generation - right.generation);
            let total = 0;
            return next.map((point, index) => {
              total += point.bestFitness;
              return {...point, avgFitness: total / (index + 1)};
            });
          });
        }

        const latestResults = await fetchOptimizationResults(runId);
        if (!active) {
          return;
        }
        setResults(latestResults);
        savedResultsLoaded = true;
        setError(null);
        setPublicationUnavailable(false);

        if (Array.isArray(latestResults.fitness_scores) && latestResults.fitness_scores.length > 0) {
          const rebuilt = buildConvergenceFromScores(latestResults.fitness_scores);
          setConvergenceData(rebuilt.slice(-200));
        }

        terminal = terminal || !!latestStatus && ["completed", "failed", "cancelled"].includes(latestStatus.status);
      } catch (syncError: unknown) {
        if (!active) {
          return;
        }
        const message = syncError instanceof Error ? syncError.message : "Failed to fetch optimization results";
        setError(savedResultsLoaded ? `Could not refresh saved results: ${message}` : message);
        setPublicationUnavailable(true);
      } finally {
        // Wait for both responses before polling again. A slow older request
        // cannot overwrite newer results or revert a terminal run to running.
        inFlight = false;
        if (active && pendingRefresh) { pendingRefresh = false; void sync(); }
        else if (active) timer = window.setTimeout(() => { if (!document.hidden) void sync(); }, terminal ? 60000 : 2000);
      }
    };

    void sync();
    const refresh = () => { void sync(); };
    const onVisible = () => { if (!document.hidden) refresh(); };
    window.addEventListener("deployment-publication-changed", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const stopStream = subscribeToDashboardStream(event => {
      if (["deployment_changed", "optimization_complete"].includes(event.event)) refresh();
    });

    return () => {
      active = false;
      pendingRefresh = false;
      stopStream?.();
      window.removeEventListener("deployment-publication-changed", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [runId]);

  const progress = getOptimizationProgress(status);
  const completionSummary = getOptimizationCompletionSummary(status);

  const bestSolution = results?.top_solutions?.[0];
  const assignments = bestSolution?.assignments ?? [];
  const planningWindow = results?.input_snapshot?.planning_window;
  const shiftStart = results?.parameters?.operational_date && results.parameters.shift
    ? Date.parse(`${results.parameters.operational_date}T${results.parameters.shift === "morning" ? "06" : "14"}:00:00+08:00`) : null;
  const plansRemainingShift = planningWindow?.mode === "operational" && shiftStart !== null && Date.parse(planningWindow.start_time) > shiftStart;
  const officerKeys = assignments.map(assignment => assignment.officer_id ?? assignment.badge_number);
  const assignedOfficerCount = officerKeys.every(key => key != null) ? new Set(officerKeys).size : null;
  const shortageLocations = bestSolution?.staffing_shortages
    ? Object.values(bestSolution.staffing_shortages).filter(count => count > 0).length : null;

  return (
    <div className="h-full min-w-0 overflow-y-auto bg-gray-50 p-4 [overflow-wrap:anywhere] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
          <div className="min-w-0">
            <h1 className="mb-2 text-3xl font-bold">Recommendation results</h1>
            <p className="text-gray-600">Review the saved staffing plan and its supporting information.</p>
          </div>
          <div className="w-full min-w-0 sm:w-auto sm:max-w-full sm:text-right">
            <div className="mb-2 flex justify-end gap-2">
              <Link
                to={canManage ? "/optimization" : "/gantt-chart"}
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <ChevronLeft className="h-4 w-4" />
                {canManage ? "Back to Optimization" : "Back to schedule"}
              </Link>
            </div>
            <div className="text-sm text-gray-600">RUN ID</div>
            <div className="break-all text-sm font-semibold sm:text-base">{runId ?? "Pending"}</div>
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-700">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          </div>
        )}

        <div className="mb-6 flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex-shrink-0">
            <StatusBadge status={status?.status || "queued"} size="md" />
          </div>
          <span className="min-w-0 break-all text-xs text-gray-600 sm:text-sm">Run ID: <code className="font-mono font-semibold">{runId ?? "Pending"}</code></span>
        </div>

        <section aria-label="Recommendation overview" className="mb-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="mb-3 text-lg font-semibold">Saved recommendation</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm lg:grid-cols-4">
            <div><dt className="text-xs text-slate-500">Operational date · Manila</dt><dd className="mt-1 font-medium">{results?.parameters?.operational_date ?? "Not recorded"}</dd></div>
            <div><dt className="text-xs text-slate-500">Shift</dt><dd className="mt-1 font-medium">{results?.parameters?.shift === "morning" ? "Morning · 6 AM–2 PM" : results?.parameters?.shift === "afternoon" ? "Afternoon · 2 PM–10 PM" : "Not recorded"}</dd></div>
            <div><dt className="text-xs text-slate-500">Mode</dt><dd className="mt-1 font-medium">{results?.parameters?.mode === "shadow" ? "Shadow comparison" : results?.parameters?.mode === "operational" ? "Operational deployment" : "Not recorded"}</dd></div>
            <div><dt className="text-xs text-slate-500">Assigned officers</dt><dd className="mt-1 font-medium">{bestSolution ? assignedOfficerCount ?? "Not recorded" : "Pending"}</dd></div>
          </dl>
          {results?.parameters?.session_id && <p className="mt-3 text-sm text-slate-600">Field session: <span className="font-medium text-slate-900">{results.parameters.session_id}</span></p>}
          {bestSolution && <p className={`mt-3 text-sm ${shortageLocations ? "text-amber-800" : "text-slate-600"}`}>Staffing gaps: {shortageLocations === null ? "not recorded for this run" : shortageLocations === 0 ? "none recorded" : `${shortageLocations} location${shortageLocations === 1 ? "" : "s"}; review the shortages below`}.{bestSolution.reserve_officers != null ? ` ${bestSolution.time_periods?.length ? "Minimum officers in reserve" : "Officers in reserve"}: ${bestSolution.reserve_officers}.` : ""}</p>}
          {canManage && status?.status === "completed" && results && (
            <div role="group" aria-label="Recommendation actions" className="mt-4 border-t border-slate-200 pt-4">
              <p className="mb-3 text-sm text-slate-600">{results?.parameters?.mode === "shadow" ? "Shadow comparisons can be exported and cannot be published." : "Preview checks eligibility and proposed changes. The schedule changes only after you confirm publication."}</p>
              <div className="flex flex-wrap items-start gap-2">
                <PublishScheduleButton runId={runId ?? ""} date={results?.parameters?.operational_date} mode={results?.parameters?.mode} syntheticSources={results?.synthetic_data_used} />
                <RecommendationExportButton runId={runId ?? ""} />
              </div>
            </div>
          )}
        </section>

        {runId && <RunPublicationStatus publicationState={results?.publication_state} unavailable={publicationUnavailable}
          onRefresh={() => window.dispatchEvent(new Event("deployment-publication-changed"))} />}

        {planningWindow && <section aria-label="Saved planning window" className="mb-6 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
          <h2 className="font-semibold">{planningWindow.mode === "shadow" ? "Full shift · Shadow comparison" : plansRemainingShift ? "Remaining shift planning" : "Planning window"}</h2>
          <p className="mt-1">{results?.parameters?.operational_date ? `${results.parameters.operational_date} · ` : ""}{operationalTime(planningWindow.start_time)}–{operationalTime(planningWindow.end_time)} · Asia/Manila</p>
          {plansRemainingShift && <p className="mt-2 text-xs">This saved recommendation covers the remaining shift. Earlier assignments are outside this planning window.</p>}
          {planningWindow.mode === "operational" && planningWindow.review_lead_seconds > 0 && <p className="mt-2 text-xs">The run allowed {planningWindow.review_lead_seconds / 60} minutes for review before its planned start. Review and confirmation are still required to publish.</p>}
          {planningWindow.mode === "shadow" && <p className="mt-2 text-xs">This comparison covers the full selected shift and cannot be published.</p>}
        </section>}

        <div className="mb-6 min-w-0 rounded-xl bg-white p-3 shadow-sm sm:p-6">
          <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard label="Progress" value={`${progress}%`} icon={<Clock className="h-4 w-4" />} />
            <StatCard
              label={status?.status === "completed" ? "Final schedule score" : "Search fitness"}
              value={bestSolution?.fitness != null ? bestSolution.fitness.toFixed(2) : status ? status.current_fitness.toFixed(2) : "0.00"}
              icon={<Target className="h-4 w-4" />}
            />
            <StatCard
              label="Generations"
              value={`${status?.current_generation ?? 0} (max ${status?.total_generations ?? 0})`}
              icon={<Users className="h-4 w-4" />}
            />
            <StatCard
              label="Location coverage"
              value={bestSolution?.coverage_efficiency != null ? `${bestSolution.coverage_efficiency.toFixed(1)}%` : "pending"}
              icon={<TrendingDown className="h-4 w-4" />}
            />
          </div>

          {completionSummary && <p className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{completionSummary}</p>}

        </div>

        <div className="mb-6 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-6">
          <div className="min-w-0 rounded-xl bg-white p-4 shadow-sm sm:p-6 xl:col-span-2">
            <h2 className="mb-4 text-xl font-semibold">Recommended assignments</h2>
            {assignments.length > 0 && <p className="mb-4 text-xs leading-relaxed text-gray-600">Skills are a preference, alongside coverage and assignment constraints. Explanations reflect the saved run{results?.input_snapshot?.skill_policy_version ? ` (${results.input_snapshot.skill_policy_version})` : ""}.</p>}
            {assignments.length === 0 && (
              <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                {bestSolution?.time_periods?.length && bestSolution.time_periods.every(p=>p.requirements.every(r=>r.required===0))
                  ? "No officers required for this shift. Officers remain available."
                  : "Assignments are not available yet."}
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
                  <div key={bnId} className="min-w-0 rounded-lg border p-3 sm:p-4">
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-xs text-gray-500">{bnId}</div>
                        <div className="font-medium">{officers[0]?.bottleneck_name ?? "Unknown"}</div>
                      </div>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {new Set(officers.map(o=>o.officer_id)).size} officer{new Set(officers.map(o=>o.officer_id)).size !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {bestSolution?.staffing_targets?.[bnId] != null && <p className="mb-2 text-xs text-gray-600">
                      {bestSolution.time_periods?.length ? "Peak staffing target" : "Staffing target"}: {bestSolution.staffing_targets[bnId]} officers
                    </p>}
                    <div className="flex flex-wrap gap-2">
                      {officers.map((a, i) => (
                        <span key={i} className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                          {a.badge_number ?? "N/A"}
                          {a.start_time && a.end_time ? ` · ${operationalTime(a.start_time)}–${operationalTime(a.end_time)}` : ""}
                        </span>
                      ))}
                    </div>
                    <details className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
                      <summary className="cursor-pointer font-medium text-slate-700">Skill preferences</summary>
                      <ul className="mt-2 space-y-3 text-slate-600">
                        {officers.map((assignment, index) => <li key={index} className="space-y-1">
                          <p className="font-medium text-slate-800">{assignment.badge_number ?? `Officer ${assignment.officer_id ?? "unknown"}`}{assignment.start_time && assignment.end_time ? ` · ${operationalTime(assignment.start_time)}–${operationalTime(assignment.end_time)}` : ""}</p>
                          {assignment.skill_match ? <>
                            <p>{assignment.skill_match.status === "matched" ? `Recorded skill match: ${assignment.skill_match.matched_skills.map(officerSkillLabel).join(", ")}.` : assignment.skill_match.status === "not_applicable" ? "No specific skill preference." : "No recorded skill match."}</p>
                            <p>{assignment.skill_match.explanation}</p>
                          </> : <p>Skills were not assessed for this saved assignment.</p>}
                        </li>)}
                      </ul>
                    </details>
                  </div>
                ));
              })()}
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            <div className="min-w-0 rounded-xl bg-white p-4 shadow-sm sm:p-6">
              <h3 className="mb-3 font-semibold">Solution Summary</h3>
              <p className="mb-3 text-xs text-gray-600">Travel time is a model estimate using congestion-adjusted speed and straight-line distance. {describeTravelOrigin(results?.input_snapshot?.travel_time_model)} Location coverage counts distinct nodes.</p>
              <p className="mb-3 text-sm">Unfilled staffing requirements: {bestSolution?.staffing_shortages ? Object.entries(bestSolution.staffing_shortages).map(([node, count]) => `${node}: ${count}`).join(", ") || "None" : "Unavailable in this saved run"}</p>
              <div className="space-y-2 text-sm text-gray-700">
                <div>Coverage: {bestSolution?.coverage_efficiency != null ? `${bestSolution.coverage_efficiency.toFixed(1)}%` : "pending"}</div>
                <div>Estimated travel: {bestSolution?.avg_response_time != null ? `${bestSolution.avg_response_time.toFixed(1)} min` : "pending"}</div>
                <div>Roster utilization: {bestSolution?.resource_utilization != null ? `${bestSolution.resource_utilization.toFixed(1)}%` : "pending"}</div>
                {bestSolution?.staffing_efficiency != null && <div>Staffing efficiency: {bestSolution.staffing_efficiency.toFixed(1)}%</div>}
                {bestSolution?.reserve_officers != null && <div>{bestSolution.time_periods?.length ? "Minimum officers in reserve" : "Officers in reserve"}: {bestSolution.reserve_officers}</div>}
                <div>Road priority: {bestSolution?.road_priority_coverage != null ? `${bestSolution.road_priority_coverage.toFixed(1)}%` : "pending"}</div>
              </div>
            </div>

            {bestSolution?.time_periods?.length ? <div className="rounded-xl bg-white p-5 shadow-sm">
              <h3 className="mb-3 font-semibold">Staffing by time · Asia/Manila</h3>
              <p className="mb-3 text-xs text-gray-500">Unassigned officers remain available. Zero required is a valid period. Travel gaps are reserved when an officer changes intersections.</p>
              {bestSolution.time_periods.map(period=><div key={period.start_time} className="border-t py-3 text-sm">
                <strong>{operationalTime(period.start_time)}–{operationalTime(period.end_time)}</strong>
                <p>{period.assigned_officers} assigned · {period.reserve_officers} available</p>
                <RememberedDetails stateKey={`results.period.${runId}.${period.start_time}`} className="mt-1 text-xs"><summary className="cursor-pointer">Requirements and reasons</summary>{period.requirements.map(r=><p key={r.bottleneck_id} className="mt-1">{r.bottleneck_id}: {r.required} required · {r.reason}</p>)}</RememberedDetails>
              </div>)}
            </div> : null}

            {results?.input_snapshot && <RememberedDetails stateKey={`results.sources.${runId}`} className="rounded-xl bg-white p-4">
              <summary className="cursor-pointer font-semibold">Input sources and freshness</summary>
              <p className="mt-2 text-xs">Captured: {results.input_snapshot.captured_at}</p>
              <p className="text-sm">Weather: {results.input_snapshot.weather.source} · {results.input_snapshot.weather.data_status}
                {results.input_snapshot.weather.is_stale ? " · stale" : ""}
                {results.input_snapshot.weather.is_synthetic ? " · simulated" : ""}
              </p>
              {results.input_snapshot.weather.assumption && <p className="text-sm">{results.input_snapshot.weather.assumption}</p>}
              <ul className="mt-2 space-y-2 text-xs">{results.input_snapshot.bottlenecks.map(b => <li key={b.id}>
                {b.id}: TSI {b.tsi}, priority {b.road_priority_weight} · {b.provenance.source} · {b.provenance.data_status}
                {b.provenance.is_stale ? " · stale" : ""}{b.provenance.is_synthetic ? " · simulated" : ""}
                {b.provenance.observed_at ? ` · observed ${b.provenance.observed_at}` : " · observation time unavailable"}
              </li>)}</ul>
            </RememberedDetails>}
            <Link
              to={results?.parameters?.operational_date ? `/gantt-chart?${new URLSearchParams({date: results.parameters.operational_date,
                ...(results.parameters.shift ? {shift: results.parameters.shift} : {})})}` : "/gantt-chart"}
              className="block rounded-lg border border-yellow-400 px-4 py-3 text-center font-medium text-yellow-700 hover:bg-yellow-50"
            >
              Open current deployment schedule
            </Link>

            {canManage && <Link
              to="/optimization"
              className="block rounded-lg border px-4 py-3 text-center font-medium text-gray-700 hover:bg-gray-50"
            >
              Start New Optimization
            </Link>}
          </div>
        </div>

        {runId && <OptimizationDetailsSection key={runId} runId={runId}>
          {/* Convergence Chart Section */}
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-yellow-500" />
                <h3 className="font-semibold">Search Fitness Convergence</h3>
              </div>
              <p className="text-sm text-gray-600">Recorded GA search scores by generation.</p>
              {status?.status === "completed" && <p className="mt-2 text-xs leading-relaxed text-slate-500">The final schedule is scored after officer matching and across planning periods. Its score is shown separately and is not an extra generation.</p>}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-yellow-400" />
                <span className="text-gray-700">Search fitness per generation</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-gray-400" />
                <span className="text-gray-700">Running mean of search fitness</span>
              </div>
            </div>

            <MeasuredResultChart className="h-64 min-w-0 sm:h-80">
              <PrettyCurve
                generations={convergenceData.map((p) => p.generation)}
                values={convergenceData.map((p) => p.bestFitness)}
                secondaryValues={convergenceData.map((p) => p.avgFitness)}
                color="#facc15"
                colorSecondary="#9ca3af"
                yAxisFormatter={(v) => v.toFixed(1)}
              />
            </MeasuredResultChart>
          </div>
          {bestSolution && <OptimizationScoreBreakdown breakdown={bestSolution.score_breakdown} />}
            {/* Pareto Front Visualization */}
            {results?.pareto_curve_data && results.pareto_curve_data.length > 0 && (
              <div className="min-w-0 rounded-xl bg-white p-4 shadow-sm sm:p-6">
                <div className="mb-4 flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-yellow-500" />
                  <h2 className="font-semibold">Pareto Front (Trade-off Analysis)</h2>
                </div>
                <p className="mb-4 text-sm text-gray-600">
                  Each point represents a non-dominated solution. X = coverage efficiency, Y = response time efficiency.
                </p>

                {/* Scatter Chart */}
                <MeasuredResultChart className="mb-4 h-64 w-full">
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
                </MeasuredResultChart>

                {/* Legend for scatter */}
                <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-xs">
                  <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded-full bg-green-500" /> High Balance (70%+)</div>
                  <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded-full bg-yellow-400" /> Medium (40-70%)</div>
                  <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded-full bg-red-500" /> Low Balance (&lt;40%)</div>
                </div>

                {/* Data Table */}
                <div className="mb-2 hidden grid-cols-5 gap-2 text-xs font-medium text-gray-500 md:grid">
                  <span>Solution</span>
                  <span>Coverage</span>
                  <span>Response</span>
                  <span>Weather</span>
                  <span>Balance</span>
                </div>
                {results.pareto_curve_data.map((point, i) => {
                  const balanceColor = (point.resource_balance ?? 0) >= 70 ? "text-green-600" : (point.resource_balance ?? 0) >= 40 ? "text-yellow-600" : "text-red-600";
                  return (
                    <div key={i} className="grid grid-cols-2 gap-x-4 gap-y-2 border-t py-3 text-sm md:grid-cols-5 md:gap-2 md:py-2">
                      <span className="col-span-2 font-medium text-gray-900 md:col-span-1"><span className="md:hidden">Solution </span>#{i + 1}</span>
                      <span><span className="block text-xs text-gray-500 md:hidden">Coverage</span>{point.coverage?.toFixed(1) ?? point.coverage_efficiency?.toFixed(1) ?? "—"}%</span>
                      <span><span className="block text-xs text-gray-500 md:hidden">Response</span>{point.inverse_response_time?.toFixed(1) ?? "—"}%</span>
                      <span><span className="block text-xs text-gray-500 md:hidden">Weather</span>{point.weather_responsiveness?.toFixed(1) ?? "—"}%</span>
                      <span className={balanceColor}><span className="block text-xs text-gray-500 md:hidden">Balance</span>{point.resource_balance?.toFixed(1) ?? "—"}%</span>
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

        </OptimizationDetailsSection>}

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
      <div className="mb-1 flex items-start gap-2 text-xs text-gray-600 [&_svg]:shrink-0">
        {icon}
        <span>{label}</span>
      </div>
      <div className="break-words text-xl font-bold sm:text-2xl">{value}</div>
    </div>
  );
}
