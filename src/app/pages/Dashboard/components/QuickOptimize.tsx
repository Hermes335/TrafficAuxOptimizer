import { AlertCircle, Target, Cloud, CloudRain, TrendingDown } from "lucide-react";
import { Link } from "react-router";
import type { DashboardSnapshot, WeatherCurrentSnapshot } from "../../../services/backend";

interface QuickOptimizeProps {
  selectedShift: string;
  onShiftChange: (shift: string) => void;
  incidents: DashboardSnapshot["incidents"];
  weather: WeatherCurrentSnapshot;
  metrics: DashboardSnapshot["metrics"];
}

export function QuickOptimize({
  selectedShift,
  onShiftChange,
  incidents,
  weather,
  metrics,
}: QuickOptimizeProps) {
  const selectedShiftKey = selectedShift.toLowerCase();
  const shiftPressure = selectedShiftKey === "morning" ? 0.92 : 1.08;
  const selectedIncident = incidents[0];
  const incidentImpact = selectedIncident?.type === "critical" ? 1.4 : selectedIncident?.type === "major" ? 1.15 : 1.0;
  const impactRadiusKm = Number((Math.max(0.8, Math.min(4.2, selectedIncident ? incidentImpact * shiftPressure * 1.4 : 1.2))).toFixed(1));
  const estimatedClearMinutes = Math.max(15, Math.round(metrics.avgResponseTimeMinutes * impactRadiusKm * metrics.weatherCorrelation * 0.6));

  const networkHealthLabel =
    metrics.coverageEfficiency >= 80 && metrics.resourceUtilization < 85
      ? "HEALTHY"
      : metrics.coverageEfficiency >= 65
        ? "MARGINAL"
        : "CRITICAL";

  const networkHealthClass =
    networkHealthLabel === "HEALTHY"
      ? "text-green-600"
      : networkHealthLabel === "MARGINAL"
        ? "text-orange-600"
        : "text-red-600";

  const weatherCorrelation = metrics.weatherCorrelation;
  const weatherLabel = weather.condition.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

  const weatherStatusTone = weatherCorrelation >= 1.7 ? "Severe" : weatherCorrelation >= 1.3 ? "Moderate" : "Clear";
  const weatherStyle = weatherStatusTone === "Severe"
    ? { chipClass: "bg-rose-500 text-white", iconClass: "text-rose-100", icon: CloudRain }
    : weatherStatusTone === "Moderate"
      ? { chipClass: "bg-yellow-400 text-white", iconClass: "text-yellow-100", icon: CloudRain }
      : { chipClass: "bg-emerald-500 text-white", iconClass: "text-emerald-100", icon: Cloud };

  const WeatherIndicatorIcon = weatherStyle.icon;

  const avgResponseTimeMinutes = metrics.avgResponseTimeMinutes;
  const cityFlowValue = Math.max(0, Math.min(100, Math.round(metrics.coverageEfficiency - (selectedShiftKey === "afternoon" ? 6 : 2))));
  const cityFlowDelta = Math.round(cityFlowValue - metrics.coverageEfficiency);
  const delayDeltaMinutes = Math.round(avgResponseTimeMinutes - 15);

  return (
    <div className="w-full space-y-4 overflow-y-auto bg-white p-4 md:w-96">
      {/* Incident Ticker */}
      <div className="rounded-lg border bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-red-500" aria-hidden="true" />
          <h3 className="font-semibold">Active Incidents</h3>
          <span className="ml-auto rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            LIVE
          </span>
        </div>
        <div className="space-y-2">
          {incidents.map((incident) => (
            <div
              key={incident.id}
              className={`rounded-lg p-2 text-xs ${
                incident.type === "critical"
                  ? "bg-red-50 text-red-900"
                  : incident.type === "major"
                    ? "bg-orange-50 text-orange-900"
                    : "bg-yellow-50 text-yellow-900"
              }`}
            >
              {incident.text}
            </div>
          ))}
        </div>
      </div>

      {/* Quick Optimize Card */}
      <div className="rounded-xl border-2 border-yellow-400 bg-yellow-50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="rounded-lg bg-yellow-400 p-1.5">
            <Target className="h-4 w-4 text-white" aria-hidden="true" />
          </div>
          <h3 className="font-semibold">Quick Optimize</h3>
        </div>

        {/* Shift Selector */}
        <div className="mb-4">
          <label className="mb-2 block text-xs font-medium text-gray-600">SELECT SHIFT</label>
          <div className="flex gap-2">
            <button
              onClick={() => onShiftChange("Morning")}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                selectedShift === "Morning"
                  ? "bg-yellow-400 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              Morning
              <div className="text-xs opacity-75">6:00 AM - 2:00 PM</div>
            </button>
            <button
              onClick={() => onShiftChange("Afternoon")}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                selectedShift === "Afternoon"
                  ? "bg-yellow-400 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              Afternoon
              <div className="text-xs opacity-75">2:00 PM - 10:00 PM</div>
            </button>
          </div>
        </div>

        {/* Weather Mode */}
        <div className="mb-4">
          <label className="mb-2 block text-xs font-medium text-gray-600">WEATHER MODE</label>
          <div className="flex items-center gap-2 rounded-lg bg-white p-2">
            <WeatherIndicatorIcon className={`h-4 w-4 ${weatherStyle.iconClass}`} aria-hidden="true" />
            <span className="flex-1 text-sm">Auto-detected</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${weatherStyle.chipClass}`}>
              {weatherLabel}
            </span>
          </div>
        </div>

        {/* Optimization Info */}
        <div className="mb-4 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Impact Radius</span>
            <span className="font-medium">{impactRadiusKm} KM</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Estimated Clear Time</span>
            <span className="font-medium">{estimatedClearMinutes} MIN</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Network Health</span>
            <span className={`font-medium ${networkHealthClass}`}>{networkHealthLabel}</span>
          </div>
        </div>

        {/* Run Optimization Button */}
        <Link
          to="/optimization"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-yellow-400 py-3 font-semibold text-white shadow-md transition-all hover:bg-yellow-500 hover:shadow-lg"
        >
          ⚡ Run Optimization
        </Link>

        <p className="mt-3 text-center text-xs text-gray-600">
          {selectedIncident ? (
            <>
              Incident detected at <strong>{selectedIncident.text.split(" - ")[1] ?? selectedIncident.text}</strong>. System recommends recalculating deployment.
            </>
          ) : (
            <>No active incident currently selected.</>
          )}
        </p>
      </div>

      {/* System Stats */}
      <div className="space-y-3">
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="mb-1 text-xs text-gray-600">OVERALL CITY FLOW</div>
          <div className="flex items-end gap-2">
            <div className="text-2xl font-bold">{cityFlowValue}%</div>
            <div className={`mb-1 flex items-center text-sm ${cityFlowDelta <= 0 ? "text-green-500" : "text-red-500"}`}>
              <TrendingDown className="h-3 w-3" aria-hidden="true" />
              {Math.abs(cityFlowDelta)}%
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-gray-50 p-3">
          <div className="mb-1 text-xs text-gray-600">AVG. DELAY TIME</div>
          <div className="flex items-end gap-2">
            <div className="text-2xl font-bold">{avgResponseTimeMinutes}m</div>
            <div className={`mb-1 flex items-center text-sm ${delayDeltaMinutes <= 0 ? "text-green-500" : "text-red-500"}`}>
              <TrendingDown className="h-3 w-3" aria-hidden="true" />
              {Math.abs(delayDeltaMinutes)}m
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}