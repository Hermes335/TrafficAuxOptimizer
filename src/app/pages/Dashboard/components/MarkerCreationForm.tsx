import { usePageState, useResetPageState } from "../../../contexts/PageStateContext";
import { useLayoutEffect } from "react";
import { createDashboardBottleneck, createPOI } from "../../../services/backend";
import { poiCategories, PoiSymbol, poiCategoryStyle } from "../../../services/poiMarker";

type Kind = "bottleneck" | "poi";
interface Props {
  kind: Kind;
  point: {latitude:number; longitude:number};
  onSaved: () => Promise<void>;
  onCancel: () => void;
  disabled?: boolean;
}
export function MarkerCreationForm({kind, point, onSaved, onCancel, disabled = false}: Props) {
  const prefix = `marker.${kind}.`;
  const resetDraft = useResetPageState(prefix);
  const [name, setName] = usePageState(prefix + "name", "");
  const [category, setCategory] = usePageState(prefix + "category", kind === "bottleneck" ? "intersection" : "other");
  const [error, setError] = usePageState<string | null>(prefix + "error", null);
  const [saving, setSaving] = usePageState("marker.saving", false);
  const [request] = usePageState("marker.request", () => ({busy: false, onSaved}));
  useLayoutEffect(() => { request.onSaved = onSaved; }, [request, onSaved]);
  const cancel = () => { if (request.busy || disabled) return; resetDraft(); onCancel(); };
  const [persisted, setPersisted] = usePageState(prefix + "persisted", false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (request.busy || disabled || !name.trim()) return;
    request.busy = true; setSaving(true); setError(null);
    try {
      if (!persisted) {
        if (kind === "bottleneck") await createDashboardBottleneck({name:name.trim(), ...point, district:"Iloilo City", bottleneck_type:category as "intersection"});
        else await createPOI({name:name.trim(), ...point, category, priority_boost:1});
        setPersisted(true);
      }
      await request.onSaved();
      resetDraft();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to save. Please retry."); }
    finally { request.busy = false; setSaving(false); }
  };
  const categories = kind === "bottleneck" ? ["intersection","bridge","school_zone","market","terminal","other"] :
    poiCategories.map(item => item.value);
  return (
    <form aria-label={`Create ${kind}`} onSubmit={save} className="absolute right-4 top-20 z-30 w-72 space-y-3 rounded-xl bg-white p-4 shadow-xl">
      <h3 className="font-semibold">{persisted ? "Saved — refresh pending" : `New ${kind} (unsaved)`}</h3>
      <p className="text-xs text-gray-600">Location: {point.latitude}, {point.longitude}. Click the map to reposition.</p>
      <fieldset disabled={saving || disabled || persisted} className="space-y-3">
        <label className="block text-sm">Name
          <input autoFocus required maxLength={255} value={name} onChange={e=>setName(e.target.value)} className="mt-1 w-full rounded border p-2" />
        </label>
        <label className="block text-sm">Type
          <select value={category} onChange={e=>setCategory(e.target.value)} className="mt-1 w-full rounded border p-2">
            {categories.map(value=><option key={value} value={value}>{value.replace(/_/g," ")}</option>)}
          </select>
        </label>
        {kind === "poi" && <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <PoiSymbol category={category} className="h-9 w-8 shrink-0" />
          <span><strong>{poiCategoryStyle(category).label}</strong><br /><span className="text-xs text-slate-600">Marker preview</span></span>
        </div>}
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button disabled={saving || disabled || !name.trim()} className="rounded bg-orange-700 px-3 py-2 text-white disabled:opacity-50">{saving ? "Saving…" : persisted ? "Retry refresh" : "Create"}</button>
        <button type="button" disabled={saving || disabled} onClick={cancel} className="rounded border px-3 py-2">Cancel</button>
      </div>
    </form>
  );
}
