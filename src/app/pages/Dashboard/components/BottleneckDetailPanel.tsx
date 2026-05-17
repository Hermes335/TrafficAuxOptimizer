import { MapPin, X } from "lucide-react";
import { Link } from "react-router";
import type { Incident } from "../../../services/backend";

interface BottleneckDetailPanelProps {
  detailPanelName: string;
  detailPanelCongestion: string;
  detailPanelWeather: string;
  detailPanelOfficersCurrent: string;
  detailPanelOfficersNeeded: string;
  isEditingDetailPanel: boolean;
  setIsEditingDetailPanel: (v: boolean) => void;
  setDetailPanelName: (v: string) => void;
  setDetailPanelCongestion: (v: string) => void;
  setDetailPanelWeather: (v: string) => void;
  setDetailPanelOfficersCurrent: (v: string) => void;
  setDetailPanelOfficersNeeded: (v: string) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
  onDelete: () => Promise<void>;
  savingBottleneck: boolean;
  bottleneckActionError: string | null;
  bottleneckActionNotice: string | null;
  incidentsForBottleneck: Incident[];
  selectedShift: string;
  setSelectedShift: (v: string) => void;
  impactRadiusKm: number;
  estimatedClearMinutes: number;
  networkHealthLabel: string;
  networkHealthClass: string;
}

export function BottleneckDetailPanel({
  detailPanelName,
  detailPanelCongestion,
  detailPanelWeather,
  detailPanelOfficersCurrent,
  detailPanelOfficersNeeded,
  isEditingDetailPanel,
  setIsEditingDetailPanel,
  setDetailPanelName,
  setDetailPanelCongestion,
  setDetailPanelWeather,
  setDetailPanelOfficersCurrent,
  setDetailPanelOfficersNeeded,
  onClose,
  onSave,
  onDelete,
  savingBottleneck,
  bottleneckActionError,
  bottleneckActionNotice,
  incidentsForBottleneck,
  selectedShift,
  setSelectedShift,
  impactRadiusKm,
  estimatedClearMinutes,
  networkHealthLabel,
  networkHealthClass,
}: BottleneckDetailPanelProps) {
  return (
    <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-blue-600" />
          <h3 className="font-semibold text-blue-900">{isEditingDetailPanel ? "Edit Bottleneck" : "Bottleneck Details"}</h3>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X className="h-4 w-4" />
        </button>
      </div>

      {!isEditingDetailPanel && (
        <div className="space-y-4">
          <div>
            <div className="text-xs font-semibold text-gray-600">NAME</div>
            <div className="text-lg font-bold text-blue-900">{detailPanelName}</div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600">CONGESTION</div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="relative h-2 overflow-hidden rounded-full bg-gray-200">
                  <div className="h-full bg-red-500 transition-all" style={{ width: `${detailPanelCongestion}%` }} />
                </div>
              </div>
              <span className="font-bold text-red-600">{detailPanelCongestion}%</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-semibold text-gray-600">WEATHER IMPACT</div>
              <div className="font-bold text-orange-600">{detailPanelWeather}%</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-600">OFFICERS</div>
              <div className="font-bold text-purple-600">{detailPanelOfficersCurrent}/{detailPanelOfficersNeeded}</div>
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold text-gray-600">ACTIVE INCIDENTS</div>
            {incidentsForBottleneck.length === 0 ? (
              <div className="rounded-lg bg-green-50 p-2 text-center text-sm font-medium text-green-700">CLEAR</div>
            ) : (
              <div className="space-y-2">
                {incidentsForBottleneck.map((inc) => (
                  <div key={inc.id} className={`rounded-lg p-2 text-xs font-medium ${inc.type === "critical" ? "bg-red-100 text-red-700" : inc.type === "major" ? "bg-orange-100 text-orange-700" : "bg-yellow-100 text-yellow-700"}`}>
                    {inc.type.toUpperCase()} - {inc.text}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setIsEditingDetailPanel(true)} className="flex-1 rounded-lg border border-blue-600 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50">Edit</button>
            <button onClick={onDelete} className="flex-1 rounded-lg border border-red-600 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">Delete</button>
          </div>
        </div>
      )}

      {isEditingDetailPanel && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600">NAME</label>
            <input type="text" value={detailPanelName} onChange={(e) => setDetailPanelName(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600">CONGESTION %</label>
            <input type="number" value={detailPanelCongestion} onChange={(e) => setDetailPanelCongestion(e.target.value)} min="0" max="100" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600">WEATHER IMPACT %</label>
            <input type="number" value={detailPanelWeather} onChange={(e) => setDetailPanelWeather(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600">OFFICERS CURRENT</label>
              <input type="number" value={detailPanelOfficersCurrent} onChange={(e) => setDetailPanelOfficersCurrent(e.target.value)} min="0" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600">OFFICERS NEEDED</label>
              <input type="number" value={detailPanelOfficersNeeded} onChange={(e) => setDetailPanelOfficersNeeded(e.target.value)} min="0" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={onSave} disabled={savingBottleneck} className="flex-1 rounded-lg bg-green-500 px-3 py-2 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-50">
              {savingBottleneck ? "Saving..." : "Save"}
            </button>
            <button onClick={() => setIsEditingDetailPanel(false)} className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
          </div>
          {bottleneckActionError && <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{bottleneckActionError}</div>}
          {bottleneckActionNotice && <div className="rounded-lg bg-green-50 p-2 text-xs text-green-700">{bottleneckActionNotice}</div>}
        </div>
      )}

      <div className="mt-4 border-t pt-4">
        <h4 className="mb-3 text-sm font-semibold text-gray-700">Quick Optimize</h4>
        <div className="mb-3">
          <label className="mb-2 block text-xs font-medium text-gray-600">SELECT SHIFT</label>
          <div className="flex gap-2">
            <button onClick={() => setSelectedShift("Morning")} className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-all ${selectedShift === "Morning" ? "bg-yellow-400 text-white" : "bg-white text-gray-700 border hover:bg-gray-50"}`}>
              Morning <div className="text-xs opacity-75">6AM-2PM</div>
            </button>
            <button onClick={() => setSelectedShift("Afternoon")} className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-all ${selectedShift === "Afternoon" ? "bg-yellow-400 text-white" : "bg-white text-gray-700 border hover:bg-gray-50"}`}>
              Afternoon <div className="text-xs opacity-75">2PM-10PM</div>
            </button>
          </div>
        </div>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between"><span className="text-gray-600">Impact Radius</span><span className="font-bold">{impactRadiusKm} KM</span></div>
          <div className="flex items-center justify-between"><span className="text-gray-600">Est. Clear Time</span><span className="font-bold">{estimatedClearMinutes} MIN</span></div>
          <div className="flex items-center justify-between"><span className="text-gray-600">Network Health</span><span className={`font-bold ${networkHealthClass}`}>{networkHealthLabel}</span></div>
        </div>
        <Link to="/optimization" className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-yellow-400 px-3 py-2 text-xs font-semibold text-white hover:bg-yellow-500">
          Run Optimization
        </Link>
      </div>
    </div>
  );
}
