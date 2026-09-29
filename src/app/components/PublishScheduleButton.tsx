import { useEffect, useRef, useState } from "react";
import { Eye, TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { previewPublication, publishDeploymentsFromOptimization, type PublicationPreview, type PublishOptimizationDeploymentsRequest } from "../services/backend";
import { operationalDate, operationalTime } from "../services/operationalTime";

export function PublishScheduleButton({runId, date, mode, onPublished, syntheticSources, compact = false}: {
  runId: string; date?: string; mode?: string; onPublished?: () => Promise<void>; syntheticSources?: string[] | null; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reviewRunId, setReviewRunId] = useState(runId);
  const [day, setDay] = useState(date ?? operationalDate());
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideDraft, setOverrideDraft] = useState("");
  const [preview, setPreview] = useState<PublicationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<PublishOptimizationDeploymentsRequest | null>(null);
  const submitting = useRef(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setPreview(null); setError(null); pending.current = null;
    previewPublication({run_id: reviewRunId, operational_date: day, replace_existing: true, input_override_reason: overrideReason})
      .then(result => { if (active) setPreview(result); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "Preview failed."); });
    return () => { active = false; };
  }, [open, reviewRunId, day, overrideReason, attempt]);
  async function publish() {
    if ((!preview && !pending.current) || submitting.current) return;
    submitting.current = true; setBusy(true); setError(null);
    // Preserve the exact request key/body after a lost response; the server replays its receipt.
    pending.current ??= {
      run_id: reviewRunId, operational_date: day, replace_existing: true,
      start_time: preview!.start_time, end_time: preview!.end_time,
      expected_revision: preview!.expected_revision, idempotency_key: crypto.randomUUID(),
      input_override_reason: overrideReason,
    };
    try {
      const result = await publishDeploymentsFromOptimization(pending.current);
      setNotice(`Published ${result.created} assignments for ${day} · ${result.shift}.`);
      setOpen(false); pending.current = null;
      try { await onPublished?.(); }
      catch { setNotice("Schedule published. Refresh failed; reload the board to see the saved schedule."); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publication failed.");
      if (e instanceof Error && "status" in e) {
        setPreview(null); pending.current = null; // A server rejection needs a new review.
      }
    } finally { submitting.current = false; setBusy(false); }
  }
  const syntheticWarning = `This saved run used generated inputs (${syntheticSources?.join(", ")}) and cannot be published. Start a new run with operational data.`;
  const publicationWarning = syntheticSources?.length ? syntheticWarning
    : mode === "shadow" ? "Shadow recommendation — export for comparison; publication is disabled." : null;
  const publicationTrigger = <DialogTrigger asChild>
    <button type="button" aria-label="Preview publication" title={compact && publicationWarning ? undefined : "Preview publication"}
      disabled={!runId || mode === "shadow" || Boolean(syntheticSources?.length)}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md bg-yellow-400 font-semibold text-gray-900 transition-colors hover:bg-yellow-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? "h-9 w-full px-3 text-sm disabled:pointer-events-none" : "h-10 px-4"}`}>
      {compact && (publicationWarning
        ? <TriangleAlert className={`h-4 w-4 ${syntheticSources?.length ? "text-red-700" : "text-amber-800"}`} aria-hidden="true" />
        : <Eye className="h-4 w-4" aria-hidden="true" />)}
      {compact ? "Preview" : "Preview publication"}
    </button>
  </DialogTrigger>;
  return <div className={compact ? "w-28 shrink-0" : undefined}>
    <Dialog open={open} onOpenChange={value => {
      if (busy) return;
      setOpen(value);
      if (value) { setReviewRunId(runId); setDay(date ?? operationalDate()); setOverrideReason(""); setOverrideDraft(""); setPreview(null); pending.current = null; }
    }}>
      {compact && publicationWarning ? <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} role="group" aria-label={`Publication unavailable. ${publicationWarning}`}
            className="inline-flex w-full cursor-help rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2">
            {publicationTrigger}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6} className="max-w-64">{publicationWarning}</TooltipContent>
      </Tooltip> : publicationTrigger}
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>Review schedule replacement</DialogTitle>
        <DialogDescription>Review the effective time and assignment changes. Eligibility, staffing, and input freshness are checked again when you publish.</DialogDescription>
        <p className="break-all">Run: <strong>{reviewRunId}</strong></p>
        <label className="grid gap-1">Operational date (Asia/Manila)
          <input type="date" required value={day} disabled={busy} onChange={e => {setPreview(null); pending.current = null; setDay(e.target.value);}} className="rounded border p-2" />
        </label>
        {preview && <div className="max-h-64 space-y-2 overflow-y-auto text-sm">
          <p>Shift: <strong>{preview.shift}</strong> · Effective {operationalTime(preview.start_time)}–{operationalTime(preview.end_time)}</p>
          <p>Inputs captured: {preview.captured_at ? operationalTime(preview.captured_at) : "Unavailable"}</p>
          <p>{preview.created} proposed assignments; {preview.replaced} existing assignments replaced</p>
          <p className="font-semibold">Assignments added or moved</p>
          {preview.added_assignments?.map(row => <p key={`${row.officer_id}:${row.bottleneck_id}`}>{row.officer_name} ({row.badge_number}) → {row.bottleneck_name}</p>)}
          {!preview.added_assignments?.length && <p>None</p>}
          <p className="font-semibold">Assignments removed or moved</p>
          {preview.removed_assignments?.map(row => <p key={`${row.officer_id}:${row.bottleneck_id}`}>{row.officer_name} ({row.badge_number}) · {row.bottleneck_name}</p>)}
          {!preview.removed_assignments?.length && <p>None</p>}
          {preview.input_issues?.map(issue => <p key={issue} className="text-amber-800">{issue}</p>)}
        </div>}
        {!preview && !error && <p role="status">Checking assignments…</p>}
        {error && <p role="alert" className="text-red-700">Cannot publish: {error}</p>}
        <details>
          <summary className="text-sm">Supervisor override for stale or unverified inputs</summary>
          <label className="grid gap-1 text-sm">Reason (at least 10 characters; recorded in the audit log)
            <textarea value={overrideDraft} disabled={busy} onChange={e => setOverrideDraft(e.target.value)} className="rounded border p-2" />
          </label>
          <button disabled={busy || overrideDraft.trim().length < 10} onClick={() => {setPreview(null); pending.current = null; setOverrideReason(overrideDraft.trim()); setAttempt(n => n + 1);}} className="mt-1 rounded border px-3 py-1 text-sm">Apply override and review</button>
        </details>
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => setOpen(false)} className="rounded border px-4 py-2">Cancel</button>
          {error && !preview && <button disabled={busy} onClick={() => setAttempt(n => n + 1)} className="rounded border px-4 py-2">Refresh preview</button>}
          <button disabled={(!preview && !pending.current) || busy} onClick={publish} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{busy ? "Publishing…" : pending.current ? "Retry publication" : "Confirm publication"}</button>
        </div>
      </DialogContent>
    </Dialog>
    {!compact && mode === "shadow" && <p role="status" className="mt-2 text-sm text-amber-800">Shadow recommendation — export for comparison; publication is disabled.</p>}
    {!compact && Boolean(syntheticSources?.length) && <p role="alert" className="mt-2 max-w-sm text-sm text-red-700">{syntheticWarning}</p>}
    {notice && <p role="status" className="mt-2 text-sm text-green-800">{notice}</p>}
  </div>;
}
