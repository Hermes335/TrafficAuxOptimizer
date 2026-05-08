import { useEffect, useMemo, useState } from "react";
import PrettyCurve from "../components/PrettyCurve";
import { Activity, Gauge, TrendingUp } from "lucide-react";
import { fetchAnalyticsTrends, type AnalyticsTrendPoint } from "../services/backend";

type TrendChartPoint = {
  tsi: number;
  speed: number;
};

export function Analytics() {
  const [trends, setTrends] = useState<AnalyticsTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    fetchAnalyticsTrends()
      .then((rows) => {
        if (!active) {
          return;
        }
        setTrends(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) {
          return;
        }
        const message = err instanceof Error ? err.message : "Failed to load analytics";
        setError(message);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const chartData = useMemo<TrendChartPoint[]>(() => {
    return [...trends].reverse().map((point) => ({
      tsi: Number((point.traffic_severity_index * 100).toFixed(1)),
      speed: Number(point.avg_speed.toFixed(1)),
    }));
  }, [trends]);

  const summary = useMemo(() => {
    if (chartData.length === 0) {
      return {
        latestTsi: 0,
        latestSpeed: 0,
        avgTsi: 0,
      };
    }

    const latest = chartData[chartData.length - 1];
    const avgTsi = chartData.reduce((sum, item) => sum + item.tsi, 0) / chartData.length;
    return {
      latestTsi: latest.tsi,
      latestSpeed: latest.speed,
      avgTsi: Number(avgTsi.toFixed(1)),
    };
  }, [chartData]);

  return (
    <div className="flex h-full flex-col gap-4 bg-gray-50 p-6">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-gray-600">Live traffic trends from backend telemetry</p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl border bg-white p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-500">
            <Activity className="h-4 w-4 text-yellow-500" />
            Latest Traffic Severity
          </div>
          <div className="text-2xl font-bold">{summary.latestTsi}%</div>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-500">
            <Gauge className="h-4 w-4 text-yellow-500" />
            Latest Average Speed
          </div>
          <div className="text-2xl font-bold">{summary.latestSpeed} km/h</div>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-500">
            <TrendingUp className="h-4 w-4 text-yellow-500" />
            Avg Severity (Window)
          </div>
          <div className="text-2xl font-bold">{summary.avgTsi}%</div>
        </div>
      </div>

      <div className="min-h-0 flex-1 rounded-xl border bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Traffic Trend Timeline</h2>

        {loading && <p className="text-sm text-gray-500">Loading analytics trends...</p>}
        {!loading && error && <p className="text-sm text-red-600">{error}</p>}
        {!loading && !error && chartData.length === 0 && (
          <p className="text-sm text-gray-500">No analytics trend data available yet.</p>
        )}

        {!loading && !error && chartData.length > 0 && (
          <div className="space-y-4 w-full">
            <div className="h-40">
              <PrettyCurve values={chartData.map((d) => d.tsi)} color="#f59e0b" />
            </div>
            <div className="h-40">
              <PrettyCurve values={chartData.map((d) => d.speed)} color="#2563eb" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
