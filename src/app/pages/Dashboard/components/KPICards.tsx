import { RememberedDetails } from "../../../components/RememberedDetails";
import type { DashboardSnapshot, WeatherCurrentSnapshot } from "../../../services/backend";

interface KPICardsProps {
  metrics: DashboardSnapshot["metrics"];
  weather: WeatherCurrentSnapshot;
  weatherLoading?: boolean;
  deployedOfficersCount: number;
  totalOfficersCount: number;
}
export function KPICards({ metrics, weather, weatherLoading = false, deployedOfficersCount, totalOfficersCount }: KPICardsProps) {
  const percent = (value: number | null) => value == null || !Number.isFinite(value) ? "Unavailable" : value.toFixed(1) + "%";
  const factor = weather.weather_impact_factor;
  const hasFactor = typeof factor === "number" && Number.isFinite(factor);
  const currentWeather = weather.available && !weather.is_stale;
  const factorLabel = hasFactor ? `${factor.toFixed(2)}×` : "Unavailable";
  const source = weather.source.replace(/_/g, " ");
  const weatherValue = weatherLoading && !hasFactor ? "Loading…" : currentWeather ? factorLabel : "Unavailable";
  const weatherDetail = weatherLoading && !hasFactor ? "Checking Iloilo City weather."
    : !currentWeather ? hasFactor ? `Last observed factor ${factorLabel}. Current weather impact is unavailable.` : "No current weather impact reading."
    : hasFactor ? `Latest observation · ${source}${weatherLoading ? " · refreshing" : ""}` : "The latest weather observation has no impact factor.";
  return <RememberedDetails stateKey="dashboard.metrics" className="max-h-[45vh] shrink-0 overflow-y-auto border-b border-slate-200 bg-white px-4 py-2">
    <summary className="cursor-pointer rounded text-sm font-medium text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500">Staffing &amp; weather details</summary>
    <div className="grid grid-cols-1 gap-3 pb-1 pt-3 sm:grid-cols-2 xl:grid-cols-4">
      <section className="rounded-lg border border-slate-200 p-3"><h2 className="text-sm font-medium text-slate-600">Shift staffing coverage</h2>
        <strong className="my-1 block text-xl font-semibold tabular-nums tracking-tight text-slate-900">{percent(metrics.coverageEfficiency)}</strong>
        <p className="text-xs leading-relaxed text-slate-600">{metrics.assignedStaffing ?? "—"} assigned / {metrics.requiredStaffing ?? "—"} required posts in selected shift. Partial shifts are weighted by duration.</p>
      </section>
      <section className="rounded-lg border border-slate-200 p-3"><h2 className="text-sm font-medium text-slate-600">Measured response time</h2>
        <strong className="my-1 block text-xl font-semibold tabular-nums tracking-tight text-slate-900">{metrics.avgResponseTimeMinutes == null ? "Unavailable" : metrics.avgResponseTimeMinutes + " min"}</strong>
        <p className="text-xs leading-relaxed text-slate-600">{metrics.avgResponseTimeMinutes == null ? "No dispatch-to-arrival observations collected for this shift." : "Average dispatch-to-arrival time for the selected shift."}</p>
      </section>
      <section className="rounded-lg border border-slate-200 p-3"><h2 className="text-sm font-medium text-slate-600">Scheduled roster</h2>
        <strong className="my-1 block text-xl font-semibold tabular-nums tracking-tight text-slate-900">{percent(metrics.resourceUtilization)}</strong>
        <p className="text-xs leading-relaxed text-slate-600">{deployedOfficersCount} assigned now / {totalOfficersCount} eligible officers in selected shift. Percentage summarizes the shift.</p>
      </section>
      <section className="rounded-lg border border-slate-200 p-3"><h2 className="text-sm font-medium text-slate-600">Weather impact factor</h2>
        <strong className="my-1 block text-xl font-semibold tabular-nums tracking-tight text-slate-900">{weatherValue}</strong>
        <p className="text-xs leading-relaxed text-slate-600">{weatherDetail}</p>
      </section>
    </div>
  </RememberedDetails>;
}
