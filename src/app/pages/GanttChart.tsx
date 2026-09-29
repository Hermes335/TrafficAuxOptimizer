import { PublishScheduleButton } from "../components/PublishScheduleButton";
import { ScheduleHistory } from "../components/ScheduleHistory";
import { RecommendationExportButton } from "../components/RecommendationExportButton";
import { useAuth } from "../contexts/AuthContext";
import { operationalDate, operationalTime } from "../services/operationalTime";
import { BarChart3, CalendarDays, ChevronDown, ChevronLeft, ChevronUp, Download, XCircle } from "lucide-react";
import { GanttTimeline } from "./GanttChart/GanttTimeline";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorFeedback } from "../components/ErrorFeedback";
import {
  clearDeploymentSchedule,
  fetchBottlenecks,
  fetchDashboardOfficers,
  fetchDeploymentSchedule,
  fetchOptimizationHistory,
  subscribeToDashboardStream,
  type BottleneckOption,
  type DashboardOfficerRecord,
  type DeploymentScheduleItem,
  type OptimizationHistoryItem,
} from "../services/backend";

export function GanttChart() {
  const { user } = useAuth();
  const canManage = user?.role === "supervisor" || user?.role === "administrator";
  const [day, setDay] = useState(operationalDate());
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [connection, setConnection] = useState("connecting");
  const topCollapseStorageKey = "gantt-chart-top-collapsed";
  const bottomCollapseStorageKey = "gantt-chart-bottom-collapsed";

  const [schedule, setSchedule] = useState<DeploymentScheduleItem[]>([]);
  const [bottlenecks, setBottlenecks] = useState<BottleneckOption[]>([]);
  const [officers, setOfficers] = useState<DashboardOfficerRecord[]>([]);
  const [query, setQuery] = useState("");
  const [shiftFilter, setShiftFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [runPage, setRunPage] = useState(1);
  const [runCount, setRunCount] = useState(0);
  const [completedRuns, setCompletedRuns] = useState<OptimizationHistoryItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const selectedRun = completedRuns.find(run => run.run_id === selectedRunId);
  const selectedRunSyntheticSources = selectedRun?.result_data?.synthetic_data_used;
  const [clearingSchedule, setClearingSchedule] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const [ganttViewMode, setGanttViewMode] = useState<"officer" | "bottleneck">("officer");
  const [topCollapsed, setTopCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem(topCollapseStorageKey) === "true";
  });
  const [bottomCollapsed, setBottomCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem(bottomCollapseStorageKey) === "true";
  });

  useEffect(() => {
    let active = true;

    Promise.allSettled([fetchDeploymentSchedule(day), fetchBottlenecks(), fetchDashboardOfficers(), fetchOptimizationHistory(runPage, "completed")])
      .then(([deployments, bottleneckRows, officerRows, optimizationRuns]) => {
        if (!active) {
          return;
        }
        const failures = [deployments, bottleneckRows, officerRows, optimizationRuns].flatMap((row, i) => row.status === "rejected" ? [`${["Schedule", "Locations", "Officers", "Run history"][i]}: ${row.reason instanceof Error ? row.reason.message : "Refresh failed"}`] : []);
        setError(failures.join(" · ") || null);
        if (deployments.status === "fulfilled") { setSchedule(deployments.value); setLastRefresh(new Date().toISOString()); }
        if (bottleneckRows.status === "fulfilled") setBottlenecks(bottleneckRows.value);
        if (officerRows.status === "fulfilled") setOfficers(officerRows.value);
        if (optimizationRuns.status === "fulfilled") {
          setRunCount(optimizationRuns.value.count);
          const completed = optimizationRuns.value.results.filter(run => run.status === "completed");
          setCompletedRuns(completed);
          setSelectedRunId(previous => completed.some(run => run.run_id === previous) ? previous : completed[0]?.run_id ?? "");
        }
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return;
        }
        const message = loadError instanceof Error ? loadError.message : "Failed to load schedule";
        setError(message);
      });

    return () => {
      active = false;
    };
  }, [day, refreshKey, runPage]);

  useEffect(() => {
    const timer = window.setInterval(() => setRefreshKey(k => k + 1), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => subscribeToDashboardStream(event => {
    if (["deployment_changed", "optimization_complete", "officers_updated", "bottlenecks_updated"].includes(event.event)) setRefreshKey(k => k + 1);
  }, undefined, state => { setConnection(state); if (state === "live") setRefreshKey(k => k + 1); }), []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(topCollapseStorageKey, String(topCollapsed));
    }
  }, [topCollapsed]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(bottomCollapseStorageKey, String(bottomCollapsed));
    }
  }, [bottomCollapsed]);

  const groupedByBottleneck = useMemo(() => {
    const map = new Map<string, DeploymentScheduleItem[]>();
    schedule.filter(d => d.status === "assigned" && (shiftFilter === "all" || d.shift === shiftFilter)).forEach((item) => {
      const list = map.get(item.bottleneck) ?? [];
      list.push(item);
      map.set(item.bottleneck, list);
    });
    return map;
  }, [schedule, shiftFilter]);

  const filteredSchedule = useMemo(() => {
    const term = query.trim().toLowerCase();
    return schedule.filter((item) => {
      const matchesTerm =
        !term ||
        item.officer.toLowerCase().includes(term) ||
        item.officer_name.toLowerCase().includes(term) ||
        item.bottleneck.toString().toLowerCase().includes(term) ||
        item.assignment_type.toLowerCase().includes(term) ||
        item.status.toLowerCase().includes(term);
      const matchesShift = shiftFilter === "all" || item.shift === shiftFilter;
      return matchesTerm && matchesShift;
    });
  }, [schedule, query, shiftFilter]);

  const coverage = useMemo(() => {
    if (bottlenecks.length === 0) {
      return { covered: 0, total: 0, percent: 0 };
    }
    const covered = bottlenecks.filter((b) => (groupedByBottleneck.get(b.id)?.length ?? 0) > 0).length;
    return {
      covered,
      total: bottlenecks.length,
      percent: Math.round((covered / bottlenecks.length) * 100),
    };
  }, [bottlenecks, groupedByBottleneck]);

  const activeScope = useMemo(() => schedule.filter(item => item.status === "assigned" && (shiftFilter === "all" || item.shift === shiftFilter)), [schedule, shiftFilter]);
  const activeAssignments = activeScope.length;
  const assignedOfficerCodes = useMemo(() => new Set(activeScope.map(item => item.officer)), [activeScope]);
  const availableOfficerPool = useMemo(
    () => officers.filter((officer) => (shiftFilter === "all" || officer.shift === shiftFilter) && officer.status !== "off_duty" && officer.status !== "unavailable" && !assignedOfficerCodes.has(officer.badge_number)),
    [officers, assignedOfficerCodes, shiftFilter],
  );

  const hourSlots = useMemo(() => Array.from({ length: shiftFilter === "all" ? 16 : 8 }, (_, idx) => (shiftFilter === "afternoon" ? 14 : 6) + idx), [shiftFilter]);
  const matrixRows = useMemo(() => {
    const bottleneckRows = bottlenecks;
    return bottleneckRows.map((row) => {
      const rowAssignments = schedule.filter(assignment => assignment.bottleneck === row.id && ["assigned", "completed"].includes(assignment.status) && (shiftFilter === "all" || assignment.shift === shiftFilter));
      const cells = hourSlots.map((hour) => {
        const overlapCount = rowAssignments.filter((assignment) => {
          const instant = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00+08:00`).getTime();
          return new Date(assignment.start_time).getTime() <= instant && instant < new Date(assignment.end_time).getTime();
        }).length;
        return overlapCount;
      });
      return { row, cells };
    });
  }, [bottlenecks, schedule, shiftFilter, hourSlots, day]);

  const matrixLegend = [
    { label: "2+ officers", className: "bg-yellow-400" },
    { label: "1 officer", className: "bg-yellow-200" },
    { label: "No officers", className: "bg-rose-100" },
  ];

  const reloadSchedule = async () => {
    const rows = await fetchDeploymentSchedule(day);
    setSchedule(rows);
  };

  const clearScheduleConfirmed = async () => {
    setClearingSchedule(true);
    setPublishError(null);
    setPublishNotice(null);
    try {
      const result = await clearDeploymentSchedule(shiftFilter !== "all" ? shiftFilter : undefined, day);
      await reloadSchedule();
      setPublishNotice(`Cleared ${result.cleared} deployment${result.cleared === 1 ? "" : "s"}.`);
    } catch (clearError: unknown) {
      setPublishError(clearError instanceof Error ? clearError.message : "Failed to clear deployment schedule. Try again after checking backend logs.");
    } finally {
      setClearingSchedule(false);
    }
  };

  const onExport = () => {
    const rows = [
      ["bottleneck", "officer", "shift", "start_time", "end_time", "type", "status"],
      ...filteredSchedule.map((item) => [
        item.bottleneck,
        `${item.officer} - ${item.officer_name}`,
        item.shift,
        item.start_time,
        item.end_time,
        item.assignment_type,
        item.status,
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "deployment-schedule.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const formattedToday = day + " · Asia/Manila";

  const selectedShiftLabel = shiftFilter === "all" ? "All Shifts" : `Shift ${shiftFilter[0].toUpperCase()}${shiftFilter.slice(1)}`;

  return (
    <div className="flex h-full flex-col overflow-auto bg-gray-50">
      <div className="border-b bg-white px-6 py-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            {!topCollapsed && (
              <div className="mb-2 flex items-center gap-2">
                <Link
                  to="/optimization"
                  className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back
                </Link>
              </div>
            )}
            <h1 className="text-2xl font-bold">Deployment Schedule</h1>
            {!topCollapsed && <p className="text-sm text-gray-600">Live schedule loaded from backend deployments API.</p>}
          </div>

          <div className="flex items-center gap-3">
            {!topCollapsed && (
              <>
                <button onClick={onExport} className="flex items-center gap-2 rounded-lg border px-4 py-2 hover:bg-gray-50">
                  <Download className="h-4 w-4" />
                  Export
                </button>
                <ConfirmDialog
                  title="Clear Schedule?"
                  description={`This will cancel assignments for ${day}, ${shiftFilter} shift(s). Republishing a valid run creates a new schedule.`}
                  confirmText="Clear Schedule"
                  cancelText="Cancel"
                  isDangerous
                  requiresTypedConfirmation="CLEAR_SCHEDULE"
                  onConfirm={clearScheduleConfirmed}
                  onCancel={() => setPublishError("Clear schedule cancelled. Type CLEAR_SCHEDULE next time to confirm the reset.")}
                  trigger={
                    <button
                      disabled={!canManage || clearingSchedule || activeAssignments === 0}
                      className="flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4" />
                      {clearingSchedule ? "Clearing..." : "Clear Schedule"}
                    </button>
                  }
                  disabled={!canManage || clearingSchedule || activeAssignments === 0}
                />
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Completed optimization run"
                    value={selectedRunId}
                    onChange={(event) => setSelectedRunId(event.target.value)}
                    className="rounded-lg border px-3 py-2 text-sm"
                  >
                    {completedRuns.length === 0 && <option value="">No completed runs</option>}
                    {completedRuns.map((run) => (
                      <option key={run.run_id} value={run.run_id}>
                        {run.run_id}
                      </option>
                    ))}
                  </select>
                  <button aria-label="Previous run page" disabled={runPage === 1} onClick={() => setRunPage(p => p - 1)}>‹</button>
                  <button aria-label="Older run page" disabled={runPage * 10 >= runCount} onClick={() => setRunPage(p => p + 1)}>›</button>
                  {canManage && <PublishScheduleButton runId={selectedRunId} date={day} onPublished={reloadSchedule}
                    mode={String(selectedRun?.parameters.mode ?? "operational")}
                    syntheticSources={Array.isArray(selectedRunSyntheticSources) ? selectedRunSyntheticSources : null} />}
                  <RecommendationExportButton runId={selectedRunId} />
                </div>
              </>
            )}
            <button
              onClick={() => setTopCollapsed((current) => !current)}
              className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              aria-label={topCollapsed ? "Expand top controls" : "Collapse top controls"}
            >
              {topCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              {topCollapsed ? "Expand top" : "Collapse top"}
            </button>
          </div>
        </div>

        {!topCollapsed && (
          <>
            {publishNotice && <div className="mb-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{publishNotice}</div>}
            {publishError && (
              <div className="mb-3">
                <ErrorFeedback
                  error={publishError}
                  onDismiss={() => setPublishError(null)}
                />
              </div>
            )}


            <div className="mb-3">
              <ScheduleHistory day={day} refreshKey={refreshKey} />
              <div className="text-3xl font-bold text-gray-900">{formattedToday}</div>
              <div className="text-sm text-gray-600">{selectedShiftLabel}</div>
              <label>Operational date <input type="date" value={day} onChange={e => { setSchedule([]); setDay(e.target.value); }} /></label>
              <p role="status">{connection} · Last successful refresh: {lastRefresh ? operationalTime(lastRefresh) : "Not loaded"}</p>
              <button onClick={() => setRefreshKey(k => k + 1)} className="underline">Refresh schedule</button>
            </div>

            <div className="rounded-lg border border-yellow-100 bg-yellow-50 px-4 py-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-yellow-800">
                <CalendarDays className="h-4 w-4" />
                Available Officer Pool
                <span className="text-yellow-700">{availableOfficerPool.length} Officers Unassigned</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {availableOfficerPool.slice(0, 10).map((officer) => (
                  <div key={officer.id} className="flex items-center gap-1 rounded-full border border-yellow-200 bg-white px-2 py-1 text-xs">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-yellow-300 font-semibold text-yellow-900">
                      {officer.name
                        .split(" ")
                        .map((part) => part[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <span className="font-medium text-gray-700">{officer.badge_number}</span>
                  </div>
                ))}
                {availableOfficerPool.length === 0 && <span className="text-xs text-yellow-800">No unassigned officers for current filter.</span>}
              </div>
            </div>

            <div className="rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">
              Coverage: {coverage.covered}/{coverage.total} bottlenecks with active assignments ({coverage.percent}%)
            </div>

            <div className="mt-3 grid grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg border bg-white px-3 py-2">
                <div className="text-xs text-gray-500">Active Assignments</div>
                <div className="font-semibold">{activeAssignments}</div>
              </div>
              <div className="rounded-lg border bg-white px-3 py-2">
                <div className="text-xs text-gray-500">Morning Shift</div>
                <div className="font-semibold">{activeScope.filter(d => d.shift === "morning").length}</div>
              </div>
              <div className="rounded-lg border bg-white px-3 py-2">
                <div className="text-xs text-gray-500">Afternoon Shift</div>
                <div className="font-semibold">{activeScope.filter(d => d.shift === "afternoon").length}</div>
              </div>
              <div className="rounded-lg border bg-white px-3 py-2">
                <div className="text-xs text-gray-500">Coverage</div>
                <div className="font-semibold">{coverage.percent}%</div>
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-3 md:flex-row">
              <input
                aria-label="Search schedule"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search officer, bottleneck, type, status..."
                className="w-full rounded-lg border px-3 py-2 text-sm md:flex-1"
              />
              <select
                aria-label="Viewing shift"
                value={shiftFilter}
                onChange={(event) => setShiftFilter(event.target.value)}
                className="rounded-lg border px-3 py-2 text-sm md:w-48"
              >
                <option value="all">All shifts</option>
                <option value="morning">Morning (6AM-2PM)</option>
                <option value="afternoon">Afternoon (2PM-10PM)</option>
              </select>
            </div>
          </>
        )}
      </div>

      {/* Deployment Board */}
      {filteredSchedule.length > 0 && (
        <div className="px-4 pt-4">
          <div className="mb-2 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-yellow-500" />
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Deployment Board</span>
            <div className="ml-auto flex gap-1">
              <button
                onClick={() => setGanttViewMode("officer")}
                className={`rounded px-2 py-1 text-xs font-medium ${ganttViewMode === "officer" ? "bg-yellow-400 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                By Officer
              </button>
              <button
                onClick={() => setGanttViewMode("bottleneck")}
                className={`rounded px-2 py-1 text-xs font-medium ${ganttViewMode === "bottleneck" ? "bg-yellow-400 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                By Bottleneck
              </button>
            </div>
          </div>
          <GanttTimeline deployments={filteredSchedule} viewMode={ganttViewMode} />
        </div>
      )}

      <div className="border-b border-gray-200 bg-white px-6 py-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Schedule Workspace</div>
          <button
            onClick={() => setBottomCollapsed((current) => !current)}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            aria-label={bottomCollapsed ? "Expand schedule content" : "Collapse schedule content"}
          >
            {bottomCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            {bottomCollapsed ? "Expand bottom" : "Collapse bottom"}
          </button>
        </div>
      </div>

      {error && <div className="px-6 py-4 text-sm text-red-600">{error}</div>}

      {!bottomCollapsed ? (
        <div className="flex flex-1 gap-4 overflow-hidden p-4">
          <div className="flex-1 overflow-auto rounded-xl border bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Bottleneck</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Officer</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Shift</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Start</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">End</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Type</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredSchedule.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-gray-500" colSpan={7}>
                      No deployments match the current filters.
                    </td>
                  </tr>
                )}
                {filteredSchedule.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">{item.bottleneck}</td>
                    <td className="px-4 py-3">{item.officer} - {item.officer_name}</td>
                    <td className="px-4 py-3 capitalize">{item.shift}</td>
                    <td className="px-4 py-3">{operationalTime(item.start_time)}</td>
                    <td className="px-4 py-3">{operationalTime(item.end_time)}</td>
                    <td className="px-4 py-3 capitalize">{item.assignment_type}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-1 text-xs font-medium capitalize ${
                        item.status === "assigned" ? "bg-blue-100 text-blue-700" :
                        item.status === "published" ? "bg-green-100 text-green-700" :
                        item.status === "completed" ? "bg-gray-100 text-gray-700" :
                        "bg-yellow-100 text-yellow-700"
                      }`}>
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <aside className="w-full space-y-4 overflow-y-auto lg:sticky lg:top-4 lg:h-[calc(100vh-10rem)] lg:w-80 lg:self-start">
            <div className="rounded-xl border bg-white p-4">
              <h3 className="mb-3 font-semibold">Coverage Matrix</h3>
              <p className="mb-2 text-xs text-gray-500">Officers assigned at each displayed hour (Asia/Manila). Includes completed service.</p>
              <div className="space-y-1 overflow-x-auto">
                {/* Hour header */}
                <div className="grid gap-1 text-[10px] text-gray-500" style={{gridTemplateColumns: `4rem repeat(${hourSlots.length}, minmax(2rem, 1fr))`}}>
                  <div className="truncate pr-1" title="Bottleneck">BN</div>
                  {hourSlots.map((hour) => (
                    <div key={hour} className="text-center">{hour}:00</div>
                  ))}
                </div>
                {matrixRows.map(({ row, cells }) => (
                  <div key={row.id} className="grid gap-1" style={{gridTemplateColumns: `4rem repeat(${hourSlots.length}, minmax(2rem, 1fr))`}}>
                    <div className="truncate pr-1 text-[10px] font-medium text-gray-600" title={row.name ?? row.id}>
                      {(row.id ?? "").replace("bn-", "").slice(0, 6)}
                    </div>
                    {cells.map((count, index) => (
                      <div
                        key={`${row.id}-${hourSlots[index]}`}
                        className={`h-6 rounded ${count >= 2 ? "bg-yellow-400" : count === 1 ? "bg-yellow-200" : "bg-rose-100"}`}
                        title={`${row.name ?? row.id} @ ${hourSlots[index]}:00 -> ${count} officer(s)`}
                      />
                    ))}
                  </div>
                ))}
              </div>

              <div className="mt-4 space-y-1 text-xs text-gray-600">
                {matrixLegend.map((legend) => (
                  <div key={legend.label} className="flex items-center gap-2">
                    <div className={`h-3 w-3 rounded ${legend.className}`} />
                    <span>{legend.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <div className="px-4 py-4">
          <div className="flex items-center justify-between rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-gray-700">Schedule hidden</div>
              <div className="text-xs text-gray-500">Expand bottom section to view assignments and officer management.</div>
            </div>
            <button
              onClick={() => setBottomCollapsed(false)}
              className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              <ChevronDown className="h-4 w-4" />
              Expand
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
