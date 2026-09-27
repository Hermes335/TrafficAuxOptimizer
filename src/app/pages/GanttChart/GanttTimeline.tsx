import { operationalTime } from "../../services/operationalTime";
import { useMemo } from "react";
import { MapPin, ShieldCheck, UsersRound } from "lucide-react";
import type { DeploymentScheduleItem } from "../../services/backend";

interface GanttTimelineProps {
  deployments: DeploymentScheduleItem[];
  viewMode: "officer" | "bottleneck";
}

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  assigned: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-800", dot: "bg-blue-500" },
  published: { bg: "bg-green-50", border: "border-green-200", text: "text-green-800", dot: "bg-green-500" },
  completed: { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-700", dot: "bg-gray-500" },
  default: { bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-900", dot: "bg-yellow-500" },
};

function formatShift(item: DeploymentScheduleItem) {
  const start = operationalTime(item.start_time);
  const end = operationalTime(item.end_time);
  return `${item.shift} ${start}-${end}`;
}

function getStatusColors(status: string) {
  return STATUS_COLORS[status] ?? STATUS_COLORS.default;
}

export function GanttTimeline({ deployments, viewMode }: GanttTimelineProps) {
  const { rows, maxLoad, shiftSummary, bottleneckCount, officerCount } = useMemo(() => {
    const grouped = new Map<string, DeploymentScheduleItem[]>();
    const shifts = new Map<string, number>();
    const bottlenecks = new Set<string>();
    const officers = new Set<string>();

    for (const dep of deployments) {
      const key = viewMode === "officer" ? `${dep.officer} - ${dep.officer_name}` : dep.bottleneck;
      grouped.set(key, [...(grouped.get(key) ?? []), dep]);
      shifts.set(dep.shift, (shifts.get(dep.shift) ?? 0) + 1);
      bottlenecks.add(dep.bottleneck);
      officers.add(dep.officer);
    }

    const sortedRows = Array.from(grouped.entries())
      .map(([label, items]) => ({
        label,
        items: items.slice().sort((a, b) =>
          viewMode === "officer"
            ? a.bottleneck.localeCompare(b.bottleneck)
            : a.officer.localeCompare(b.officer),
        ),
      }))
      .sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));

    return {
      rows: sortedRows,
      maxLoad: Math.max(1, ...sortedRows.map((row) => row.items.length)),
      shiftSummary: Array.from(shifts.entries()).sort(([a], [b]) => a.localeCompare(b)),
      bottleneckCount: bottlenecks.size,
      officerCount: officers.size,
    };
  }, [deployments, viewMode]);

  if (deployments.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50">
        <div className="text-center">
          <div className="text-sm font-medium text-gray-500">No deployments to display</div>
          <div className="text-xs text-gray-400">Publish an optimization to see assignments</div>
        </div>
      </div>
    );
  }

  const primaryIcon = viewMode === "officer" ? ShieldCheck : MapPin;
  const PrimaryIcon = primaryIcon;

  return (
    <div className="rounded-xl border bg-white">
      <div className="border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <PrimaryIcon className="h-4 w-4 text-yellow-600" />
            <h3 className="text-sm font-semibold text-gray-800">
              Deployment Board by {viewMode === "officer" ? "Officer" : "Bottleneck"}
            </h3>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span className="rounded-full bg-gray-100 px-2 py-1">{officerCount} officers</span>
            <span className="rounded-full bg-gray-100 px-2 py-1">{bottleneckCount} bottlenecks</span>
            {shiftSummary.map(([shift, count]) => (
              <span key={shift} className="rounded-full bg-yellow-50 px-2 py-1 text-yellow-800">
                {shift}: {count}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => {
          const loadPercent = Math.max(8, Math.round((row.items.length / maxLoad) * 100));
          return (
            <section key={row.label} className="min-w-0 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-gray-900" title={row.label}>
                    {row.label}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                    <UsersRound className="h-3.5 w-3.5" />
                    {row.items.length} assignment{row.items.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-700">
                  {row.items.length}
                </div>
              </div>

              <div className="mb-3 h-2 overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-yellow-400" style={{ width: `${loadPercent}%` }} />
              </div>

              <div className="space-y-2">
                {row.items.map((item) => {
                  const colors = getStatusColors(item.status);
                  const title = viewMode === "officer"
                    ? `${item.officer_name} assigned to ${item.bottleneck}`
                    : `${item.bottleneck} covered by ${item.officer} - ${item.officer_name}`;

                  return (
                    <div
                      key={item.id}
                      className={`rounded-md border px-3 py-2 ${colors.bg} ${colors.border}`}
                      title={title}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-gray-900">
                          {viewMode === "officer" ? item.bottleneck : `${item.officer} - ${item.officer_name}`}
                        </span>
                        <span className={`flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium capitalize ${colors.text}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                          {item.status}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                        <span className="capitalize">{item.assignment_type}</span>
                        <span className="text-gray-300">|</span>
                        <span className="capitalize">{formatShift(item)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
