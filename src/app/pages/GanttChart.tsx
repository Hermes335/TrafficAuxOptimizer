import { Download, Filter } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  fetchBottlenecks,
  fetchDeploymentSchedule,
  type BottleneckOption,
  type DeploymentScheduleItem,
} from "../services/backend";

export function GanttChart() {
  const [schedule, setSchedule] = useState<DeploymentScheduleItem[]>([]);
  const [bottlenecks, setBottlenecks] = useState<BottleneckOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([fetchDeploymentSchedule(), fetchBottlenecks()])
      .then(([deployments, bottleneckRows]) => {
        if (!active) {
          return;
        }
        setSchedule(deployments);
        setBottlenecks(bottleneckRows);
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

  const groupedByBottleneck = useMemo(() => {
    const map = new Map<string, DeploymentScheduleItem[]>();
    schedule.forEach((item) => {
      const list = map.get(item.bottleneck) ?? [];
      list.push(item);
      map.set(item.bottleneck, list);
    });
    return map;
  }, [schedule]);

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

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b px-6 py-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Deployment Schedule</h1>
            <p className="text-sm text-gray-600">Live schedule loaded from backend deployments API.</p>
          </div>

          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 rounded-lg border px-4 py-2 hover:bg-gray-50">
              <Filter className="h-4 w-4" />
              Filter
            </button>
            <button className="flex items-center gap-2 rounded-lg border px-4 py-2 hover:bg-gray-50">
              <Download className="h-4 w-4" />
              Export
            </button>
          </div>
        </div>

        <div className="rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">
          Coverage: {coverage.covered}/{coverage.total} bottlenecks with active assignments ({coverage.percent}%)
        </div>
      </div>

      {error && <div className="px-6 py-4 text-sm text-red-600">{error}</div>}

      <div className="flex-1 overflow-auto p-6">
        <div className="overflow-hidden rounded-xl border">
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
              {schedule.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-gray-500" colSpan={7}>
                    No deployments found yet. Run optimization and approve a plan to populate this schedule.
                  </td>
                </tr>
              )}
              {schedule.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">{item.bottleneck}</td>
                  <td className="px-4 py-3">{item.officer} - {item.officer_name}</td>
                  <td className="px-4 py-3 capitalize">{item.shift}</td>
                  <td className="px-4 py-3">{new Date(item.start_time).toLocaleString()}</td>
                  <td className="px-4 py-3">{new Date(item.end_time).toLocaleString()}</td>
                  <td className="px-4 py-3 capitalize">{item.assignment_type}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-700 capitalize">
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
