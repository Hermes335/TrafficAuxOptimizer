import { RememberedDetails } from "../components/RememberedDetails";
import { usePageState } from "../contexts/PageStateContext";
import { PublishScheduleButton } from "../components/PublishScheduleButton";
import { ScheduleHistory } from "../components/ScheduleHistory";
import { ScheduleProvenance } from "../components/ScheduleProvenance";
import { RecommendationExportButton } from "../components/RecommendationExportButton";
import { useAuth } from "../contexts/AuthContext";
import { operationalDate, operationalTime } from "../services/operationalTime";
import { BarChart3, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Filter, RefreshCw, XCircle } from "lucide-react";
import { GanttTimeline } from "./GanttChart/GanttTimeline";
import { AssignmentEditor, StaffingEditor } from "./GanttChart/ScheduleEditors";
import { OperationsPanel } from "./GanttChart/OperationsPanel";
import { AreaFilter, inArea } from "../components/AreaFilter";
import type { OfficerTimeBlock } from "../services/backend";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
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
  const location = useLocation();
  const { user } = useAuth();
  const canManage = user?.role === "supervisor" || user?.role === "administrator";
  const [day, setDay] = usePageState("schedule.day", operationalDate());
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [locationsLoaded, setLocationsLoaded] = useState(false);
  const [officersLoaded, setOfficersLoaded] = useState(false);
  const [connection, setConnection] = useState("connecting");
  const topCollapseStorageKey = "gantt-chart-tools-collapsed";
  const bottomCollapseStorageKey = "gantt-chart-bottom-collapsed";

  const [schedule, setSchedule] = useState<DeploymentScheduleItem[]>([]);
  const [bottlenecks, setBottlenecks] = useState<BottleneckOption[]>([]);
  const [officers, setOfficers] = useState<DashboardOfficerRecord[]>([]);
  const [query, setQuery] = usePageState("schedule.query", "");
  const [filtersExpanded, setFiltersExpanded] = usePageState("schedule.filtersExpanded", false);
  const [area,setArea]=usePageState("schedule.area", "");
  const [blocks,setBlocks]=useState<OfficerTimeBlock[]>([]);
  const [shiftFilter, setShiftFilter] = usePageState<string>("schedule.shiftFilter", "all");
  const [error, setError] = useState<string | null>(null);
  const [runPage, setRunPage] = usePageState("schedule.runPage", 1);
  const [runCount, setRunCount] = useState(0);
  const [completedRuns, setCompletedRuns] = useState<OptimizationHistoryItem[]>([]);
  const [selectedRunId, setSelectedRunId] = usePageState("schedule.selectedRunId", "");
  const selectedRun = completedRuns.find(run => run.run_id === selectedRunId);
  const selectedRunSyntheticSources = selectedRun?.result_data?.synthetic_data_used;
  const [clearingSchedule, setClearingSchedule] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const [ganttViewMode, setGanttViewMode] = usePageState<"officer" | "bottleneck">("schedule.ganttViewMode", "officer");
  const [editingAssignment,setEditingAssignment] = usePageState<DeploymentScheduleItem|null|undefined>("schedule.editingAssignment", undefined);
  const [editingStaffing,setEditingStaffing] = usePageState("schedule.editingStaffing", false);
  const [topCollapsed, setTopCollapsed] = usePageState<boolean>("schedule.topCollapsed", () => {
    if (typeof window === "undefined") {
      return true;
    }
    return window.localStorage.getItem(topCollapseStorageKey) !== "false";
  });
  const [bottomCollapsed, setBottomCollapsed] = usePageState<boolean>("schedule.bottomCollapsed", () => {
    if (typeof window === "undefined") {
      return true;
    }
    return window.localStorage.getItem(bottomCollapseStorageKey) !== "false";
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedDay = params.get("date");
    const requestedShift = params.get("shift");
    if (requestedDay && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay)) {
      const timestamp = Date.parse(`${requestedDay}T00:00:00+08:00`);
      if (Number.isFinite(timestamp) && operationalDate(new Date(timestamp)) === requestedDay && requestedDay !== day) {
        setDay(requestedDay); setSchedule([]); setLastRefresh(null); setLocationsLoaded(false); setLoading(true);
      }
    }
    if (requestedShift && ["morning", "afternoon", "all"].includes(requestedShift)) setShiftFilter(requestedShift);
  }, [location.search, location.key]);

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.allSettled([fetchDeploymentSchedule(day), fetchBottlenecks(day,shiftFilter), fetchDashboardOfficers(), fetchOptimizationHistory(runPage, "completed")])
      .then(([deployments, bottleneckRows, officerRows, optimizationRuns]) => {
        if (!active) {
          return;
        }
        const failures = [deployments, bottleneckRows, officerRows, optimizationRuns].flatMap((row, i) => row.status === "rejected" ? [`${["Schedule", "Locations", "Officers", "Run history"][i]}: ${row.reason instanceof Error ? row.reason.message : "Refresh failed"}`] : []);
        setError(failures.join(" · ") || null);
        if (deployments.status === "fulfilled") { setSchedule(deployments.value); setLastRefresh(new Date().toISOString()); }
        if (bottleneckRows.status === "fulfilled") { setBottlenecks(bottleneckRows.value); setLocationsLoaded(true); }
        if (officerRows.status === "fulfilled") { setOfficers(officerRows.value); setOfficersLoaded(true); }
        if (optimizationRuns.status === "fulfilled") {
          setRunCount(optimizationRuns.value.count);
          const completed = optimizationRuns.value.results.filter(run => run.status === "completed");
          setCompletedRuns(completed);
          setSelectedRunId(previous => completed.some(run => run.run_id === previous) ? previous : completed[0]?.run_id ?? "");
        }
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return;
        }
        const message = loadError instanceof Error ? loadError.message : "Failed to load schedule";
        setError(message);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [day, refreshKey, runPage, shiftFilter]);

  useEffect(() => {
    const timer = window.setInterval(() => setRefreshKey(k => k + 1), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => subscribeToDashboardStream(event => {
    if (["deployment_changed", "optimization_complete", "officers_updated", "bottlenecks_updated", "incident_reported", "incident_updated", "incident_resolved", "incidents_auto_resolved", "tsi_threshold_exceeded"].includes(event.event)) setRefreshKey(k => k + 1);
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
        (item.bottleneck_name ?? "").toLowerCase().includes(term) ||
        (item.area_name ?? "").toLowerCase().includes(term) ||
        item.assignment_type.toLowerCase().includes(term) ||
        item.status.toLowerCase().includes(term);
      const matchesShift = shiftFilter === "all" || item.shift === shiftFilter;
      return matchesTerm && matchesShift && inArea(item,area);
    });
  }, [schedule, query, shiftFilter, area]);

  const coverage = useMemo(() => {
    if (bottlenecks.length === 0) {
      return { covered: 0, total: 0, percent: 0 };
    }
    const covered = bottlenecks.filter((b) => {
      if (!b.staffing_windows?.length) return (groupedByBottleneck.get(b.id)?.length ?? 0)>0;
      const rows=schedule.filter(d=>d.bottleneck===b.id&&["assigned","completed"].includes(d.status));
      return b.staffing_windows.every(w=>{
        const left=Date.parse(w.start_time),right=Date.parse(w.end_time);
        const moments=[left,...rows.flatMap(d=>[Date.parse(d.start_time),Date.parse(d.end_time)])].filter(t=>t>=left&&t<right);
        return moments.every(t=>rows.filter(d=>Date.parse(d.start_time)<=t&&t<Date.parse(d.end_time)).length>=w.required);
      });
    }).length;
    return {
      covered,
      total: bottlenecks.length,
      percent: Math.round((covered / bottlenecks.length) * 100),
    };
  }, [bottlenecks, groupedByBottleneck, schedule]);

  const activeScope = useMemo(() => schedule.filter(item => item.status === "assigned" && (shiftFilter === "all" || item.shift === shiftFilter)), [schedule, shiftFilter]);
  const activeAssignments = activeScope.length;
  const assignedOfficerCodes = useMemo(() => new Set(activeScope.map(item => item.officer)), [activeScope]);
  const availableOfficerPool = useMemo(
    () => officers.filter((officer) => (shiftFilter === "all" || officer.shift === shiftFilter) && officer.status !== "off_duty" && officer.status !== "unavailable" && !assignedOfficerCodes.has(officer.badge_number)),
    [officers, assignedOfficerCodes, shiftFilter],
  );

  const hourSlots = useMemo(() => Array.from({ length: shiftFilter === "all" ? 16 : 8 }, (_, idx) => (shiftFilter === "afternoon" ? 14 : 6) + idx), [shiftFilter]);
  const matrixRows = useMemo(() => {
    const bottleneckRows = bottlenecks.filter(n=>inArea(n,area));
    return bottleneckRows.map((row) => {
      const rowAssignments = schedule.filter(assignment => assignment.bottleneck === row.id && ["assigned", "completed"].includes(assignment.status) && (shiftFilter === "all" || assignment.shift === shiftFilter));
      const cells = hourSlots.map((hour) => {
        const overlapCount = rowAssignments.filter((assignment) => {
          const instant = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00+08:00`).getTime();
          return new Date(assignment.start_time).getTime() <= instant && instant < new Date(assignment.end_time).getTime();
        }).length;
        const instant = new Date(`${day}T${String(hour).padStart(2,"0")}:00:00+08:00`).getTime();
        const required = row.staffing_windows?.find(w=>Date.parse(w.start_time)<=instant&&instant<Date.parse(w.end_time))?.required;
        return {count:overlapCount,required};
      });
      return { row, cells };
    });
  }, [bottlenecks, schedule, shiftFilter, hourSlots, day, area]);

  const matrixLegend = [
    { label: "Requirement met", className: "bg-amber-400" },
    { label: "No officers required", className: "bg-emerald-100" },
    { label: "Below requirement", className: "bg-rose-100" },
    { label: "Requirement unavailable", className: "bg-slate-100" },
  ];

  const reloadSchedule = async () => {
    const rows = await fetchDeploymentSchedule(day);
    setSchedule(rows);
    setLastRefresh(new Date().toISOString());
    setRefreshKey(k=>k+1);
  };

  const clearScheduleConfirmed = async () => {
    setClearingSchedule(true);
    setPublishError(null);
    setPublishNotice(null);
    try {
      const result = await clearDeploymentSchedule(shiftFilter !== "all" ? shiftFilter : undefined, day);
      setPublishNotice(`Cleared ${result.cleared} deployment${result.cleared === 1 ? "" : "s"}.`);
      try { await reloadSchedule(); }
      catch { setPublishError("The schedule was cleared, but the display could not be refreshed. Refresh the schedule to see the current records."); }
    } catch (clearError: unknown) {
      throw new Error(clearError instanceof Error ? clearError.message : "Failed to clear deployment schedule. Please try again.");
    } finally {
      setClearingSchedule(false);
    }
  };

  const onExport = () => {
    const rows = [
      ["bottleneck", "officer", "shift", "start_time", "end_time", "type", "status", "area", "override_reason"],
      ...filteredSchedule.map((item) => [
        item.bottleneck,
        `${item.officer} - ${item.officer_name}`,
        item.shift,
        item.start_time,
        item.end_time,
        item.assignment_type,
        item.status,
        item.area_name ?? "", item.override_reason ?? "",
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/^[=+@\-]/,"'$&").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "deployment-schedule.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const activeFilterCount = Number(Boolean(area)) + Number(Boolean(query.trim()));
  const coverageAvailable = Boolean(lastRefresh) && locationsLoaded;
  const officerPoolAvailable = Boolean(lastRefresh) && officersLoaded;

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto overflow-x-hidden bg-slate-50 text-slate-900">
      <header className="shrink-0 space-y-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Link to={canManage ? "/optimization" : "/"} title={canManage ? "Back to optimization" : "Back to dashboard"} aria-label={canManage ? "Back to optimization" : "Back to dashboard"}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Deployment Schedule</h1>
              <p className="text-xs text-slate-600">Assignment times in Asia/Manila</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onExport} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50">
              <Download className="h-4 w-4" /> Export
            </button>
            <button onClick={() => setTopCollapsed(current => !current)} aria-expanded={!topCollapsed} aria-controls="schedule-tools"
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${topCollapsed ? "border-slate-200 hover:bg-slate-50" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
              Schedule tools
              {topCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-0 flex-1 gap-1 text-xs font-medium text-slate-600 sm:flex-none">
            Operational date
            <input type="date" value={day} onChange={e => { if (e.target.value && e.target.value !== day) { setSchedule([]); setLastRefresh(null); setLocationsLoaded(false); setLoading(true); setDay(e.target.value); } }}
              className="h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900" />
          </label>
          <label className="grid min-w-0 flex-1 gap-1 text-xs font-medium text-slate-600 sm:flex-none">
            Shift
            <select aria-label="Viewing shift" value={shiftFilter} onChange={event => { setLocationsLoaded(false); setShiftFilter(event.target.value); }}
              className="h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900">
              <option value="all">All shifts</option>
              <option value="morning">Morning (6AM–2PM)</option>
              <option value="afternoon">Afternoon (2PM–10PM)</option>
            </select>
          </label>
          <button onClick={() => setFiltersExpanded(current => !current)} aria-expanded={filtersExpanded} aria-controls="schedule-filters"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium md:hidden">
            <Filter className="h-4 w-4" /> Filters{activeFilterCount > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-xs text-amber-900">{activeFilterCount}</span>}
          </button>
          <div id="schedule-filters" className={`${filtersExpanded ? "flex" : "hidden"} w-full min-w-0 flex-wrap items-center gap-2 md:flex md:w-auto md:flex-1`}>
            <div className="max-w-full [&_label]:flex-wrap [&_select]:min-w-0 [&_select]:max-w-full [&_select]:rounded-lg [&_select]:border-slate-200">
              <AreaFilter nodes={bottlenecks} value={area} onChange={setArea} />
            </div>
            <input aria-label="Search schedule" value={query} onChange={event => setQuery(event.target.value)}
              placeholder="Search officers or intersections…"
              className="h-10 min-w-0 flex-1 basis-52 rounded-lg border border-slate-200 px-3 text-sm placeholder:text-slate-600" />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span><strong className="font-semibold text-slate-900">{lastRefresh ? activeAssignments : "—"}</strong> assignments</span>
            <span><strong className="font-semibold text-slate-900">{coverageAvailable ? `${coverage.percent}%` : "—"}</strong> coverage{coverageAvailable && <span> · {coverage.covered}/{coverage.total} intersections</span>}</span>
            <span><strong className="font-semibold text-slate-900">{officerPoolAvailable ? availableOfficerPool.length : "—"}</strong> unassigned officers</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p role="status" className="inline-flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${connection === "live" ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden="true" />
              <span className="capitalize">{connection}</span>
              <span>· {lastRefresh ? `Updated ${operationalTime(lastRefresh)}${loading ? " · Refreshing…" : ""}` : loading ? "Loading schedule…" : "Schedule unavailable"}</span>
            </p>
            <button onClick={() => setRefreshKey(k => k + 1)} title="Refresh schedule" aria-label="Refresh schedule"
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "motion-safe:animate-spin" : ""}`} /></button>
          </div>
        </div>

        <details className="text-xs text-slate-600">
          <summary className="inline-flex min-h-9 cursor-pointer items-center font-medium">How coverage is calculated</summary>
          <p className="max-w-3xl pb-2 leading-relaxed">Coverage summarizes all areas for {shiftFilter === "all" ? "both shifts" : `the ${shiftFilter} shift`} on {day}. It measures the selected period rather than staffing at this moment. Intersections with saved staffing periods must meet the requirement throughout those periods; zero required counts as covered. For locations without staffing periods, coverage means at least one assigned officer. Area and search filters narrow the timeline and assignment list.</p>
        </details>
        {publishNotice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{publishNotice}</div>}
        {publishError && <ErrorFeedback error={publishError} onDismiss={() => setPublishError(null)} />}
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {!topCollapsed && (
          <div id="schedule-tools" className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid min-w-0 flex-1 basis-64 gap-1.5 text-xs font-medium text-slate-600">
                Completed optimization run
                <select aria-label="Completed optimization run" value={selectedRunId} title={selectedRunId}
                  onChange={event => setSelectedRunId(event.target.value)}
                  className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900">
                  {completedRuns.length === 0 && <option value="">{loading ? "Loading completed runs…" : "No completed runs"}</option>}
                  {completedRuns.map(run => <option key={run.run_id} value={run.run_id} title={run.run_id}>
                    {run.run_id.length > 30 ? `${run.run_id.slice(0, 18)}…${run.run_id.slice(-8)}` : run.run_id}
                  </option>)}
                </select>
              </label>
              <div className="flex items-center gap-1">
                <button aria-label="Previous run page" disabled={runPage === 1} onClick={() => setRunPage(p => p - 1)}
                  className="inline-flex h-10 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                <button aria-label="Older run page" disabled={runPage * 10 >= runCount} onClick={() => setRunPage(p => p + 1)}
                  className="inline-flex h-10 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              </div>
              {canManage && <PublishScheduleButton runId={selectedRunId} date={day} onPublished={reloadSchedule}
                mode={String(selectedRun?.parameters.mode ?? "operational")}
                syntheticSources={Array.isArray(selectedRunSyntheticSources) ? selectedRunSyntheticSources : null} />}
              <RecommendationExportButton runId={selectedRunId} />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <ScheduleHistory day={day} refreshKey={refreshKey} />
              <RememberedDetails stateKey="schedule.staffingSummary" className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                <summary className="cursor-pointer font-medium">Staffing summary · {coverageAvailable ? `${coverage.covered}/${coverage.total} intersections covered` : loading ? "Loading…" : "Unavailable"}</summary>
                <div className="mt-3 space-y-3 text-sm text-slate-600">
                  <p>Coverage counts intersections meeting staffing requirements. Zero required is valid coverage.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-slate-50 p-2">Morning <strong className="ml-1 text-slate-900">{lastRefresh ? activeScope.filter(d => d.shift === "morning").length : "—"}</strong></div>
                    <div className="rounded-lg bg-slate-50 p-2">Afternoon <strong className="ml-1 text-slate-900">{lastRefresh ? activeScope.filter(d => d.shift === "afternoon").length : "—"}</strong></div>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                    <p className="font-medium">{officerPoolAvailable ? availableOfficerPool.length : "—"} officers without scheduled assignments</p>
                    <p className="mt-1 text-xs">No scheduled posts in the selected shift. Gaps in each Gantt row show additional availability.</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {officerPoolAvailable && availableOfficerPool.slice(0, 10).map(officer => <span key={officer.id} title={officer.name} className="rounded-md border border-amber-200 bg-white px-2 py-1 text-xs font-medium">{officer.badge_number}</span>)}
                      {officerPoolAvailable && availableOfficerPool.length > 10 && <span className="px-1 py-1 text-xs">+{availableOfficerPool.length - 10} more</span>}
                    </div>
                  </div>
                </div>
              </RememberedDetails>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
              <p className="text-xs text-slate-600">Clear assignments for the selected date and shift.</p>
              <ConfirmDialog title="Clear Schedule?"
                description={`This will cancel assignments for ${day}, ${shiftFilter} shift(s). Republishing a valid run creates a new schedule.`}
                confirmText="Clear Schedule" cancelText="Cancel" isDangerous requiresTypedConfirmation="CLEAR_SCHEDULE"
                onConfirm={clearScheduleConfirmed}
                onCancel={() => setPublishError("Clear schedule cancelled. Type CLEAR_SCHEDULE next time to confirm the reset.")}
                trigger={<button disabled={!canManage || clearingSchedule || activeAssignments === 0}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
                  <XCircle className="h-4 w-4" />{clearingSchedule ? "Clearing…" : "Clear schedule"}
                </button>}
                disabled={!canManage || clearingSchedule || activeAssignments === 0} />
            </div>
          </div>
        )}
      </header>

      <ScheduleProvenance key={`${day}:${shiftFilter}`} day={day} shift={shiftFilter} refreshKey={refreshKey} />
      <OperationsPanel day={day} shift={shiftFilter} area={area} nodes={bottlenecks} officers={officers} canManage={canManage} refreshKey={refreshKey} onBlocks={setBlocks} onChanged={()=>setRefreshKey(k=>k+1)}/>
      {/* Deployment Board */}
      {(
        <div className="min-w-0 shrink-0 px-4 py-3 sm:px-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <BarChart3 className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-semibold text-slate-700">Timeline</span>
            <div className="ml-auto flex items-center gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Timeline grouping">
              <button
                onClick={() => setGanttViewMode("officer")}
                aria-pressed={ganttViewMode === "officer"}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${ganttViewMode === "officer" ? "bg-amber-50 text-amber-900 shadow-sm" : "text-slate-600 hover:bg-slate-200"}`}
              >
                By Officer
              </button>
              <button
                onClick={() => setGanttViewMode("bottleneck")}
                aria-pressed={ganttViewMode === "bottleneck"}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${ganttViewMode === "bottleneck" ? "bg-amber-50 text-amber-900 shadow-sm" : "text-slate-600 hover:bg-slate-200"}`}
              >
                By Intersection
              </button>
            </div>
            {canManage && <div className="flex w-full gap-2 sm:w-auto">
              <button onClick={()=>setEditingAssignment(null)} className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-500">Add assignment</button>
              <button onClick={()=>setEditingStaffing(true)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50">Staffing periods</button>
            </div>}
          </div>
          {!lastRefresh ? <section aria-label="Deployment Gantt timeline" aria-busy={loading} className="flex min-h-48 items-center justify-center rounded-xl border border-slate-200 bg-white p-6">
            <p role="status" className="flex items-center gap-2 text-sm text-slate-600">{loading && <RefreshCw className="h-4 w-4 motion-safe:animate-spin" />}{loading ? "Loading deployment schedule…" : "Schedule could not be loaded. Refresh to try again."}</p>
          </section> : <GanttTimeline deployments={filteredSchedule} viewMode={ganttViewMode} day={day} shift={shiftFilter} blocks={blocks}
            bottlenecks={bottlenecks.filter(n=>inArea(n,area)&&(!query.trim()||`${n.name} ${n.id} ${n.area_name??""}`.toLowerCase().includes(query.toLowerCase())))}
            officers={officers.filter(o=>(!area||filteredSchedule.some(d=>d.officer===o.badge_number))&&(!query.trim()||`${o.name} ${o.badge_number}`.toLowerCase().includes(query.toLowerCase())))}
            onSelect={canManage?setEditingAssignment:undefined}/>}
        </div>
      )}

      <div className="shrink-0 px-4 pb-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="text-sm font-medium text-slate-700">Assignment list & coverage <span className="ml-1 text-xs font-normal text-slate-600">({lastRefresh ? `${filteredSchedule.length} records` : loading ? "Loading…" : "Unavailable"})</span></div>
          <button
            onClick={() => setBottomCollapsed((current) => !current)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            aria-expanded={!bottomCollapsed}
            aria-controls="schedule-records"
            aria-label={bottomCollapsed ? "Show assignment list and coverage" : "Hide assignment list and coverage"}
          >
            {bottomCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            {bottomCollapsed ? "Show details" : "Hide details"}
          </button>
        </div>
      </div>

      {!bottomCollapsed && (
        <div id="schedule-records" className="flex min-w-0 shrink-0 flex-col gap-4 px-4 pb-4 sm:px-6 xl:flex-row">
          <div className="min-w-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Bottleneck</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Officer</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Shift</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Start</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">End</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Type</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredSchedule.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-slate-600" colSpan={7}>
                      {lastRefresh ? "No deployments match the current filters." : loading ? "Loading deployments…" : "Schedule unavailable."}
                    </td>
                  </tr>
                )}
                {filteredSchedule.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">{item.area_name&&<div className="text-xs text-slate-600">{item.area_name}</div>}{item.bottleneck_name??item.bottleneck}</td>
                    <td className="px-4 py-3">{item.officer} - {item.officer_name}</td>
                    <td className="px-4 py-3 capitalize">{item.shift}</td>
                    <td className="px-4 py-3">{operationalTime(item.start_time)}</td>
                    <td className="px-4 py-3">{operationalTime(item.end_time)}</td>
                    <td className="px-4 py-3 capitalize">{item.assignment_type}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-1 text-xs font-medium capitalize ${
                        item.status === "assigned" ? "bg-blue-100 text-blue-700" :
                        item.status === "published" ? "bg-green-100 text-green-700" :
                        item.status === "completed" ? "bg-slate-100 text-slate-700" :
                        "bg-amber-100 text-amber-900"
                      }`}>
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <aside className="w-full min-w-0 space-y-4 xl:w-96 xl:shrink-0 xl:self-start">
            <div className="rounded-xl border bg-white p-4">
              <h3 className="mb-3 font-semibold">Coverage Matrix</h3>
              <p className="mb-2 text-xs text-slate-600">Officers assigned at each displayed hour (Asia/Manila). Includes completed service.</p>
              {coverageAvailable ? <div className="space-y-1 overflow-x-auto">
                {/* Hour header */}
                <div className="grid gap-1 text-[11px] text-slate-600" style={{gridTemplateColumns: `4rem repeat(${hourSlots.length}, minmax(2rem, 1fr))`}}>
                  <div className="truncate pr-1" title="Bottleneck">BN</div>
                  {hourSlots.map((hour) => (
                    <div key={hour} className="text-center">{hour}:00</div>
                  ))}
                </div>
                {matrixRows.map(({ row, cells }) => (
                  <div key={row.id} className="grid gap-1" style={{gridTemplateColumns: `4rem repeat(${hourSlots.length}, minmax(2rem, 1fr))`}}>
                    <div className="truncate pr-1 text-[11px] font-medium text-slate-600" title={row.name ?? row.id}>
                      {(row.id ?? "").replace("bn-", "").slice(0, 6)}
                    </div>
                    {cells.map(({count,required}, index) => (
                      <div
                        key={`${row.id}-${hourSlots[index]}`}
                        className={`h-6 rounded ${required == null ? "bg-slate-100" : required === 0 && count === 0 ? "bg-emerald-100" : count >= required ? "bg-amber-400" : "bg-rose-100"}`}
                        title={`${row.name ?? row.id} @ ${hourSlots[index]}:00 -> ${count} officer(s)${required == null ? "" : ` / ${required} required`}`}
                      />
                    ))}
                  </div>
                ))}
              </div> : <p className="py-3 text-sm text-slate-600">{loading ? "Loading coverage…" : "Coverage unavailable."}</p>}

              <div className="mt-4 space-y-1 text-xs text-slate-600">
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
      )}
      {canManage && locationsLoaded && officersLoaded && editingAssignment !== undefined && <AssignmentEditor assignment={editingAssignment} day={day} initialShift={shiftFilter} officers={officers} nodes={bottlenecks} onClose={()=>setEditingAssignment(undefined)} onSaved={reloadSchedule}/>}
      {canManage && locationsLoaded && editingStaffing && <StaffingEditor nodes={bottlenecks} onClose={()=>setEditingStaffing(false)} onSaved={reloadSchedule}/>}
    </div>
  );
}
