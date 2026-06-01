import { X } from "lucide-react";

interface EditBottleneckOverlayProps {
  editBottleneckName: string; setEditBottleneckName: (v: string) => void;
  editBottleneckDistrict: string; setEditBottleneckDistrict: (v: string) => void;
  editBottleneckType: string; setEditBottleneckType: (v: string) => void;
  editBottleneckWeight: string; setEditBottleneckWeight: (v: string) => void;
  editLatitude: string; setEditLatitude: (v: string) => void;
  editLongitude: string; setEditLongitude: (v: string) => void;
  editPickFromMap: boolean; setEditPickFromMap: (v: boolean) => void;
  onSave: () => Promise<void>;
  onClose: () => void;
  savingEditBottleneck: boolean;
}

export function EditBottleneckOverlay({
  editBottleneckName, setEditBottleneckName,
  editBottleneckDistrict, setEditBottleneckDistrict,
  editBottleneckType, setEditBottleneckType,
  editBottleneckWeight, setEditBottleneckWeight,
  editLatitude, setEditLatitude,
  editLongitude, setEditLongitude,
  editPickFromMap, setEditPickFromMap,
  onSave, onClose, savingEditBottleneck,
}: EditBottleneckOverlayProps) {
  return (
    <div className="absolute left-4 top-20 z-30 w-80 rounded-lg border bg-white p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Edit Bottleneck</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600">Name</label>
          <input type="text" value={editBottleneckName} onChange={(e) => setEditBottleneckName(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">District</label>
          <input type="text" value={editBottleneckDistrict} onChange={(e) => setEditBottleneckDistrict(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Type</label>
          <select value={editBottleneckType} onChange={(e) => setEditBottleneckType(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 text-sm">
            <option value="intersection">Intersection</option>
            <option value="bridge">Bridge</option>
            <option value="school_zone">School Zone</option>
            <option value="market">Market</option>
            <option value="terminal">Terminal</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Priority Weight</label>
          <input type="number" value={editBottleneckWeight} onChange={(e) => setEditBottleneckWeight(e.target.value)} min="0.1" step="0.1" className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-600">Latitude</label>
            <input type="number" value={editLatitude} onChange={(e) => setEditLatitude(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Longitude</label>
            <input type="number" value={editLongitude} onChange={(e) => setEditLongitude(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={editPickFromMap} onChange={(e) => setEditPickFromMap(e.target.checked)} />
          Pick from map
        </label>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded border px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={onSave} disabled={savingEditBottleneck} className="flex-1 rounded bg-yellow-400 px-3 py-1.5 text-sm font-medium text-white hover:bg-yellow-500 disabled:cursor-not-allowed disabled:bg-yellow-300">
            {savingEditBottleneck ? "Saving..." : "Update"}
          </button>
        </div>
      </div>
    </div>
  );
}
