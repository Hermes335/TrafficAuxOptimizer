import { MapPin, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { StaffingProfileFields, validateStaffingProfile } from "../../../components/StaffingProfileFields";
import type { StaffingProfile } from "../../../services/backend";

interface EditBottleneckOverlayProps {
  error?: string | null;
  editingBottleneckId?: string | null;
  editBottleneckDirty?: boolean;
  areaNames?: string[];
  editStaffing: StaffingProfile; setEditStaffing: (value: StaffingProfile) => void;
  editBottleneckName: string; setEditBottleneckName: (v: string) => void;
  editBottleneckDistrict: string; setEditBottleneckDistrict: (v: string) => void;
  editBottleneckType: string; setEditBottleneckType: (v: string) => void;
  editBottleneckWeight: string; setEditBottleneckWeight: (v: string) => void;
  editLatitude: string; setEditLatitude: (v: string) => void;
  editLongitude: string; setEditLongitude: (v: string) => void;
  editPickFromMap: boolean; setEditPickFromMap: (v: boolean) => void;
  onSave: () => Promise<void>;
  onClose: () => void;
  onFocusMap?: () => void;
  savingEditBottleneck: boolean;
}

export function EditBottleneckOverlay({
  error, editingBottleneckId, editBottleneckDirty = true, areaNames = [],
  editStaffing, setEditStaffing,
  editBottleneckName, setEditBottleneckName,
  editBottleneckDistrict, setEditBottleneckDistrict,
  editBottleneckType, setEditBottleneckType,
  editBottleneckWeight, setEditBottleneckWeight,
  editLatitude, setEditLatitude, editLongitude, setEditLongitude,
  editPickFromMap, setEditPickFromMap,
  onSave, onClose, onFocusMap, savingEditBottleneck,
}: EditBottleneckOverlayProps) {
  const areaListId = useId();
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const [viewport, setViewport] = useState(() => ({height: window.visualViewport?.height ?? window.innerHeight, top: window.visualViewport?.offsetTop ?? 0}));
  const bodyRef = useRef<HTMLDivElement>(null);
  const pickButtonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  const savingRef = useRef(savingEditBottleneck);
  const pickingRef = useRef(editPickFromMap);
  const returnFromPick = useRef(false);
  const savedScroll = useRef(0);
  const openerRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  closeRef.current = onClose;
  savingRef.current = savingEditBottleneck;
  pickingRef.current = editPickFromMap;
  const [coordinatesOpen, setCoordinatesOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const errors = validateStaffingProfile(editStaffing);
  if (!editBottleneckName.trim()) errors.name = "Enter a bottleneck name.";
  else if (editBottleneckName.trim().length > 255) errors.name = "Use 255 characters or fewer.";
  if (editBottleneckDistrict.trim().length > 120) errors.district = "Use 120 characters or fewer.";
  const latitude = Number(editLatitude), longitude = Number(editLongitude), weight = Number(editBottleneckWeight);
  if (!editLatitude.trim() || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    errors.latitude = "Enter a latitude between -90 and 90.";
  }
  if (!editLongitude.trim() || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    errors.longitude = "Enter a longitude between -180 and 180.";
  }
  if (!editBottleneckWeight.trim() || !Number.isFinite(weight) || weight < 0) {
    errors.weight = "Enter a priority weight of zero or greater.";
  }
  const hasErrors = Object.keys(errors).length > 0;
  const visibleError = (field: string) => (validationAttempt > 0 || touched[field]) ? errors[field] : undefined;
  const fieldProps = (field: string) => ({
    "aria-invalid": !!visibleError(field),
    "aria-describedby": visibleError(field) ? `edit-${field}-error` : undefined,
    onBlur: () => setTouched(current => ({ ...current, [field]: true })),
  });
  const fieldError = (field: string) => visibleError(field)
    ? <p id={`edit-${field}-error`} className="mt-1 text-xs text-rose-700">{visibleError(field)}</p>
    : null;
  const inputClass = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 sm:text-sm aria-invalid:border-rose-500 disabled:bg-slate-50";

  useEffect(() => {
    const resize = () => {
      setMobile(window.innerWidth < 768);
      setViewport({height: window.visualViewport?.height ?? window.innerHeight, top: window.visualViewport?.offsetTop ?? 0});
    };
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
    };
  }, []);

  useEffect(() => {
    if (mobile && !editPickFromMap) return; // The modal owns Escape while open.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="alertdialog"], [role="dialog"]')) return;
      event.preventDefault();
      if (savingRef.current) return;
      if (pickingRef.current) {
        returnFromPick.current = true;
        setEditPickFromMap(false);
      } else closeRef.current();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [mobile, editPickFromMap, setEditPickFromMap]);

  useEffect(() => {
    if (editPickFromMap) {
      window.requestAnimationFrame(() => onFocusMap?.());
    } else if (returnFromPick.current && !mobile) {
      const frame = window.requestAnimationFrame(() => {
        if (bodyRef.current) bodyRef.current.scrollTop = savedScroll.current;
        pickButtonRef.current?.focus({preventScroll: true});
        returnFromPick.current = false;
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [editPickFromMap, mobile, onFocusMap]);

  const finishPicking = () => {
    if (savingEditBottleneck) return;
    returnFromPick.current = true;
    setEditPickFromMap(false);
  };

  useEffect(() => {
    if (!validationAttempt) return;
    const frame = window.requestAnimationFrame(() => {
      const firstError = bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      firstError?.focus();
      firstError?.scrollIntoView?.({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [validationAttempt]);

  const submit = () => {
    if (savingEditBottleneck || !editBottleneckDirty || editPickFromMap) return;
    setValidationAttempt(attempt => attempt + 1);
    if (hasErrors) {
      if (errors.latitude || errors.longitude) setCoordinatesOpen(true);
      if (errors.weight) setAdvancedOpen(true);
      return;
    }
    void onSave();
  };

  const contents = <>
      <div data-bottleneck-editor-header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          {mobile && !editPickFromMap
            ? <Dialog.Title asChild><h3 className="text-base font-semibold text-slate-950">Edit bottleneck</h3></Dialog.Title>
            : <h3 className="text-base font-semibold text-slate-950">Edit bottleneck</h3>}
          {editingBottleneckId && <p className="truncate text-xs text-slate-500" title={editingBottleneckId}>{editingBottleneckId}</p>}
        </div>
        <button type="button" onClick={onClose} disabled={savingEditBottleneck} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-amber-600 disabled:opacity-50" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>

      {editPickFromMap && <div className="space-y-3 bg-amber-50 px-4 py-3">
        <p className="text-sm font-medium text-amber-950">Choose a position on the map.</p>
        <p className="text-xs text-slate-600">Your other edits are kept. Choose a point, then finish picking.</p>
        <p role="status" className="break-words text-xs tabular-nums text-slate-700">Selected: {editLatitude || "—"}, {editLongitude || "—"}</p>
        <button type="button" disabled={savingEditBottleneck} onClick={finishPicking} className="min-h-11 w-full rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-500">Done picking</button>
      </div>}

      <form aria-label="Edit bottleneck details" noValidate onSubmit={event => { event.preventDefault(); submit(); }} className={editPickFromMap ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        <fieldset disabled={savingEditBottleneck} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={bodyRef} data-bottleneck-editor-body className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
            <section aria-labelledby="edit-basic-heading" className="space-y-3">
              <h4 id="edit-basic-heading" className="text-sm font-semibold text-slate-900">Basic details</h4>
              <div>
                <label htmlFor="node-name" className="text-xs font-medium text-slate-700">Name</label>
                <input autoFocus={!mobile && !editPickFromMap} required type="text" id="node-name" maxLength={255} value={editBottleneckName} onChange={e => setEditBottleneckName(e.target.value)} className={inputClass} {...fieldProps("name")} />
                {fieldError("name")}
              </div>
              <div>
                <label htmlFor="node-area" className="text-xs font-medium text-slate-700">Area / group name</label>
                <input id="node-area" list={areaListId} maxLength={120} value={editStaffing.area_name} onChange={e => setEditStaffing({ ...editStaffing, area_name: e.target.value })} placeholder="Choose or enter an area" className={inputClass} {...fieldProps("area_name")} />
                <datalist id={areaListId}>{areaNames.map(name => <option key={name} value={name} />)}</datalist>
                {fieldError("area_name")}
                <p className="mt-1 text-xs text-slate-500">Use the same area name for nearby intersections.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="node-district" className="text-xs font-medium text-slate-700">District</label>
                  <input type="text" id="node-district" maxLength={120} value={editBottleneckDistrict} onChange={e => setEditBottleneckDistrict(e.target.value)} className={inputClass} {...fieldProps("district")} />
                  {fieldError("district")}
                </div>
                <div>
                  <label htmlFor="node-type" className="text-xs font-medium text-slate-700">Type</label>
                  <select id="node-type" value={editBottleneckType} onChange={e => setEditBottleneckType(e.target.value)} className={inputClass}>
                    <option value="intersection">Intersection</option><option value="bridge">Bridge</option>
                    <option value="school_zone">School Zone</option><option value="market">Market</option>
                    <option value="terminal">Terminal</option><option value="other">Other</option>
                  </select>
                </div>
              </div>
            </section>

            <section aria-labelledby="edit-location-heading" className="space-y-2 border-t border-slate-100 pt-4">
              <h4 id="edit-location-heading" className="text-sm font-semibold text-slate-900">Location</h4>
              <button ref={pickButtonRef} type="button" onClick={() => {
                savedScroll.current = bodyRef.current?.scrollTop ?? 0;
                setEditPickFromMap(true);
              }} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><MapPin className="h-4 w-4" />Pick location on map</button>
              <details open={coordinatesOpen} onToggle={e => setCoordinatesOpen(e.currentTarget.open)}>
                <summary className="cursor-pointer py-1 text-xs font-medium text-slate-600">Edit coordinates</summary>
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div>
                    <label htmlFor="node-lat" className="text-xs font-medium text-slate-700">Latitude</label>
                    <input type="number" step="any" min={-90} max={90} required id="node-lat" value={editLatitude} onChange={e => setEditLatitude(e.target.value)} className={inputClass} {...fieldProps("latitude")} />
                    {fieldError("latitude")}
                  </div>
                  <div>
                    <label htmlFor="node-lon" className="text-xs font-medium text-slate-700">Longitude</label>
                    <input type="number" step="any" min={-180} max={180} required id="node-lon" value={editLongitude} onChange={e => setEditLongitude(e.target.value)} className={inputClass} {...fieldProps("longitude")} />
                    {fieldError("longitude")}
                  </div>
                </div>
              </details>
            </section>

            <StaffingProfileFields value={editStaffing} onChange={setEditStaffing} hideArea showValidation={validationAttempt > 0} />

            <details open={advancedOpen} onToggle={e => setAdvancedOpen(e.currentTarget.open)} className="border-t border-slate-100 pt-3">
              <summary className="cursor-pointer py-1 text-sm font-semibold text-slate-900">Advanced settings</summary>
              <div className="pt-3">
                <label htmlFor="node-weight" className="text-xs font-medium text-slate-700">Priority weight</label>
                <input type="number" id="node-weight" required value={editBottleneckWeight} onChange={e => setEditBottleneckWeight(e.target.value)} min="0" step="any" className={inputClass} {...fieldProps("weight")} />
                {fieldError("weight")}
                <p className="mt-1 text-xs text-slate-500">Higher values give this location more priority during optimization.</p>
              </div>
            </details>
          </div>

          <div data-bottleneck-editor-footer className="shrink-0 space-y-2 border-t border-slate-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {error && <p role="alert" className="max-h-20 overflow-y-auto rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>}
            {validationAttempt > 0 && hasErrors ? <p role="alert" className="text-xs text-rose-700">Check the highlighted fields before saving.</p>
              : <p className="text-xs text-slate-500">{savingEditBottleneck ? "Saving your changes…" : editBottleneckDirty ? "Unsaved changes" : "No changes yet"}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={savingEditBottleneck || !editBottleneckDirty} className="min-h-11 flex-1 rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50">{savingEditBottleneck ? "Saving..." : "Save changes"}</button>
            </div>
          </div>
        </fieldset>
      </form>
  </>;

  if (mobile && !editPickFromMap) return <Dialog.Root open onOpenChange={open => {if (!open && !savingEditBottleneck) onClose();}}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/30" />
      <Dialog.Content aria-label="Edit bottleneck" aria-describedby={undefined}
        style={{height: viewport.height, top: viewport.top}}
        className="fixed inset-x-0 z-50 flex min-h-0 flex-col overflow-hidden bg-white shadow-xl outline-none"
        onInteractOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => {event.preventDefault(); if (!savingEditBottleneck) onClose();}}
        onOpenAutoFocus={event => {
          event.preventDefault();
          if (returnFromPick.current) {
            // Let the previous focus scope finish closing before restoring the
            // map-picking control in the newly mounted editor.
            window.requestAnimationFrame(() => {
              if (bodyRef.current) bodyRef.current.scrollTop = savedScroll.current;
              pickButtonRef.current?.focus({preventScroll: true});
              returnFromPick.current = false;
            });
          } else document.getElementById("node-name")?.focus();
        }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (pickingRef.current) onFocusMap?.();
          else {
            const opener = openerRef.current;
            const visibleOpener = opener?.isConnected && opener.getClientRects().length > 0;
            if (visibleOpener) opener.focus();
            else document.querySelector<HTMLElement>('button[aria-label="Add Marker"]')?.focus();
          }
        }}>
        {contents}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;

  return <div role="region" aria-label="Edit bottleneck" className={`absolute bottom-3 left-3 z-30 flex max-h-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ${editPickFromMap ? "w-[min(28rem,calc(100%-5rem))]" : "top-20 w-[min(28rem,calc(100%-1.5rem))]"}`}>
    {contents}
  </div>;
}
