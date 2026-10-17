import type { ComponentType } from "react";
import { WeatherStatus } from "../../../components/WeatherStatus";
import { useWeather } from "../../../contexts/WeatherContext";

interface WeatherOverlayProps {
  showWeatherOverlay: boolean;
  weatherStyle: { blurClass: string; overlayClass: string; gradient: string; bannerClass: string; iconClass: string };
  WeatherIndicatorIcon: ComponentType<{ className?: string }>;
  weatherLabel: string;
  weatherStatusTone: string;
  weatherImpactFactor: number | null;
}

export function WeatherOverlay({ showWeatherOverlay, weatherStyle }: WeatherOverlayProps) {
  const { weather, loading } = useWeather();
  if (!showWeatherOverlay) return null;

  const factor = weather.weather_impact_factor;
  const hasFactor = typeof factor === "number" && Number.isFinite(factor);
  const currentImpact = weather.available && !weather.is_stale && hasFactor;
  const impact = hasFactor ? factor >= 1.7 ? "Severe" : factor >= 1.3 ? "Moderate" : "Low" : null;

  return (
    <div className={`pointer-events-none absolute inset-0 ${currentImpact ? `${weatherStyle.blurClass} ${weatherStyle.overlayClass}` : ""}`}>
      {currentImpact && <div className="absolute inset-0" style={{ backgroundImage: weatherStyle.gradient }} />}
      <div className="absolute left-3 right-3 top-28 z-20 mx-auto max-w-sm rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm">
        <WeatherStatus />
        <p className={`mt-2 border-t border-slate-200 pt-2 text-xs ${currentImpact ? "font-medium text-slate-800" : "text-slate-600"}`}>
          {currentImpact ? `${impact} weather impact · ${factor.toFixed(2)}× factor`
            : loading && !hasFactor ? "Checking weather impact…"
            : "Current weather impact unavailable"}
        </p>
      </div>
    </div>
  );
}
