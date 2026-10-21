import { usePageState } from "../contexts/PageStateContext";
import { ArrowLeft, Camera, Check, CheckCircle2, ClipboardList, Link2, MapPin, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { fetchIncidentPhoto, fetchReportIncident, fetchReportLocations, fetchReportMeta, saveReportIncident, submitIncidentReport,
  type ReportLocation, type ReportPayload, type ReportReceipt } from "../services/incidentReporting";
import { CameraPhotoPicker } from "./IncidentReport/CameraPhotoPicker";
import { IncidentLocationPicker, validCoordinates, type IncidentCoordinates } from "./IncidentReport/IncidentLocationPicker";

function submissionKey() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const reviewedStatusLabels: Record<string, string> = {
  rejected: "Rejected", resolved: "Resolved", archived: "Archived", investigating: "Investigating",
};

interface IncidentFields {
  incidentType: string;
  severity: string;
  description: string;
  point: IncidentCoordinates | null;
}
type EditField = keyof IncidentFields;
interface EditDraft {
  values: IncidentFields;
  baseline: IncidentFields;
  conflicts: EditField[];
}
const editFieldLabels: Record<EditField, string> = {
  incidentType: "incident type", severity: "severity", description: "description", point: "location",
};

function sameEditValue(field: EditField, first: IncidentFields[EditField], second: IncidentFields[EditField]) {
  if (field !== "point") return first === second;
  const left = first as IncidentCoordinates | null;
  const right = second as IncidentCoordinates | null;
  return left === right || !!left && !!right && left.latitude === right.latitude && left.longitude === right.longitude
    && (left.bottleneck ?? null) === (right.bottleneck ?? null);
}

function refreshEditDraft(draft: EditDraft | null, latest: IncidentFields): EditDraft {
  if (!draft) return {values: latest, baseline: latest, conflicts: []};
  const conflicts: EditField[] = [];
  const merge = <K extends EditField>(field: K): IncidentFields[K] => {
    const value = sameEditValue(field, draft.values[field], draft.baseline[field]) ? latest[field] : draft.values[field];
    if (!sameEditValue(field, value, latest[field]) && (draft.conflicts.includes(field)
      || !sameEditValue(field, latest[field], draft.baseline[field]))) conflicts.push(field);
    return value;
  };
  return {values: {incidentType: merge("incidentType"), severity: merge("severity"), description: merge("description"), point: merge("point")}, baseline: latest, conflicts};
}

export function IncidentReport() {
  const { id: editId } = useParams<{ id?: string }>();
  const { isAuthenticated } = useAuth();
  const isEditing = !!editId;
  const [newIncidentType, setNewIncidentType] = usePageState(`incident.${editId ?? "new"}.incidentType`, "collision");
  const [newSeverity, setNewSeverity] = usePageState(`incident.${editId ?? "new"}.severity`, "major");
  const [newDescription, setNewDescription] = usePageState(`incident.${editId ?? "new"}.description`, "");
  const [newPoint, setNewPoint] = usePageState<IncidentCoordinates | null>(`incident.${editId ?? "new"}.point`, null);
  const [editDraft, setEditDraft] = usePageState<EditDraft | null>(`incident.${editId ?? "new"}.editDraft`, null);
  const incidentType = isEditing ? editDraft?.values.incidentType ?? "collision" : newIncidentType;
  const severity = isEditing ? editDraft?.values.severity ?? "major" : newSeverity;
  const description = isEditing ? editDraft?.values.description ?? "" : newDescription;
  const point = isEditing ? editDraft?.values.point ?? null : newPoint;
  const changeEditField = <K extends EditField>(field: K, value: IncidentFields[K]) => {
    setEditDraft(draft => draft ? {...draft, values: {...draft.values, [field]: value}} : draft);
  };
  const setIncidentType = (value: string) => isEditing ? changeEditField("incidentType", value) : setNewIncidentType(value);
  const setSeverity = (value: string) => isEditing ? changeEditField("severity", value) : setNewSeverity(value);
  const setDescription = (value: string) => isEditing ? changeEditField("description", value) : setNewDescription(value);
  const setPoint = (value: IncidentCoordinates | null) => isEditing ? changeEditField("point", value) : setNewPoint(value);
  const [locations, setLocations] = useState<ReportLocation[]>([]);
  const [incidentTypes, setIncidentTypes] = useState<Array<{value: string; label: string}>>([]);
  const [severities, setSeverities] = useState<Array<{value: string; label: string}>>([]);
  const [photo, setPhoto] = usePageState<File | null>(`incident.${editId ?? "new"}.photo`, null);
  const [existingPhoto, setExistingPhoto] = useState<string | null>(null);
  const [saving, setSaving] = usePageState(`incident.${editId ?? "new"}.saving`, false);
  const [savingRef] = usePageState(`incident.${editId ?? "new"}.savingRef`, () => ({current: false}));
  const [waitingForSave, setWaitingForSave] = useState(() => isEditing && savingRef.current);
  const deferredSaveRefresh = useRef(waitingForSave);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = usePageState<string | null>(`incident.${editId ?? "new"}.error`, null);
  const [warning, setWarning] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);
  const [receipt, setReceipt] = usePageState<ReportReceipt | null>(`incident.${editId ?? "new"}.receipt`, null);
  const [uncertain, setUncertain] = usePageState(`incident.${editId ?? "new"}.uncertain`, false);
  const [editedAfterRetry, setEditedAfterRetry] = usePageState(`incident.${editId ?? "new"}.editedAfterRetry`, false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [referenceCopied, setReferenceCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [attemptedPayload] = usePageState(`incident.${editId ?? "new"}.attempt`, () => ({current: null as ReportPayload | null}));
  const [key] = usePageState(`incident.${editId ?? "new"}.key`, () => ({current: submissionKey()}));
  const [initialized] = usePageState(`incident.${editId ?? "new"}.initialized`, () => ({current: false}));
  const resultRef = useRef<HTMLDivElement>(null);
  const busy = saving || loading || !loaded || uncertain;

  useEffect(() => {
    if (waitingForSave && !saving) setWaitingForSave(false);
  }, [saving, waitingForSave]);

  useEffect(() => {
    // A returning editor must read the server after its pending update completes.
    // An earlier read could otherwise restore data from before that update.
    if (waitingForSave) return;
    let active = true;
    let photoUrl: string | null = null;
    setLoading(true); setLoaded(false);
    // Refreshing after a pending update must keep any failure from that update visible.
    if (!uncertain && !deferredSaveRefresh.current) setError(null);
    deferredSaveRefresh.current = false;
    setWarning(null); setUpdated(false); setExistingPhoto(null);
    const id = editId ? Number(editId) : null;
    if (id !== null && (!Number.isSafeInteger(id) || id < 1)) { setError("This incident link is invalid."); setLoading(false); return; }
    Promise.all([
      fetchReportLocations().catch(() => {
        if (active) setWarning("Known intersections are unavailable. You can still place a pin or enter coordinates.");
        return [] as ReportLocation[];
      }),
      fetchReportMeta(),
      id !== null ? fetchReportIncident(id) : Promise.resolve(null),
    ]).then(([rows, meta, incident]) => {
      if (!active) return;
      setLocations(rows.filter(row => validCoordinates({ latitude: Number(row.latitude), longitude: Number(row.longitude) })));
      setIncidentTypes(meta.incident_types); setSeverities(meta.severities);
      if (incident) {
        const knownLocation = rows.find(row => row.id === incident.bottleneck);
        const coords = incident.latitude === null || incident.longitude === null
          ? knownLocation ? { latitude: Number(knownLocation.latitude), longitude: Number(knownLocation.longitude) } : null
          : { latitude: Number(incident.latitude), longitude: Number(incident.longitude) };
        setEditDraft(draft => refreshEditDraft(draft, {
          incidentType: incident.incident_type, severity: incident.severity, description: incident.description,
          point: validCoordinates(coords) ? { ...coords, ...(incident.bottleneck ? { bottleneck: incident.bottleneck } : {}) } : null,
        }));
        if (incident.photo_url) {
          void fetchIncidentPhoto(incident.id).then(blob => {
            if (!active) return;
            photoUrl = URL.createObjectURL(blob); setExistingPhoto(photoUrl);
          }).catch(() => { if (active) setWarning("The existing photo could not load. You can still update the incident details."); });
        }
      } else if (!initialized.current) {
        setIncidentType(meta.incident_types[0]?.value ?? "collision");
        setSeverity(meta.severities.find(item => item.value === "major")?.value ?? meta.severities[0]?.value ?? "major");
      }
      if (!meta.incident_types.length || !meta.severities.length) throw new Error("Report options are unavailable. Please retry loading.");
      initialized.current = true;
      setLoaded(true);
    }).catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : "The report form could not load."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; if (photoUrl) URL.revokeObjectURL(photoUrl); };
  }, [editId, loadAttempt, waitingForSave]);

  useEffect(() => {
    if (error || receipt || updated) { resultRef.current?.focus(); resultRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }
  }, [error, receipt, updated]);

  const onSubmit = async () => {
    if (!loaded || loading || savingRef.current) return;
    if (isEditing && editDraft?.conflicts.length) { setError("Choose which changes to keep before updating this report."); return; }
    if (!validCoordinates(point)) { setError("Choose the incident location by placing a pin, using your location, or entering coordinates."); return; }
    if (!description.trim()) { setError("Please enter a description of the incident."); return; }
    const payload: ReportPayload = uncertain && attemptedPayload.current ? attemptedPayload.current : {
      latitude: point.latitude, longitude: point.longitude, ...(point.bottleneck ? { bottleneck: point.bottleneck } : {}), incident_type: incidentType, severity,
      description: description.trim(), ...(photo ? { photo } : {}), submission_key: key.current,
    };
    savingRef.current = true; setSaving(true); setError(null); setUpdated(false);
    try {
      if (isEditing) {
        await saveReportIncident(Number(editId), {
          latitude: payload.latitude, longitude: payload.longitude, ...(payload.bottleneck ? { bottleneck: payload.bottleneck } : {}), incident_type: payload.incident_type,
          severity: payload.severity, description: payload.description,
        });
        const saved: IncidentFields = {incidentType: payload.incident_type, severity: payload.severity, description: payload.description,
          point: {latitude: payload.latitude, longitude: payload.longitude, ...(payload.bottleneck ? {bottleneck: payload.bottleneck} : {})}};
        setEditDraft({values: saved, baseline: saved, conflicts: []});
        setUpdated(true);
      } else {
        attemptedPayload.current = payload;
        const received = await submitIncidentReport(payload);
        setReceipt(received); setReferenceCopied(false); setCopyError(null); setUncertain(false); attemptedPayload.current = null;
        setDescription(""); setPhoto(null); setPoint(null); key.current = submissionKey();
      }
    } catch (failure: unknown) {
      const message = failure instanceof Error ? failure.message : "Your report could not be saved. Please try again.";
      const status = typeof failure === "object" && failure && "status" in failure ? Number(failure.status) : 0;
      // A later rejection cannot disprove receipt of an earlier timed-out attempt.
      const mayHaveArrived = !isEditing && (uncertain || !status || status >= 500);
      setUncertain(mayHaveArrived);
      setError(mayHaveArrived ? `${message} We could not confirm receipt. Retry the same report to check safely.` : message);
      if (!mayHaveArrived && !isEditing) { attemptedPayload.current = null; key.current = submissionKey(); }
    } finally { savingRef.current = false; setSaving(false); }
  };

  const resolveConflict = (field: EditField, useLatest: boolean) => {
    setEditDraft(draft => draft ? {...draft,
      values: useLatest ? {...draft.values, [field]: draft.baseline[field]} : draft.values,
      conflicts: draft.conflicts.filter(conflict => conflict !== field),
    } : draft);
    setError(null);
  };
  const latestFieldValue = (field: EditField) => {
    const values = editDraft!.baseline;
    if (field === "point") return values.point ? `${values.point.latitude.toFixed(6)}, ${values.point.longitude.toFixed(6)}` : "No location selected";
    if (field === "incidentType") return incidentTypes.find(type => type.value === values.incidentType)?.label ?? values.incidentType;
    if (field === "severity") return severities.find(level => level.value === values.severity)?.label ?? values.severity;
    return values.description;
  };

  const PageContainer = isEditing ? "div" : "main";
  return <PageContainer className="min-h-screen bg-slate-50 text-slate-900">
    {!isEditing && <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-400 text-slate-950"><MapPin size={22} /></span><div><p className="text-sm font-bold tracking-tight">TrafficOffOptimizer</p><p className="text-xs text-slate-500">{isAuthenticated ? "Staff incident reporting" : "Community incident reporting"}</p></div></div>
        {isAuthenticated && <Link to="/" className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 sm:text-sm"><ArrowLeft size={16} />Dashboard</Link>}
      </div>
    </header>}
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-10">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div><p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-amber-700">{isAuthenticated ? "Staff incident management" : "Safer roads start with you"}</p><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{isEditing ? "Edit incident report" : "Report a road incident"}</h1><p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-600">{isEditing ? "Keep the location and details accurate for the operations team." : "Mark the location, tell us what happened, and add a photo if you can."}</p>{!isEditing && <p className="mt-3 rounded-lg bg-sky-50 p-3 text-sm font-medium text-sky-950">{isAuthenticated ? "Staff report — becomes active immediately after submission." : "Public report — staff review it before it becomes an active incident. No account needed."}</p>}</div>
        {isAuthenticated && !isEditing && <Link to="/incident-review" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"><ClipboardList size={17} />Review public reports</Link>}
      </div>

      {receipt ? <div ref={resultRef} tabIndex={-1} className="mx-auto max-w-xl rounded-3xl border border-emerald-200 bg-white p-6 text-center shadow-sm sm:p-10">
        <CheckCircle2 className="mx-auto mb-5 h-12 w-12 text-emerald-600" />
        <h2 className="text-2xl font-bold">{receipt.status === "active" ? "Incident reported" : receipt.status === "pending" ? "Report received for review" : "Report status confirmed"}</h2>
        <p role="status" className="mt-3 text-sm leading-relaxed text-slate-600">{receipt.status === "active" ? "Your incident is now available to the operations team on the dashboard." : receipt.status === "pending" ? "Thank you. The operations team will review your report before it appears as an active incident."
          : reviewedStatusLabels[receipt.status] ? `This report has already been reviewed. Current status: ${reviewedStatusLabels[receipt.status]}.` : "Your report is already recorded. Keep the reference below for your records."}</p>
        <div className="my-6 rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your report reference</p><p className="mt-2 break-all font-mono text-lg font-semibold text-slate-900">{receipt.reference}</p></div>
        <button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(receipt.reference); setReferenceCopied(true); setCopyError(null); }
          catch { setCopyError("Copy failed. Select the reference text above to copy it manually."); }
        }} className="mb-3 min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700">{referenceCopied ? "Reference copied" : "Copy reference"}</button>
        {referenceCopied && <p role="status" className="mb-3 text-xs text-emerald-800">Report reference copied.</p>}
        {copyError && <p role="alert" className="mb-3 text-xs text-red-800">{copyError}</p>}
        <p className="mb-6 text-xs text-slate-500">You can keep this reference and close the page.</p>
        <button type="button" onClick={() => { setReceipt(null); setError(null); setEditedAfterRetry(false); }} className="min-h-12 w-full rounded-xl bg-amber-400 px-4 font-semibold text-slate-950 hover:bg-amber-300">Report another incident</button>
        {isAuthenticated && <Link to="/" className="mt-4 inline-flex min-h-10 items-center text-sm font-semibold text-slate-700">Return to dashboard</Link>}
      </div> : <form noValidate onSubmit={event => { event.preventDefault(); void onSubmit(); }}>
        <div className="grid items-start gap-5 lg:grid-cols-2 lg:gap-6">
          <section aria-labelledby="location-heading" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="mb-4 flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-amber-100 text-sm font-bold text-amber-900">1</span><div><h2 id="location-heading" className="font-bold">Incident location</h2><p className="text-xs text-slate-500">Choose the exact spot</p></div></div>
            <IncidentLocationPicker value={point} onChange={setPoint} locations={locations} disabled={busy} />
          </section>
          <div className="space-y-5">
            <section aria-labelledby="details-heading" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="mb-5 flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-amber-100 text-sm font-bold text-amber-900">2</span><div><h2 id="details-heading" className="font-bold">What happened?</h2><p className="text-xs text-slate-500">Help staff understand the situation</p></div></div>
              <fieldset disabled={busy} className="mb-5"><legend className="mb-2 text-sm font-semibold text-slate-700">Incident type</legend><div className="grid grid-cols-2 gap-2">
                {incidentTypes.map(type => <button key={type.value} type="button" aria-pressed={incidentType === type.value} onClick={() => setIncidentType(type.value)} className={`flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium disabled:opacity-50 ${incidentType === type.value ? "border-amber-500 bg-amber-50 text-amber-950" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>{type.label}{incidentType === type.value && <Check size={15} className="shrink-0" />}</button>)}
              </div></fieldset>
              <fieldset disabled={busy} className="mb-5"><legend className="mb-2 text-sm font-semibold text-slate-700">Severity</legend><div className="flex flex-wrap gap-2">
                {severities.map(level => <button key={level.value} type="button" aria-pressed={severity === level.value} onClick={() => setSeverity(level.value)} className={`min-h-11 flex-1 rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50 ${severity === level.value ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{level.label}</button>)}
              </div></fieldset>
              <label htmlFor="incident-description" className="mb-2 block text-sm font-semibold text-slate-700">Description <span className="font-normal text-slate-500">(required)</span></label>
              <textarea id="incident-description" value={description} onChange={event => setDescription(event.target.value)} disabled={busy} maxLength={3000} required rows={4} placeholder="What is happening? Include nearby landmarks, blocked lanes, or other useful details." className="w-full resize-y rounded-xl border border-slate-300 px-3 py-3 text-sm leading-relaxed placeholder:text-slate-400 disabled:bg-slate-50" />
              <p className="mt-1 text-right text-xs text-slate-400">{description.length}/3,000</p>
            </section>
            <section aria-labelledby="photo-heading" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="mb-4 flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-slate-600"><Camera size={16} /></span><div><h2 id="photo-heading" className="font-bold">Photo <span className="text-sm font-normal text-slate-500">(optional)</span></h2><p className="text-xs text-slate-500">Give the team a clearer picture</p></div></div>
              {isEditing ? <><p className="text-sm text-slate-600">Existing report photos are preserved when you update the details.</p>{existingPhoto ? <img src={existingPhoto} alt="Existing incident photo" className="mt-3 max-h-64 w-full rounded-xl object-contain" /> : <p className="mt-2 text-xs text-slate-500">No photo is available to preview.</p>}</> : <CameraPhotoPicker photo={photo} onChange={setPhoto} disabled={busy} />}
            </section>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:col-span-2">
            <div ref={resultRef} tabIndex={-1}>
              {loading && <p role="status" className="mb-4 text-sm text-slate-600">Loading report form...</p>}
              {warning && <p role="status" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{warning}</p>}
              {!!editDraft?.conflicts.length && <div role="alert" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                <p className="font-semibold">This report changed while you were away. Review these fields before updating.</p>
                {editDraft.conflicts.map(field => <div key={field} className="mt-3 border-t border-amber-200 pt-3">
                  <p className="font-semibold capitalize">{editFieldLabels[field]}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words">Latest saved value: {latestFieldValue(field)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" disabled={saving || loading} aria-label={`Keep my ${editFieldLabels[field]}`} onClick={() => resolveConflict(field, false)} className="min-h-11 rounded-lg border border-amber-300 bg-white px-3 font-semibold">Keep my change</button>
                    <button type="button" disabled={saving || loading} aria-label={`Use latest ${editFieldLabels[field]}`} onClick={() => resolveConflict(field, true)} className="min-h-11 rounded-lg border border-amber-300 bg-white px-3 font-semibold">Use latest</button>
                  </div>
                </div>)}
              </div>}
              {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm leading-relaxed text-red-800">{error}</p>}
              {updated && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">Incident updated successfully.</p>}
            </div>
            {!loading && !loaded && <button type="button" onClick={() => setLoadAttempt(value => value + 1)} className="mb-4 min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold">Retry loading</button>}
            {editedAfterRetry && <p className="mb-4 text-sm text-amber-800">The earlier report may already have arrived. Sending a changed report could create a duplicate.</p>}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-xl text-xs leading-relaxed text-slate-500">{isEditing ? "Changes update the incident location and details for the operations team." : isAuthenticated ? "You are reporting as staff. Your incident will become active immediately." : "No account needed. Public reports are reviewed by staff before becoming active incidents."}</p>
              <button type="submit" disabled={saving || loading || !loaded || !!editDraft?.conflicts.length} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-400 px-6 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"><Send size={17} />{saving ? "Sending..." : isEditing ? "Update report" : uncertain ? "Retry same report" : isAuthenticated ? "Create active incident" : "Submit report"}</button>
            </div>
            {uncertain && <button type="button" disabled={saving} onClick={() => { setUncertain(false); setEditedAfterRetry(true); attemptedPayload.current = null; key.current = submissionKey(); setError(null); }} className="mt-4 min-h-11 text-sm font-semibold text-slate-600 underline underline-offset-4">Edit report before trying again</button>}
          </div>
        </div>
      </form>}
      <footer className="mt-7 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500"><p>TrafficOffOptimizer · Iloilo incident reporting</p>{!isEditing && <button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(`${window.location.origin}/incident-report`); setLinkCopied(true); }
        catch { setLinkCopied(false); }
      }} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 font-medium text-slate-600 hover:bg-slate-100"><Link2 size={15} />{linkCopied ? "Link copied" : "Copy report link"}</button>}</footer>
    </div>
  </PageContainer>;
}
