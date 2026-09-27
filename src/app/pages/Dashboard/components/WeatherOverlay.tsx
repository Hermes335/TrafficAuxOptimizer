import type { ComponentType } from "react";

interface WeatherOverlayProps {
  showWeatherOverlay: boolean;
  weatherStyle: { blurClass: string; overlayClass: string; gradient: string; bannerClass: string; iconClass: string };
  WeatherIndicatorIcon: ComponentType<{ className?: string }>;
  weatherLabel: string;
  weatherStatusTone: string;
  weatherImpactFactor: number | null;
}

export function WeatherOverlay({ showWeatherOverlay, weatherStyle, WeatherIndicatorIcon, weatherLabel, weatherStatusTone, weatherImpactFactor }: WeatherOverlayProps) {
  if (!showWeatherOverlay) return null;

  return (
    <div className={`pointer-events-none absolute inset-0 ${weatherStyle.blurClass} ${weatherStyle.overlayClass}`}>
      <div className="absolute inset-0" style={{ backgroundImage: weatherStyle.gradient }} />
      <div className={`absolute left-1/2 top-28 z-20 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-medium shadow-lg ${weatherStyle.bannerClass}`}>
        <WeatherIndicatorIcon className={`mr-2 inline h-4 w-4 ${weatherStyle.iconClass}`} />
        {weatherLabel} - {weatherStatusTone} impact - WIF {weatherImpactFactor == null ? "unavailable" : weatherImpactFactor.toFixed(2) + "x"}
      </div>
    </div>
  );
}
