import { MapPin, X, User } from "lucide-react";
import type { Bottleneck } from "../../../services/backend";
import { ConfirmDialog } from "../../../components/ConfirmDialog";

interface BottleneckDetailPanelProps {
  bottleneck: Bottleneck;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  deletingId: string | null;
  canManage: boolean;
}

export function BottleneckDetailPanel({
  bottleneck,
  onClose,
  onDelete,
  deletingId,
  canManage,
}: BottleneckDetailPanelProps) {
  const tsiPercent = Math.round((bottleneck.tsi ?? 0) * 100);
  const weatherImpact = bottleneck.weather_impact_factor;
  const assignedOfficers = bottleneck.current_assigned_officers ?? [];
  const deployedCount = bottleneck.current_assigned;
  const requiredCount = bottleneck.current_required;

  const tsiColor = tsiPercent >= 80 ? "text-red-600" : tsiPercent >= 60 ? "text-orange-600" : tsiPercent >= 40 ? "text-yellow-600" : "text-green-600";
  const weatherColor = weatherImpact >= 1.7 ? "text-red-600" : weatherImpact >= 1.3 ? "text-orange-600" : "text-green-600";
  const officerColor = deployedCount==null||requiredCount==null?"text-gray-600":deployedCount >= requiredCount ? "text-green-600" : deployedCount > 0 ? "text-yellow-600" : "text-red-600";

  return (
    <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-blue-600" />
          <h3 className="font-semibold text-blue-900">Bottleneck Details</h3>
        </div>
        <button aria-label="Close bottleneck details" onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4">
        {/* Name and ID */}
        <div>
          <div className="text-xs font-semibold text-gray-600">NAME</div>
          <div className="text-lg font-bold text-blue-900">{bottleneck.name}</div>
          <div className="text-xs text-gray-500">{bottleneck.id}</div>
          <div className="text-xs text-gray-500">Area: {bottleneck.area_name||"Ungrouped"}</div>
        </div>

        {/* TSI - Traffic Severity Index */}
        <div>
          <div className="text-xs font-semibold text-gray-600">TRAFFIC SEVERITY INDEX (TSI)</div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="relative h-2 overflow-hidden rounded-full bg-gray-200">
                <div
                  className={`h-full transition-all ${tsiPercent >= 80 ? "bg-red-500" : tsiPercent >= 60 ? "bg-orange-500" : tsiPercent >= 40 ? "bg-yellow-500" : "bg-green-500"}`}
                  style={{ width: `${Math.min(100, tsiPercent)}%` }}
                />
              </div>
            </div>
            <span className={`font-bold ${tsiColor}`}>{tsiPercent}%</span>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {tsiPercent >= 80 ? "Critical congestion" : tsiPercent >= 60 ? "Heavy congestion" : tsiPercent >= 40 ? "Moderate congestion" : "Free flow"}
          </div>
        </div>

        {/* Weather Impact Factor */}
        <div>
          <div className="text-xs font-semibold text-gray-600">WEATHER IMPACT FACTOR (WIF)</div>
          <div className="flex items-center gap-2">
            <span className={`text-2xl font-bold ${weatherColor}`}>
              {weatherImpact == null ? "Unavailable" : weatherImpact.toFixed(2) + "x"}
            </span>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {weatherImpact == null ? "No weather observation available" : weatherImpact >= 1.7 ? "Severe impact - rainfall/conditions slowing traffic" : weatherImpact >= 1.3 ? "Moderate impact - conditions affecting travel times" : "Low impact - normal conditions"}
          </div>
        </div>

        {/* Officers */}
        <div>
          <div className="text-xs font-semibold text-gray-600">ASSIGNED NOW</div>
          <div className="flex items-center gap-2">
            <span className={`text-2xl font-bold ${officerColor}`}>{deployedCount??"—"}</span>
            <span className="text-gray-500">/ {requiredCount??"—"} required</span>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {deployedCount==null||requiredCount==null?"Current staffing unavailable":requiredCount===0?"No officers required now":deployedCount >= requiredCount ? "Fully staffed" : deployedCount > 0 ? "Understaffed" : "No officers assigned"}
          </div>
        </div>

        {/* Officer List */}
        {assignedOfficers.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-semibold text-gray-600">OFFICER ROSTER</div>
            <div className="max-h-32 space-y-1.5 overflow-y-auto">
              {assignedOfficers.map((officer, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm">
                  <User className="h-3.5 w-3.5 text-gray-400" />
                  <span className="font-medium text-gray-900">{officer.name}</span>
                  <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-600">{officer.badge_number}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {assignedOfficers.length === 0 && (
          <div className="rounded-lg bg-gray-100 p-3 text-center text-sm text-gray-500">
            No officers currently deployed to this bottleneck
          </div>
        )}

        {/* Delete */}
        <ConfirmDialog
          trigger={
            <button
              disabled={!canManage || deletingId === bottleneck.id}
              className="w-full rounded-lg border border-red-600 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {deletingId === bottleneck.id ? "Removing..." : "Remove Bottleneck"}
            </button>
          }
          title="Remove Bottleneck"
          description={`Are you sure you want to remove "${bottleneck.name}"? This action cannot be undone.`}
          confirmText="Remove"
          onConfirm={() => onDelete(bottleneck.id)}
          isDangerous
        />
      </div>
    </div>
  );
}
