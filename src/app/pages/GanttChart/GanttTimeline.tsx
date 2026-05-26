import { useMemo } from "react";
import type { DeploymentScheduleItem } from "../../services/backend";

interface GanttTimelineProps {
  deployments: DeploymentScheduleItem[];
  viewMode: "officer" | "bottleneck";
}

const SHIFT_HOURS: Record<string, { start: number; end: number }> = {
  morning: { start: 6, end: 14 },
  afternoon: { start: 14, end: 22 },
};

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  assigned: { bg: "bg-blue-400", border: "border-blue-500", text: "text-white" },
  published: { bg: "bg-green-400", border: "border-green-500", text: "text-white" },
  completed: { bg: "bg-gray-400", border: "border-gray-500", text: "text-white" },
  default: { bg: "bg-yellow-400", border: "border-yellow-500", text: "text-gray-900" },
};

const HOUR_MARKS = Array.from({ length: 17 }, (_, i) => i + 6); // 6AM to 10PM

export function GanttTimeline({ deployments, viewMode }: GanttTimelineProps) {
  const { rows, timeRange } = useMemo(() => {
    // Group deployments by officer or bottleneck
    const grouped = new Map<string, DeploymentScheduleItem[]>();
    for (const dep of deployments) {
      const key = viewMode === "officer" ? `${dep.officer} - ${dep.officer_name}` : dep.bottleneck;
      const existing = grouped.get(key) || [];
      existing.push(dep);
      grouped.set(key, existing);
    }

    // Sort rows by name
    const sortedRows = Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));

    return {
      rows: sortedRows,
      timeRange: { start: 6, end: 22 }, // 6AM to 10PM
    };
  }, [deployments, viewMode]);

  if (deployments.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50">
        <div className="text-center">
          <div className="text-sm font-medium text-gray-500">No deployments to display</div>
          <div className="text-xs text-gray-400">Publish an optimization to see the Gantt chart</div>
        </div>
      </div>
    );
  }

  const totalHours = timeRange.end - timeRange.start; // 16 hours
  const rowHeight = 36;
  const headerHeight = 32;
  const labelWidth = 180;
  const chartHeight = headerHeight + rows.length * rowHeight + 8;

  return (
    <div className="rounded-xl border bg-white">
      {/* Header */}
      <div className="border-b px-4 py-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">
            Gantt Chart — {viewMode === "officer" ? "By Officer" : "By Bottleneck"}
          </h3>
          <div className="flex items-center gap-3 text-xs">
            {Object.entries(STATUS_COLORS).filter(([k]) => k !== "default").map(([status, colors]) => (
              <div key={status} className="flex items-center gap-1">
                <div className={`h-2.5 w-5 rounded ${colors.bg}`} />
                <span className="capitalize text-gray-600">{status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: `${labelWidth + totalHours * 60 + 16}px` }}>
          {/* Time axis header */}
          <div className="flex border-b" style={{ height: `${headerHeight}px` }}>
            <div className="flex-shrink-0 border-r bg-gray-50 px-3 py-2" style={{ width: `${labelWidth}px` }}>
              <span className="text-xs font-medium text-gray-500">
                {viewMode === "officer" ? "Officer" : "Bottleneck"}
              </span>
            </div>
            <div className="relative flex-1">
              {HOUR_MARKS.map((hour) => {
                const left = ((hour - timeRange.start) / totalHours) * 100;
                return (
                  <div
                    key={hour}
                    className="absolute top-0 flex h-full items-center border-l border-gray-100"
                    style={{ left: `${left}%` }}
                  >
                    <span className="pl-1 text-[10px] text-gray-400">
                      {hour === 0 ? "12AM" : hour < 12 ? `${hour}AM` : hour === 12 ? "12PM" : `${hour - 12}PM`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Rows */}
          {rows.map(([label, deps]) => (
            <div
              key={label}
              className="flex border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
              style={{ height: `${rowHeight}px` }}
            >
              {/* Label */}
              <div
                className="flex flex-shrink-0 items-center border-r bg-gray-50/50 px-3"
                style={{ width: `${labelWidth}px` }}
              >
                <span className="truncate text-xs font-medium text-gray-700" title={label}>
                  {label}
                </span>
              </div>

              {/* Timeline bars */}
              <div className="relative flex-1">
                {/* Hour grid lines */}
                {HOUR_MARKS.map((hour) => (
                  <div
                    key={hour}
                    className="absolute top-0 h-full border-l border-gray-100"
                    style={{ left: `${((hour - timeRange.start) / totalHours) * 100}%` }}
                  />
                ))}

                {/* Deployment bars */}
                {deps.map((dep) => {
                  const shiftHours = SHIFT_HOURS[dep.shift] || SHIFT_HOURS.morning;
                  const barStart = ((shiftHours.start - timeRange.start) / totalHours) * 100;
                  const barWidth = ((shiftHours.end - shiftHours.start) / totalHours) * 100;
                  const colors = STATUS_COLORS[dep.status] || STATUS_COLORS.default;

                  return (
                    <div
                      key={dep.id}
                      className={`absolute top-1 flex items-center rounded px-1.5 ${colors.bg} ${colors.border} border cursor-default`}
                      style={{
                        left: `${barStart}%`,
                        width: `${barWidth}%`,
                        height: `${rowHeight - 8}px`,
                      }}
                      title={`${dep.officer_name} → ${dep.bottleneck}\n${dep.shift} (${shiftHours.start}:00 - ${shiftHours.end}:00)\nStatus: ${dep.status}`}
                    >
                      <span className={`truncate text-[10px] font-medium ${colors.text}`}>
                        {viewMode === "officer" ? dep.bottleneck : `${dep.officer} ${dep.officer_name}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
