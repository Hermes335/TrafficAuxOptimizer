import { usePageState, useResetPageState } from "../../../contexts/PageStateContext";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronUp, MapPin, X } from "lucide-react";
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
  const [collapsed, setCollapsed] = usePageState(prefix + "collapsed", false);
  const bodyId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const previousPoint = useRef(point);
  const [visibleViewport, setVisibleViewport] = useState<{height: number; inset: number} | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setVisibleViewport({height: viewport.height, inset: Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)});
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => { viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update); };
  }, []);
  useEffect(() => {
    const moved = previousPoint.current.latitude !== point.latitude || previousPoint.current.longitude !== point.longitude;
    previousPoint.current = point;
    if (moved && !request.busy && !persisted) setCollapsed(false);
  }, [point, request, persisted, setCollapsed]);
  useEffect(() => {
    if (collapsed) expandRef.current?.focus();
    else nameRef.current?.focus();
  }, [collapsed]);
  const collapse = () => {
    if (request.busy || saving || disabled) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setCollapsed(true);
  };
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
    <form aria-label={`Create ${kind}`} onSubmit={save}
      style={visibleViewport ? {"--marker-visible-height": `${visibleViewport.height}px`, "--marker-keyboard-inset": `${visibleViewport.inset}px`} as CSSProperties : undefined}
      className="fixed bottom-[calc(var(--marker-keyboard-inset,0px)+0.75rem)] left-3 z-30 flex max-h-[min(24rem,calc(var(--marker-visible-height,100dvh)-1.5rem))] w-80 max-w-[calc(100%-5rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:absolute sm:bottom-auto sm:left-auto sm:right-4 sm:top-20 sm:max-h-[calc(100%-6rem)] sm:w-72 sm:max-w-[calc(100%-2rem)]">
      <header className="flex shrink-0 items-center gap-1 border-b border-slate-100 px-3 py-2">
        <button ref={expandRef} type="button" aria-label={collapsed ? "Continue marker details" : "Minimize marker form"} aria-expanded={!collapsed} aria-controls={bodyId} disabled={saving || disabled} onClick={() => collapsed ? setCollapsed(false) : collapse()} className="flex min-h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg text-left text-sm font-semibold text-slate-900 disabled:opacity-50">
          <span className="min-w-0 truncate">{persisted ? "Saved — refresh pending" : `New ${kind === "poi" ? "point of interest" : "bottleneck"} (unsaved)`}</span>
          {collapsed ? <ChevronUp aria-hidden="true" className="h-4 w-4 shrink-0" /> : <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" />}
        </button>
        {collapsed && <button type="button" aria-label="Cancel marker form" disabled={saving || disabled} onClick={cancel} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X aria-hidden="true" className="h-4 w-4" /></button>}
      </header>
      {collapsed && <p role="status" className="px-3 pb-3 text-xs text-slate-600">{persisted ? "Expand to retry the refresh." : "Tap the map to move this location."}</p>}
      <div id={bodyId} hidden={collapsed} className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-3 py-3">
      {error && <p role="alert" className="break-words text-sm text-red-700">{error}</p>}
      <p className="break-words text-xs text-gray-600">Location: {point.latitude}, {point.longitude}.</p>
      <fieldset disabled={saving || disabled || persisted} className="min-w-0 space-y-3">
        <label className="block text-sm">Name
          <input ref={nameRef} required maxLength={255} value={name} onChange={e=>setName(e.target.value)} className="mt-1 min-h-10 w-full min-w-0 rounded border p-2" />
        </label>
        <label className="block text-sm">Type
          <select value={category} onChange={e=>setCategory(e.target.value)} className="mt-1 min-h-10 w-full min-w-0 rounded border p-2">
            {categories.map(value=><option key={value} value={value}>{value.replace(/_/g," ")}</option>)}
          </select>
        </label>
        {kind === "poi" && <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <PoiSymbol category={category} className="h-9 w-8 shrink-0" />
          <span><strong>{poiCategoryStyle(category).label}</strong><br /><span className="text-xs text-slate-600">Marker preview</span></span>
        </div>}
      </fieldset>
      </div>
      <div hidden={collapsed} className="shrink-0 space-y-2 border-t border-slate-100 px-3 py-3">
        <button type="button" disabled={saving || disabled || persisted} onClick={collapse} className="inline-flex min-h-8 items-center gap-1.5 text-xs font-medium text-slate-600 underline underline-offset-2 disabled:opacity-50"><MapPin aria-hidden="true" className="h-3.5 w-3.5" />Choose location on map</button>
        <div className="flex gap-2">
          <button disabled={saving || disabled || !name.trim()} className="min-h-10 flex-1 rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : persisted ? "Retry refresh" : "Create"}</button>
          <button type="button" disabled={saving || disabled} onClick={cancel} className="min-h-10 flex-1 rounded border px-3 py-2 text-sm">Cancel</button>
        </div>
      </div>
    </form>
  );
}
