import { BarChart3, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Filter, Pencil, Trash2, UserPlus, UserRound, XCircle } from "lucide-react";
import { GanttTimeline } from "./GanttChart/GanttTimeline";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorFeedback } from "../components/ErrorFeedback";
import { useOfficerManagement } from "../hooks/useOfficerManagement";
import {
  clearDeploymentSchedule,
  fetchBottlenecks,
  fetchDashboardOfficers,
  fetchDeploymentSchedule,
  fetchOptimizationHistory,
  publishDeploymentsFromOptimization,
  type BottleneckOption,
  type DashboardOfficerRecord,
  type DeploymentScheduleItem,
  type OptimizationHistoryItem,
} from "../services/backend";

export function GanttChart() {
  const topCollapseStorageKey = "gantt-chart-top-collapsed";
  const bottomCollapseStorageKey = "gantt-chart-bottom-collapsed";

  const [schedule, setSchedule] = useState<DeploymentScheduleItem[]>([]);
  const [scheduleSnapshot, setScheduleSnapshot] = useState<DeploymentScheduleItem[] | null>(null);
  const [bottlenecks, setBottlenecks] = useState<BottleneckOption[]>([]);
  const [officers, setOfficers] = useState<DashboardOfficerRecord[]>([]);
  const [query, setQuery] = useState("");
  const [shiftFilter, setShiftFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const reloadOfficers = async () => {
    const rows = await fetchDashboardOfficers();
    setOfficers(rows);
  };
  const officerMgmt = useOfficerManagement({ reloadOfficers });
  const [completedRuns, setCompletedRuns] = useState<OptimizationHistoryItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [publishingSchedule, setPublishingSchedule] = useState(false);
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

  const restorePreviousSchedule = () => {
    if (!scheduleSnapshot) {
      setPublishError("No previous schedule snapshot is available to restore.");
      return;
    }

    setSchedule(scheduleSnapshot);
    setPublishNotice("Restored the previous schedule view locally. Refresh to re-sync with the backend.");
    setPublishError(null);
  };

  useEffect(() => {
    let active = true;

    Promise.all([fetchDeploymentSchedule(), fetchBottlenecks(), fetchDashboardOfficers(), fetchOptimizationHistory()])
      .then(([deployments, bottleneckRows, officerRows, optimizationRuns]) => {
        if (!active) {
          return;
        }
        setSchedule(deployments);
        setBottlenecks(bottleneckRows);
        setOfficers(officerRows);
        const completed = optimizationRuns.filter((run) => run.status === "completed");
        setCompletedRuns(completed);
        if (completed.length > 0) {
          setSelectedRunId(completed[0].run_id);
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
  }, []);

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
    schedule.forEach((item) => {
      const list = map.get(item.bottleneck) ?? [];
      list.push(item);
      map.set(item.bottleneck, list);
    });
    return map;
  }, [schedule]);

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

  const activeAssignments = filteredSchedule.length;
  const assignedOfficerCodes = useMemo(() => new Set(filteredSchedule.map((item) => item.officer)), [filteredSchedule]);
  const availableOfficerPool = useMemo(
    () => officers.filter((officer) => officer.status !== "off_duty" && officer.status !== "unavailable" && !assignedOfficerCodes.has(officer.badge_number)),
    [officers, assignedOfficerCodes],
  );

  const hourSlots = useMemo(() => Array.from({ length: 9 }, (_, idx) => 14 + idx), []);
  const matrixRows = useMemo(() => {
    const bottleneckRows = bottlenecks.slice(0, 8);
    return bottleneckRows.map((row) => {
      const rowAssignments = filteredSchedule.filter((assignment) => assignment.bottleneck === row.id);
      const cells = hourSlots.map((hour) => {
        const overlapCount = rowAssignments.filter((assignment) => {
          const startHour = new Date(assignment.start_time).getHours();
          const endHour = new Date(assignment.end_time).getHours();
          return startHour <= hour && endHour > hour;
        }).length;
        return overlapCount;
      });
      return { row, cells };
    });
  }, [bottlenecks, filteredSchedule, hourSlots]);

  const matrixLegend = [
    { label: "Optimal (2+ Officers)", className: "bg-yellow-400" },
    { label: "Sufficient (1 Officer)", className: "bg-yellow-200" },
    { label: "Critical (0 Officers)", className: "bg-rose-100" },
  ];

  const reloadSchedule = async () => {
    const rows = await fetchDeploymentSchedule();
    setSchedule(rows);
  };

  const onPublishSchedule = async () => {
    if (!selectedRunId) {
      setPublishError("Select a completed optimization run first.");
      return;
    }

    setScheduleSnapshot(schedule);
    setPublishingSchedule(true);
    setPublishError(null);
    setPublishNotice(null);
    try {
      const result = await publishDeploymentsFromOptimization({
        run_id: selectedRunId,
        shift: shiftFilter === "all" ? "afternoon" : (shiftFilter as "morning" | "afternoon"),
        replace_existing: true,
      });
      await reloadSchedule();
      setPublishNotice(`Published ${result.created} deployments from ${selectedRunId}.`);
      if (result.skipped.length > 0) {
        setPublishError(`${result.skipped.length} assignments were skipped due to missing officer or bottleneck.`);
      }
    } catch (publishActionError: unknown) {
      setPublishError(
        publishActionError instanceof Error ? publishActionError.message : "Failed to publish optimization schedule.",
      );
    } finally {
      setPublishingSchedule(false);
    }
  };

  const clearScheduleConfirmed = async () => {
    setScheduleSnapshot(schedule);
    setClearingSchedule(true);
    setPublishError(null);
    setPublishNotice(null);
    try {
      const result = await clearDeploymentSchedule(shiftFilter !== "all" ? shiftFilter : undefined);
      await reloadSchedule();
      setPublishNotice(`Cleared ${result.cleared} deployment${result.cleared === 1 ? "" : "s"}.`);
    } catch (clearError: unknown) {
      setPublishError(clearError instanceof Error ? clearError.message : "Failed to clear deployment schedule. Try again after checking backend logs.");
    } finally {
      setClearingSchedule(false);
    }
  };

  // used by retry paths (no typed confirmation) to directly attempt clear
  const onClearSchedule = async () => {
    await clearScheduleConfirmed();
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

  const formattedToday = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  const selectedShiftLabel = shiftFilter === "all" ? "All Shifts" : `Shift ${shiftFilter[0].toUpperCase()}${shiftFilter.slice(1)}`;

  return (
    <div className="flex h-full flex-col bg-gray-50">
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
                <button className="flex items-center gap-2 rounded-lg border px-4 py-2 hover:bg-gray-50">
                  <Filter className="h-4 w-4" />
                  Filter
                </button>
                <button onClick={onExport} className="flex items-center gap-2 rounded-lg border px-4 py-2 hover:bg-gray-50">
                  <Download className="h-4 w-4" />
                  Export
                </button>
                <ConfirmDialog
                  title="Clear Schedule?"
                  description="This will remove all active deployments. This action can be undone by restoring the previous schedule snapshot for this session."
                  confirmText="Clear Schedule"
                  cancelText="Cancel"
                  isDangerous
                  requiresTypedConfirmation="CLEAR_SCHEDULE"
                  onConfirm={clearScheduleConfirmed}
                  onCancel={() => setPublishError("Clear schedule cancelled. Type CLEAR_SCHEDULE next time to confirm the reset.")}
                  trigger={
                    <button
                      disabled={clearingSchedule || filteredSchedule.length === 0}
                      className="flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4" />
                      {clearingSchedule ? "Clearing..." : "Clear Schedule"}
                    </button>
                  }
                  disabled={clearingSchedule || filteredSchedule.length === 0}
                />
                <div className="flex items-center gap-2">
                  <select
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
                  <button
                    onClick={onPublishSchedule}
                    disabled={publishingSchedule || completedRuns.length === 0}
                    className="rounded-lg bg-yellow-400 px-4 py-2 font-semibold text-white hover:bg-yellow-500 disabled:cursor-not-allowed disabled:bg-yellow-300"
                  >
                    {publishingSchedule ? "Publishing..." : "Publish Schedule"}
                  </button>
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
                  onRetry={publishError.toLowerCase().includes("clear") ? onClearSchedule : onPublishSchedule}
                  onDismiss={() => setPublishError(null)}
                />
              </div>
            )}

            {scheduleSnapshot && (
              <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">Rollback available</div>
                    <div className="text-xs text-blue-700">A previous schedule snapshot is cached locally for this session.</div>
                  </div>
                  <button
                    onClick={restorePreviousSchedule}
                    className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
                  >
                    Restore Previous Schedule
                  </button>
                </div>
              </div>
            )}

            <div className="mb-3 flex items-center gap-3">
              <button className="rounded border p-1.5 text-gray-600 hover:bg-gray-50">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div>
                <div className="text-3xl font-bold text-gray-900">{formattedToday}</div>
                <div className="text-sm text-gray-600">{selectedShiftLabel}</div>
              </div>
              <button className="rounded border p-1.5 text-gray-600 hover:bg-gray-50">
                <ChevronRight className="h-4 w-4" />
              </button>
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
                <div className="font-semibold">{filteredSchedule.filter((d) => d.shift === "morning").length}</div>
              </div>
              <div className="rounded-lg border bg-white px-3 py-2">
                <div className="text-xs text-gray-500">Afternoon Shift</div>
                <div className="font-semibold">{filteredSchedule.filter((d) => d.shift === "afternoon").length}</div>
              </div>
              <div className="rounded-lg border bg-white px-3 py-2">
                <div className="text-xs text-gray-500">Coverage</div>
                <div className="font-semibold">{coverage.percent}%</div>
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-3 md:flex-row">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search officer, bottleneck, type, status..."
                className="w-full rounded-lg border px-3 py-2 text-sm md:flex-1"
              />
              <select
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

      {/* Gantt Chart */}
      {filteredSchedule.length > 0 && (
        <div className="px-4 pt-4">
          <div className="mb-2 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-yellow-500" />
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Timeline View</span>
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
                    <td className="px-4 py-3">{new Date(item.start_time).toLocaleString()}</td>
                    <td className="px-4 py-3">{new Date(item.end_time).toLocaleString()}</td>
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

          <aside className="w-80 space-y-4 overflow-y-auto">
            <div className="rounded-xl border bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <UserRound className="h-5 w-5 text-yellow-500" />
                <h3 className="font-semibold">Officer Management</h3>
                <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{officers.length}</span>
              </div>

              <div className="mb-3 flex gap-2">
                <button
                  onClick={() => {
                    officerMgmt.setAddingOfficer((current: boolean) => !current);
                    officerMgmt.setEditingOfficerId(null);
                    officerMgmt.resetOfficerForm();
                    officerMgmt.setOfficerError(null);
                    officerMgmt.setOfficerNotice(null);
                  }}
                  className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium ${
                    officerMgmt.addingOfficer ? "bg-yellow-400 text-white" : "border text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {officerMgmt.addingOfficer ? "Cancel" : "Add Officer"}
                </button>
              </div>

              {officerMgmt.officerError && <p className="mb-2 text-xs text-red-600">{officerMgmt.officerError}</p>}
              {officerMgmt.officerNotice && <p className="mb-2 text-xs text-green-700">{officerMgmt.officerNotice}</p>}

              {(officerMgmt.addingOfficer || officerMgmt.editingOfficerId !== null) && (
                <div className="mb-3 space-y-2 rounded-lg border bg-gray-50 p-3">
                  <input
                    value={officerMgmt.officerName}
                    onChange={(event) => officerMgmt.setOfficerName(event.target.value)}
                    placeholder="Officer name"
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                  <input
                    value={officerMgmt.officerBadge}
                    onChange={(event) => officerMgmt.setOfficerBadge(event.target.value)}
                    placeholder="Badge number"
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={officerMgmt.officerShift}
                      onChange={(event) => officerMgmt.setOfficerShift(event.target.value as "morning" | "afternoon")}
                      className="rounded border px-2 py-1.5 text-sm"
                    >
                      <option value="morning">Morning (6AM-2PM)</option>
                      <option value="afternoon">Afternoon (2PM-10PM)</option>
                    </select>
                    <select
                      value={officerMgmt.officerStatus}
                      onChange={(event) => officerMgmt.setOfficerStatus(event.target.value as "available" | "deployed" | "off_duty" | "unavailable")}
                      className="rounded border px-2 py-1.5 text-sm"
                    >
                      <option value="available">Available</option>
                      <option value="deployed">Deployed</option>
                      <option value="off_duty">Off Duty</option>
                      <option value="unavailable">Unavailable</option>
                    </select>
                  </div>
                  <input
                    value={officerMgmt.officerSkillsInput}
                    onChange={(event) => officerMgmt.setOfficerSkillsInput(event.target.value)}
                    placeholder="Skills (comma-separated)"
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        officerMgmt.setAddingOfficer(false);
                        officerMgmt.setEditingOfficerId(null);
                        officerMgmt.resetOfficerForm();
                      }}
                      className="flex-1 rounded border px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-white"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={officerMgmt.editingOfficerId !== null ? officerMgmt.onUpdateOfficer : officerMgmt.onAddOfficer}
                      disabled={officerMgmt.savingOfficer}
                      className="flex-1 rounded bg-yellow-400 px-2 py-1.5 text-sm font-medium text-white hover:bg-yellow-500 disabled:cursor-not-allowed disabled:bg-yellow-300"
                    >
                      {officerMgmt.savingOfficer ? "Saving..." : officerMgmt.editingOfficerId !== null ? "Update" : "Create"}
                    </button>
                  </div>
                </div>
              )}

              <div className="max-h-48 space-y-2 overflow-y-auto">
                {officers.length === 0 && <p className="text-xs text-gray-500">No officers available.</p>}
                {officers.map((officer) => (
                  <div key={officer.id} className="rounded border p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-gray-900">{officer.name}</div>
                        <div className="text-gray-600">{officer.badge_number}</div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => officerMgmt.startEditingOfficer(officer)}
                          className="rounded p-1 text-gray-500 hover:bg-blue-50 hover:text-blue-600"
                          title="Edit officer"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => officerMgmt.onDeleteOfficer(officer.id, officer.badge_number)}
                          disabled={officerMgmt.deletingOfficerId === officer.id}
                          className="rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                          title="Remove officer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-gray-600">
                      <span className="capitalize">{officer.shift}</span>
                      <span>|</span>
                      <span className="capitalize">{officer.status.replace("_", " ")}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border bg-white p-4">
              <h3 className="mb-3 font-semibold">Coverage Matrix</h3>
              <div className="space-y-1">
                {/* Hour header */}
                <div className="grid grid-cols-10 gap-1 text-[10px] text-gray-500">
                  <div className="truncate pr-1" title="Bottleneck">BN</div>
                  {hourSlots.map((hour) => (
                    <div key={hour} className="text-center">{hour}:00</div>
                  ))}
                </div>
                {matrixRows.map(({ row, cells }) => (
                  <div key={row.id} className="grid grid-cols-10 gap-1">
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
