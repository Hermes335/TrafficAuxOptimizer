import { AlertCircle, X } from "lucide-react";
import type { Incident } from "../../../services/backend";

interface IncidentTickerProps {
  incidents: Incident[];
  onRemoveIncident?: (id: number) => void;
}

export function IncidentTicker({ incidents, onRemoveIncident }: IncidentTickerProps) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <AlertCircle className="h-5 w-5 text-red-500" />
        <h3 className="font-semibold">Active Incidents</h3>
        <span className="ml-auto rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
          {incidents.length > 0 ? `${incidents.length} LIVE` : "CLEAR"}
        </span>
      </div>
      <div className="space-y-2">
        {incidents.length === 0 && (
          <div className="rounded-lg bg-green-50 p-3 text-center text-sm text-green-700">
            No active incidents
          </div>
        )}
        {incidents.map((incident) => (
          <div
            key={incident.id}
            className={`group flex items-center gap-2 rounded-lg p-2 text-xs ${
              incident.type === "critical"
                ? "bg-red-50 text-red-900"
                : incident.type === "major"
                  ? "bg-orange-50 text-orange-900"
                  : "bg-yellow-50 text-yellow-900"
            }`}
          >
            <div className="flex-1">
              <div className="font-medium">{incident.text}</div>
              <div className="mt-0.5 text-[10px] opacity-70 uppercase">{incident.type}</div>
            </div>
            {onRemoveIncident && (
              <button
                onClick={() => onRemoveIncident(incident.id)}
                className="rounded p-1 opacity-0 transition-opacity hover:bg-red-100 group-hover:opacity-100"
                title="Remove incident"
              >
                <X className="h-3.5 w-3.5 text-red-500" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
