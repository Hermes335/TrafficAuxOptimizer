import { useEffect, useMemo, useState } from "react";
import PrettyCurve from "../components/PrettyCurve";
import { Activity, Gauge, TrendingUp, BarChart3 } from "lucide-react";
import { LoadingState, EmptyState } from "../components/LoadingState";
import { fetchAnalyticsTrends, type AnalyticsTrendPoint } from "../services/backend";

type TrendChartPoint = {
  tsi: number;
  speed: number;
};

export function Analytics() {
  const [trends, setTrends] = useState<AnalyticsTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provenance, setProvenance] = useState<{ data_status: string; available: boolean; is_stale: boolean; is_synthetic: boolean } | null>(null);

  useEffect(() => {
    let active = true;

    fetchAnalyticsTrends()
      .then((payload) => {
        if (!active) {
          return;
        }
        setTrends(payload.trends);
        setProvenance(payload.metadata);
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
      {provenance && (!provenance.available || provenance.is_stale || provenance.is_synthetic || provenance.data_status === "fallback" || provenance.data_status === "cached") ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Traffic trends are {provenance.available ? provenance.data_status : "unavailable"}; recommendations may use incomplete or fallback data.
        </div>
      ) : null}

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

        {loading && <LoadingState label="Loading analytics trends..." />}
        {!loading && error && <LoadingState error={error} />}
        {!loading && !error && chartData.length === 0 && (
          <EmptyState
            icon={BarChart3}
            title="No Trend Data"
            description="No analytics trend data available yet. Data will appear once collected."
          />
        )}

        {!loading && !error && chartData.length > 0 && (
          <div className="space-y-4 w-full">
            <div className="h-40">
              <PrettyCurve 
                values={chartData.map((d) => d.tsi)} 
                color="#f59e0b" 
                yAxisFormatter={(v) => `${Math.round(v)}%`}
              />
            </div>
            <div className="h-40">
              <PrettyCurve 
                values={chartData.map((d) => d.speed)} 
                color="#2563eb" 
                yAxisFormatter={(v) => `${Math.round(v)} km/h`}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
