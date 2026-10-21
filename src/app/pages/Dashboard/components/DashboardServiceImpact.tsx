import { AlertCircle } from "lucide-react";
import { Link } from "react-router";
import type { TrafficReading, WeatherCurrentSnapshot } from "../../../services/backend";

interface DashboardServiceImpactProps {
  loadError?: string | null;
  weatherError?: string | null;
  weather: WeatherCurrentSnapshot;
  weatherLoading: boolean;
  trafficReadings: TrafficReading[];
  trafficTileError?: string | null;
  lastRefresh: string | null;
  selectedShift: string;
  canOptimize: boolean;
}

/** Dashboard availability is advisory; the pre-run checks decide optimization readiness. */
export function DashboardServiceImpact({loadError, weatherError, weather, weatherLoading, trafficReadings,
  trafficTileError, lastRefresh, selectedShift, canOptimize}: DashboardServiceImpactProps) {
  const messages: {label: string; text: string}[] = [];
  const failed = (collection: string) => loadError?.split(" · ").some(message => message.startsWith(`${collection}:`));
  if (trafficTileError) messages.push({label: "Traffic road display", text: "Some or all colored roads are unavailable. This display does not determine whether saved traffic readings can be used for optimization. Use Retry on the map to reload the roads."});
  if (failed("Traffic readings")) messages.push({label: "Traffic readings", text: "Traffic observations could not be refreshed. Dashboard reading details are unavailable; road colors alone do not confirm fresh optimization inputs."});
  else if (lastRefresh && trafficReadings.length === 0) messages.push({label: "Traffic readings", text: "No traffic observations are loaded for this view. Road colors alone do not confirm fresh optimization inputs."});
  else if (trafficReadings.some(reading => reading.available === false || reading.data_status === "unavailable" || reading.is_stale)) {
    messages.push({label: "Traffic readings", text: "Some traffic observations are unavailable or marked stale. Check the affected locations before relying on their displayed conditions."});
  }
  if (!weatherLoading && (weatherError || failed("Weather") || weather.available === false || weather.data_status === "unavailable")) {
    messages.push({label: "Weather", text: "Current weather could not be confirmed. Any retained observation is context only; refresh before relying on weather conditions."});
  } else if (!weatherLoading && weather.is_stale) messages.push({label: "Weather", text: "The weather observation is marked stale. Refresh before relying on current weather conditions."});
  if (failed("Schedule")) messages.push({label: "Deployment schedule", text: "The schedule could not be refreshed. Assignment markers may show the last loaded schedule; open Deployment Schedule to check assignments before making changes."});
  if (failed("Dashboard")) messages.push({label: "Operations overview", text: "Bottlenecks and coverage could not be refreshed. Displayed values may be from the last successful refresh."});
  if (failed("Officers")) messages.push({label: "Officer roster", text: "The roster could not be refreshed. Officer totals may be from the last successful refresh."});
  if (failed("Points of interest")) messages.push({label: "Places on the map", text: "Point of interest markers could not be refreshed. Other map features can still be used."});
  if (!messages.length) return null;

  return <details className="relative text-xs text-amber-900" aria-label="Dashboard service impact">
    <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 font-medium hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-amber-600">
      <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span role="status" aria-atomic="true">Service impact · {messages.length} {messages.length === 1 ? "notice" : "notices"}</span>
    </summary>
    <div className="absolute left-0 top-full z-40 mt-1 max-h-[min(60vh,28rem)] w-[min(24rem,calc(100vw-3rem))] space-y-3 overflow-y-auto rounded-xl border border-amber-200 bg-white p-3 text-slate-700 shadow-lg">
      <ul className="space-y-3">{messages.map(message => <li key={message.label}><strong className="block font-semibold text-slate-950">{message.label}</strong><p className="mt-1 leading-relaxed">{message.text}</p></li>)}</ul>
      <p className="border-t border-slate-100 pt-3 leading-relaxed">Use Refresh to check dashboard data again. Optimization readiness checks the selected run’s required inputs and freshness separately.</p>
      <div className="flex flex-wrap gap-3">
        <Link className="inline-flex min-h-9 items-center font-semibold text-slate-900 underline" to="/gantt-chart">Open deployment schedule</Link>
        {canOptimize && <Link className="inline-flex min-h-9 items-center font-semibold text-amber-900 underline" to={`/optimization?shift=${selectedShift.toLowerCase()}`}>Check optimization readiness</Link>}
      </div>
    </div>
  </details>;
}
