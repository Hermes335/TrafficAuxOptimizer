import { AlertCircle } from "lucide-react";
import type { Incident } from "../../../services/backend";

interface IncidentTickerProps {
  incidents: Incident[];
}

export function IncidentTicker({ incidents }: IncidentTickerProps) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <AlertCircle className="h-5 w-5 text-red-500" />
        <h3 className="font-semibold">Active Incidents</h3>
        <span className="ml-auto rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">LIVE</span>
      </div>
      <div className="space-y-2">
        {incidents.map((incident) => (
          <div key={incident.id} className={`rounded-lg p-2 text-xs ${incident.type === "critical" ? "bg-red-50 text-red-900" : incident.type === "major" ? "bg-orange-50 text-orange-900" : "bg-yellow-50 text-yellow-900"}`}>
            {incident.text}
          </div>
        ))}
      </div>
    </div>
  );
}
