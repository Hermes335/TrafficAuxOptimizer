import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";
import { previewPublication, publishDeploymentsFromOptimization, type PublicationPreview } from "../services/backend";
import { operationalDate, operationalTime } from "../services/operationalTime";

export function PublishScheduleButton({runId, date, onPublished, syntheticSources}: {runId: string; date?: string; onPublished?: () => Promise<void>; syntheticSources?: string[] | null}) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(date ?? operationalDate());
  const [preview, setPreview] = useState<PublicationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!open || syntheticSources?.length) return;
    let active = true;
    setPreview(null); setError(null);
    previewPublication({run_id: runId, operational_date: day, replace_existing: true})
      .then(result => { if (active) setPreview(result); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "Preview failed."); });
    return () => { active = false; };
  }, [open, runId, day, syntheticSources]);
  async function publish() {
    if (!preview || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await publishDeploymentsFromOptimization({run_id: runId, operational_date: day, replace_existing: true});
      setNotice(`Published ${result.created} assignments for ${day} · ${result.shift}.`);
      setOpen(false);
      try { await onPublished?.(); }
      catch { setNotice("Schedule published. Refresh failed; reload the board to see the saved schedule."); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publication failed.");
      setPreview(null); // Conflict requires a fresh preview.
    } finally { setBusy(false); }
  }
  return <div>
    <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); if (value) setDay(date ?? operationalDate()); } }}>
      <DialogTrigger asChild><button disabled={!runId || Boolean(syntheticSources?.length)} className="rounded bg-yellow-400 px-4 py-2 font-semibold text-gray-900 disabled:opacity-50">Preview publication</button></DialogTrigger>
      <DialogContent>
        <DialogTitle>Review schedule replacement</DialogTitle>
        <DialogDescription>The saved run determines the shift. Publication checks eligibility and conflicts again before committing.</DialogDescription>
        <p className="break-all">Run: <strong>{runId}</strong></p>
        <label className="grid gap-1">Operational date (Asia/Manila)
          <input type="date" required value={day} disabled={busy} onChange={e => setDay(e.target.value)} className="rounded border p-2" />
        </label>
        {preview && <dl className="space-y-2 text-sm">
          <div>Shift: <strong>{preview.shift}</strong> · {operationalTime(preview.start_time)}–{operationalTime(preview.end_time)}</div>
          <div>{preview.created} proposed assignments; {preview.replaced} existing assignments replaced</div>
          <div>Staff added (IDs): {preview.staff_added.join(", ") || "None"}</div>
          <div>Staff removed (IDs): {preview.staff_removed.join(", ") || "None"}</div>
          <div>Conflicts / invalid assignments: none</div>
        </dl>}
        {!preview && !error && <p role="status">Checking assignments…</p>}
        {error && <p role="alert" className="text-red-700">Cannot publish: {error}</p>}
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => setOpen(false)} className="rounded border px-4 py-2">Cancel</button>
          <button disabled={!preview || busy} onClick={publish} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{busy ? "Publishing…" : "Confirm publication"}</button>
        </div>
      </DialogContent>
    </Dialog>
    {Boolean(syntheticSources?.length) && <p role="alert" className="mt-2 max-w-sm text-sm text-red-700">This saved run used generated inputs ({syntheticSources?.join(", ")}) and cannot be published. Start a new run with operational data.</p>}
    {notice && <p role="status" className="mt-2 text-sm text-green-800">{notice}</p>}
  </div>;
}
