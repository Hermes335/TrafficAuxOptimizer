import { useEffect, useRef, useState } from "react";
import { Eye, TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { previewPublication, publishDeploymentsFromOptimization, type PublicationAssignment, type PublicationPreview, type PublishOptimizationDeploymentsRequest } from "../services/backend";
import { operationalDate, operationalTime } from "../services/operationalTime";

function publicationInputIssues(error: unknown): string[] {
  return error instanceof Error && "input_issues" in error && Array.isArray(error.input_issues)
    ? error.input_issues.filter((issue: unknown): issue is string => typeof issue === "string") : [];
}

function AssignmentChanges({ title, rows = [] }: { title: string; rows?: PublicationAssignment[] }) {
  return <section className="space-y-2">
    <h3 className="font-semibold">{title}</h3>
    {!rows.length ? <p className="text-slate-500">None</p> : <div className="overflow-x-auto rounded border">
      <table className="w-full min-w-[420px] text-left text-sm">
        <caption className="sr-only">{title} · times in Asia/Manila</caption>
        <thead className="bg-slate-50"><tr>{["Officer", "Location", "Start", "End"].map(label => <th key={label} scope="col" className="p-2 font-medium">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={`${row.officer_id}:${row.bottleneck_id}:${row.start_time}`} className="border-t">
          <td className="p-2">{row.officer_name}<span className="block text-xs text-slate-500">{row.badge_number}</span></td>
          <td className="p-2">{row.bottleneck_name}</td>
          <td className="whitespace-nowrap p-2">{row.start_time ? operationalTime(row.start_time) : "—"}</td>
          <td className="whitespace-nowrap p-2">{row.end_time ? operationalTime(row.end_time) : "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}

export function PublishScheduleButton({runId, date, mode, onPublished, syntheticSources, compact = false}: {
  runId: string; date?: string; mode?: string; onPublished?: () => Promise<void>; syntheticSources?: string[] | null; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const [reviewRunId, setReviewRunId] = useState(runId);
  const [day, setDay] = useState(date ?? operationalDate());
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideDraft, setOverrideDraft] = useState("");
  const [preview, setPreview] = useState<PublicationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorInputIssues, setErrorInputIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishedSkillWarnings, setPublishedSkillWarnings] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<PublishOptimizationDeploymentsRequest | null>(null);
  const submitting = useRef(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setPreview(null); setError(null); setErrorInputIssues([]); pending.current = null;
    previewPublication({run_id: reviewRunId, operational_date: day, replace_existing: true, input_override_reason: overrideReason})
      .then(result => { if (active) setPreview(result); })
      .catch(e => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Preview failed.");
        setErrorInputIssues(publicationInputIssues(e));
      });
    return () => { active = false; };
  }, [open, reviewRunId, day, overrideReason, attempt]);
  async function publish() {
    if ((!preview && !pending.current) || submitting.current) return;
    submitting.current = true; setBusy(true); setError(null); setErrorInputIssues([]);
    // Preserve the exact request key/body after a lost response; the server replays its receipt.
    pending.current ??= {
      run_id: reviewRunId, operational_date: day, replace_existing: true,
      // Timed runs carry windows per assignment. Supplying the preview's
      // overall shift window would override those saved times and be rejected.
      ...(preview!.time_periods?.length ? {} : {start_time: preview!.start_time, end_time: preview!.end_time}),
      expected_revision: preview!.expected_revision, idempotency_key: crypto.randomUUID(),
      input_override_reason: overrideReason,
    };
    try {
      const result = await publishDeploymentsFromOptimization(pending.current);
      setPublishedSkillWarnings(result.skill_warnings ?? []);
      setNotice(`Published ${result.created} assignments for ${day} · ${result.shift}.`);
      setOpen(false); pending.current = null;
      try { await onPublished?.(); }
      catch { setNotice("Schedule published. Refresh failed; reload the board to see the saved schedule."); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publication failed.");
      setErrorInputIssues(publicationInputIssues(e));
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
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-amber-400 font-semibold text-slate-950 transition-colors hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? "h-9 w-full px-3 text-sm disabled:pointer-events-none" : "h-10 px-4"}`}>
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
      if (value) { setReviewRunId(runId); setDay(date ?? operationalDate()); setOverrideReason(""); setOverrideDraft(""); setPreview(null); setError(null); setErrorInputIssues([]); pending.current = null; }
    }}>
      {compact && publicationWarning ? <Popover open={warningOpen} onOpenChange={setWarningOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Why publication is unavailable" className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-100 px-3 text-sm font-semibold text-amber-900 hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
            <TriangleAlert aria-hidden="true" className={`h-4 w-4 ${syntheticSources?.length ? "text-red-700" : "text-amber-800"}`} />Preview
          </button>
        </PopoverTrigger>
        <PopoverContent aria-label="Publication unavailable" side="top" sideOffset={6} collisionPadding={12} className="max-w-[calc(100vw-2rem)] space-y-2 text-sm">
          <h3 className="font-semibold text-slate-900">Cannot publish this run</h3>
          <p className="break-words text-slate-600">{publicationWarning}</p>
          <button type="button" onClick={() => setWarningOpen(false)} className="min-h-9 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Got it</button>
        </PopoverContent>
      </Popover> : publicationTrigger}
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogTitle className="shrink-0 pr-8">Review schedule replacement</DialogTitle>
        <DialogDescription>Review the effective time and assignment changes. Eligibility, staffing, and input freshness are checked again when you publish.</DialogDescription>
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <p className="break-all">Run: <strong>{reviewRunId}</strong></p>
        <label className="grid gap-1">Operational date (Asia/Manila)
          <input type="date" required value={day} disabled={busy} onChange={e => {setPreview(null); setError(null); setErrorInputIssues([]); pending.current = null; setDay(e.target.value);}} className="rounded border p-2" />
        </label>
        {preview && <div className="space-y-3 text-sm">
          <p>Shift: <strong>{preview.shift}</strong> · Effective {operationalTime(preview.start_time)}–{operationalTime(preview.end_time)}</p>
          <p>Inputs captured: {preview.captured_at ? operationalTime(preview.captured_at) : "Unavailable"}</p>
          <p>{preview.created} proposed assignments; {preview.replaced} existing assignments replaced</p>
          <AssignmentChanges title="Assignments added or moved" rows={preview.added_assignments} />
          <AssignmentChanges title="Assignments removed or moved" rows={preview.removed_assignments} />
          {!!preview.time_periods?.length && <details className="rounded border p-3"><summary className="cursor-pointer font-medium">Staffing by time period ({preview.time_periods.length})</summary>
            {preview.time_periods.map(period=><p key={period.start_time} className="mt-2">{operationalTime(period.start_time)}–{operationalTime(period.end_time)}: {period.assigned_officers} scheduled, {period.reserve_officers} available</p>)}
          </details>}
          {!!preview.input_issues?.length && <details className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-900">
            <summary className="cursor-pointer font-medium">Input warnings ({preview.input_issues.length})</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">{preview.input_issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
          </details>}
          {!!preview.skill_warnings?.length && <section aria-label="Skill review notes" className="space-y-2 rounded border border-sky-200 bg-sky-50 p-3 text-sky-950">
            <h3 className="font-medium">Skill review notes</h3>
            <p className="text-xs">These notes do not block publication or require an override. Review the recorded skills before confirming.</p>
            <ul className="list-disc space-y-1 pl-4">{preview.skill_warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
          </section>}
        </div>}
        {!preview && !error && <p role="status">Checking assignments…</p>}
        {error && <div role="alert" className="space-y-2 break-words rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>Cannot publish: {error}</p>
          {!!errorInputIssues.length && <>
            <ul aria-label="Input issues blocking publication" className="list-disc space-y-1 pl-4">{errorInputIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
            <p className="text-xs">Refresh preview rechecks this run's saved inputs. To use newer readings, refresh the inputs and run optimization again.</p>
          </>}
        </div>}
        <details>
          <summary className="text-sm">Supervisor override for stale or unverified inputs</summary>
          <label className="grid gap-1 text-sm">Reason (at least 10 characters; recorded in the audit log)
            <textarea value={overrideDraft} disabled={busy} onChange={e => setOverrideDraft(e.target.value)} className="rounded border p-2" />
          </label>
          <button disabled={busy || overrideDraft.trim().length < 10} onClick={() => {setPreview(null); setError(null); setErrorInputIssues([]); pending.current = null; setOverrideReason(overrideDraft.trim()); setAttempt(n => n + 1);}} className="mt-1 rounded border px-3 py-1 text-sm">Apply override and review</button>
        </details>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 border-t pt-3">
          <button disabled={busy} onClick={() => setOpen(false)} className="rounded border px-4 py-2">Cancel</button>
          {error && !preview && <button disabled={busy} onClick={() => {setError(null); setErrorInputIssues([]); setAttempt(n => n + 1);}} className="rounded border px-4 py-2">Refresh preview</button>}
          <button disabled={(!preview && !pending.current) || busy} onClick={publish} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{busy ? "Publishing…" : pending.current ? "Retry publication" : "Confirm publication"}</button>
        </div>
      </DialogContent>
    </Dialog>
    {!compact && mode === "shadow" && <p role="status" className="mt-2 text-sm text-amber-800">Shadow recommendation — export for comparison; publication is disabled.</p>}
    {!compact && Boolean(syntheticSources?.length) && <p role="alert" className="mt-2 max-w-sm text-sm text-red-700">{syntheticWarning}</p>}
    {notice && <p role="status" className="mt-2 text-sm text-green-800">{notice}</p>}
    {notice && !!publishedSkillWarnings.length && <details className="mt-2 max-w-lg rounded border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950">
      <summary className="cursor-pointer font-medium">Published schedule skill notes</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4">{publishedSkillWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
    </details>}
  </div>;
}
