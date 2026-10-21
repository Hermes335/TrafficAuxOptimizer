import { useEffect, useState } from "react";
import { Link } from "react-router";
import { RememberedDetails } from "./RememberedDetails";
import { RunPublicationBadge } from "./RunPublicationStatus";
import { fetchScheduleProvenance, type ScheduleProvenanceSnapshot } from "../services/backend";
import { operationalTime } from "../services/operationalTime";

export function ScheduleProvenance({day, shift, refreshKey}: {day: string; shift: string; refreshKey: number}) {
  const [snapshot, setSnapshot] = useState<ScheduleProvenanceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const refresh = () => setAttempt(value => value + 1);
    window.addEventListener("deployment-publication-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("deployment-publication-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setSnapshot(null);
    void (async () => {
      try {
        const result = await fetchScheduleProvenance(day, shift);
        if (active) setSnapshot(result);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : "Schedule source information is unavailable.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {active = false;};
  }, [day, shift, refreshKey, attempt]);

  const changed = snapshot?.shifts.some(row => row.assignments_changed_since_publication);
  return <section aria-label="Schedule source" className="shrink-0 px-4 pt-3 sm:px-6">
    <RememberedDetails stateKey={`schedule.provenance.${day}.${shift}`} className="rounded-xl border border-slate-200 bg-white px-3 text-sm sm:px-4">
      <summary className="min-h-11 cursor-pointer content-center font-medium text-slate-800">
        Schedule source and edits <span className={`ml-2 text-xs font-normal ${changed || error ? "text-amber-800" : "text-slate-500"}`}>{loading ? "Checking…" : error ? "Unavailable" : changed ? "Changes recorded after publication" : "View recorded origins"}</span>
      </summary>
      <div className="space-y-3 border-t border-slate-100 pb-4 pt-3">
        <p className="text-xs text-slate-600">{day} · {shift === "all" ? "Both shifts" : `${shift[0].toUpperCase()}${shift.slice(1)} shift`} · All areas. Counts describe recorded assignment intervals for the selected shift, including completed service.</p>
        {loading && <p role="status" className="text-sm text-slate-600">Checking saved publication history and schedule changes…</p>}
        {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{error} <button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-10 px-2 font-semibold underline">Retry source information</button></p>}
        {snapshot?.shifts.map(row => <section key={row.shift} aria-label={`${row.shift} schedule source`} className="space-y-2 rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold capitalize">{row.shift}</h2>{row.latest_publication && <RunPublicationBadge publicationState={row.latest_publication} />}</div>
          {row.latest_publication ? <>
            <p className="text-xs text-slate-600">{row.latest_publication.message}</p>
            <p className="text-xs text-slate-600">Latest recorded publication: {row.latest_publication.published_at ? operationalTime(row.latest_publication.published_at) : "Time unavailable"} Manila{row.latest_publication.published_by ? ` · ${row.latest_publication.published_by}` : ""} · Revision #{row.latest_publication.revision_id}</p>
            <Link to={`/optimization-engine?run_id=${encodeURIComponent(row.latest_publication.run_id)}`} className="inline-flex min-h-10 max-w-full items-center break-all text-xs font-semibold text-amber-800 underline underline-offset-4">Review source recommendation · {row.latest_publication.run_id}</Link>
          </> : <p className="text-sm text-slate-600">No recorded optimization publication for this shift.</p>}
          <p className="text-xs text-slate-600">Manual assignments: {row.manual_assignment_count} · Optimization assignments: {row.optimized_assignment_count}</p>
          {row.assignments_changed_since_publication && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-950">The current schedule differs from the latest publication. Review the assignments before relying on the original recommendation.</p>}
          {row.sources.length > 0 && <div className="space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-600"><h3 className="font-medium">Published sources still represented in this schedule</h3>{row.sources.map(source => <p key={source.revision_id} className="break-words"><Link to={`/optimization-engine?run_id=${encodeURIComponent(source.run_id)}`} className="break-all font-medium text-amber-800 underline underline-offset-4">{source.run_id}</Link> · Revision #{source.revision_id} · {source.assignment_count} assignment{source.assignment_count === 1 ? "" : "s"}</p>)}</div>}
        </section>)}
        {snapshot && Number.isFinite(Date.parse(snapshot.checked_at)) && <p className="text-xs text-slate-500">Source information checked {operationalTime(snapshot.checked_at)} Manila. Publication history records the saved operation; later edits may change the schedule.</p>}
      </div>
    </RememberedDetails>
  </section>;
}
