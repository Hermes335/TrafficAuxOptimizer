import { Cloud, CloudRain, Loader2 } from "lucide-react";
import { useWeather } from "../contexts/WeatherContext";

/** The header and planning card describe the same observation and freshness. */
export function WeatherStatus({ compact = false }: { compact?: boolean }) {
  const { weather, loading, error } = useWeather();
  const observedAt = weather.observed_at ?? weather.timestamp;
  const condition = weather.condition?.replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());
  const hasReading = condition != null || weather.temperature != null;
  const reading = [weather.temperature == null ? null : `${Math.round(weather.temperature)}°C`, condition].filter(Boolean).join(" · ");
  const label = loading && !hasReading ? "Loading weather…" : weather.available ? reading || "Weather available" : "Weather unavailable";
  const time = observedAt && Number.isFinite(Date.parse(observedAt))
    ? new Date(observedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", ...(weather.is_stale || error ? { month: "short", day: "numeric" } as const : {}), hour: "2-digit", minute: "2-digit" }) : null;
  const freshness = error ? "Refresh unavailable" : weather.is_stale ? "Stale reading" : weather.available ? "Latest reading" : "No current reading";
  const detail = loading && !hasReading ? "Checking Iloilo City weather" : `${freshness}${time ? ` · ${time} Manila` : ""}`;
  const Icon = loading && !hasReading ? Loader2 : (weather.precipitation ?? 0) > 0 ? CloudRain : Cloud;

  return <div role="status" aria-label="Iloilo City weather" className="flex min-w-0 items-start gap-2" title={error ?? undefined}>
    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${loading && !hasReading ? "animate-spin" : ""} ${weather.is_stale || error ? "text-amber-700" : "text-slate-500"}`} />
    <div className="min-w-0">
      <div className={`${compact ? "text-xs" : "text-sm"} font-medium text-slate-800`}>{label}</div>
      <div className="text-xs text-slate-600">{detail}</div>
      {!compact && !weather.available && hasReading && <div className="mt-1 text-xs text-slate-600">Last observation: {reading}</div>}
    </div>
  </div>;
}
