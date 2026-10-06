import type { DashboardSnapshot, WeatherCurrentSnapshot } from "../../../services/backend";

interface KPICardsProps {
  metrics: DashboardSnapshot["metrics"];
  weather: WeatherCurrentSnapshot;
  deployedOfficersCount: number;
  totalOfficersCount: number;
}
export function KPICards({ metrics, weather, deployedOfficersCount, totalOfficersCount }: KPICardsProps) {
  const percent = (value: number | null) => value == null ? "Unavailable" : value.toFixed(1) + "%";
  return <details className="border-b bg-white px-4 py-2">
    <summary className="cursor-pointer text-sm font-medium">Staffing and environmental details</summary>
    <div className="grid grid-cols-2 gap-3 py-3 lg:grid-cols-4">
      <section className="rounded border p-3"><h2>Shift staffing coverage</h2>
        <strong>{percent(metrics.coverageEfficiency)}</strong>
        <p className="text-xs text-gray-600">{metrics.assignedStaffing ?? "—"} assigned / {metrics.requiredStaffing ?? "—"} required posts in selected shift. Partial shifts are weighted by duration.</p>
      </section>
      <section className="rounded border p-3"><h2>Measured response time</h2>
        <strong>{metrics.avgResponseTimeMinutes == null ? "Unavailable" : metrics.avgResponseTimeMinutes + " min"}</strong>
        <p className="text-xs text-gray-600">No dispatch-to-arrival observations collected for this shift.</p>
      </section>
      <section className="rounded border p-3"><h2>Scheduled roster</h2>
        <strong>{percent(metrics.resourceUtilization)}</strong>
        <p className="text-xs text-gray-600">{deployedOfficersCount} assigned now / {totalOfficersCount} eligible officers in selected shift. Percentage summarizes the shift.</p>
      </section>
      <section className="rounded border p-3"><h2>Weather impact factor</h2>
        <strong>{metrics.weatherImpactFactor?.toFixed(2) ?? "Unavailable"}</strong>
        <p className="text-xs text-gray-600">Model factor · {weather.data_status}{weather.is_stale ? " · stale" : ""} · {weather.source}</p>
      </section>
    </div>
  </details>;
}
