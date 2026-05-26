import { AlertCircle, X, TriangleAlert, CircleAlert, Droplets, Construction, ShieldAlert } from "lucide-react";
import type { Incident } from "../../../services/backend";

interface IncidentTickerProps {
  incidents: Incident[];
  onRemoveIncident?: (id: number) => void;
}

const severityConfig: Record<string, { bg: string; text: string; border: string; icon: typeof TriangleAlert }> = {
  critical: { bg: "bg-red-50", text: "text-red-800", border: "border-red-200", icon: ShieldAlert },
  major:    { bg: "bg-orange-50", text: "text-orange-800", border: "border-orange-200", icon: TriangleAlert },
  minor:    { bg: "bg-yellow-50", text: "text-yellow-800", border: "border-yellow-200", icon: CircleAlert },
};

const typeIcons: Record<string, typeof TriangleAlert> = {
  collision: TriangleAlert,
  road_closure: ShieldAlert,
  construction: Construction,
  flooding: Droplets,
  other: CircleAlert,
};

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
        {incidents.map((incident) => {
          const severity = severityConfig[incident.type] || severityConfig.minor;
          const Icon = typeIcons[incident.type] || typeIcons.other;
          return (
            <div
              key={incident.id}
              className={`group flex items-start gap-3 rounded-lg border p-3 ${severity.bg} ${severity.border} transition-all`}
            >
              <div className={`mt-0.5 flex-shrink-0 ${severity.text}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-xs font-semibold uppercase ${severity.text}`}>
                  {incident.type === "critical" ? "Critical" : incident.type === "major" ? "Major" : "Minor"}
                </div>
                <div className="mt-0.5 truncate text-sm font-medium text-gray-900">
                  {incident.text}
                </div>
              </div>
              {onRemoveIncident && (
                <button
                  onClick={() => onRemoveIncident(incident.id)}
                  className="flex-shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-red-100 group-hover:opacity-100"
                  title="Remove incident"
                >
                  <X className="h-3.5 w-3.5 text-red-500" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
