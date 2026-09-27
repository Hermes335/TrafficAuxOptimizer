import { Target } from "lucide-react";
import { Link } from "react-router";
import type { Incident } from "../../../services/backend";
import type { ComponentType } from "react";

interface QuickOptimizeCardProps {
  selectedShift: string;
  setSelectedShift: (v: string) => void;
  WeatherIndicatorIcon: ComponentType<{ className?: string }>;
  weatherStyle: { iconClass: string; chipClass: string };
  weatherLabel: string;
  selectedIncident: Incident | null;
}

export function QuickOptimizeCard({
  selectedShift,
  setSelectedShift,
  WeatherIndicatorIcon,
  weatherStyle,
  weatherLabel,
  selectedIncident,
}: QuickOptimizeCardProps) {
  return (
    <div className="rounded-xl border-2 border-yellow-400 bg-yellow-50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="rounded-lg bg-yellow-400 p-1.5">
          <Target className="h-4 w-4 text-white" />
        </div>
        <h3 className="font-semibold">Quick Optimize</h3>
      </div>
      <div className="mb-4">
        <label className="mb-2 block text-xs font-medium text-gray-600">SELECT SHIFT</label>
        <div className="flex gap-2">
          <button onClick={() => setSelectedShift("Morning")} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${selectedShift === "Morning" ? "bg-yellow-400 text-gray-900" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
            Morning<div className="text-xs opacity-75">6:00 AM - 2:00 PM</div>
          </button>
          <button onClick={() => setSelectedShift("Afternoon")} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${selectedShift === "Afternoon" ? "bg-yellow-400 text-gray-900" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
            Afternoon<div className="text-xs opacity-75">2:00 PM - 10:00 PM</div>
          </button>
        </div>
      </div>
      <div className="mb-4">
        <label className="mb-2 block text-xs font-medium text-gray-600">WEATHER MODE</label>
        <div className="flex items-center gap-2 rounded-lg bg-white p-2">
          <WeatherIndicatorIcon className={`h-4 w-4 ${weatherStyle.iconClass}`} />
          <span className="flex-1 text-sm">Auto-detected</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${weatherStyle.chipClass}`}>{weatherLabel}</span>
        </div>
      </div>
      <Link to={`/optimization?shift=${selectedShift.toLowerCase()}`} className="flex w-full items-center justify-center gap-2 rounded-lg bg-yellow-400 py-3 font-semibold text-gray-900 shadow-md transition-all hover:bg-yellow-500 hover:shadow-lg">
        Run Optimization
      </Link>
      <p className="mt-3 text-center text-xs text-gray-600">
        {selectedIncident ? (
          <>Incident detected at <strong>{selectedIncident.text.split(" - ")[1] ?? selectedIncident.text}</strong>. System recommends recalculating deployment.</>
        ) : (
          <>No active incident currently selected.</>
        )}
      </p>
    </div>
  );
}
