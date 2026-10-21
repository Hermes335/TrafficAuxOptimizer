import { RememberedDetails } from "./RememberedDetails";
import { usePageState } from "../contexts/PageStateContext";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { fetchScheduleRevisions, type ScheduleRevisionRecord } from "../services/backend";
import { operationalTime } from "../services/operationalTime";

export function ScheduleHistory({day, refreshKey}: {day: string; refreshKey: number}) {
  const [page, setPage] = usePageState(`scheduleHistory.page.${day}`, 1);
  const [rows, setRows] = useState<ScheduleRevisionRecord[]>([]);
  const [next, setNext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => { setRows([]); }, [day]);
  useEffect(() => {
    let active = true;
    setLoading(true); setRows([]); setNext(false); setError(null);
    fetchScheduleRevisions(day, page).then(result => {
      if (!active) return;
      setRows(result.results); setNext(Boolean(result.next)); setError(null);
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "History unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [day, page, refreshKey, retry]);
  return <RememberedDetails stateKey={`scheduleHistory.${day}`} className="rounded border bg-white p-3 text-sm">
    <summary className="cursor-pointer font-medium">Publication history for {day}</summary>
    {error && <p role="alert" className="mt-2 text-red-700">{error} <button className="underline" onClick={() => setRetry(n => n + 1)}>Retry history</button></p>}
    {loading && <p role="status" className="mt-2 text-gray-500">Loading publication history…</p>}
    {!loading && !error && !rows.length && <p className="mt-2 text-gray-500">No recorded publications for this date.</p>}
    {rows.map(row => <RememberedDetails stateKey={`scheduleHistory.revision.${row.id}`} key={row.id} className="mt-2 border-t pt-2">
      <summary>{row.shift} · Published {operationalTime(row.published_at)} by {row.published_by} · Effective {operationalTime(row.effective_start)}–{operationalTime(row.effective_end)}</summary>
      <Link to={`/optimization-engine?run_id=${encodeURIComponent(row.run_id)}`} className="inline-flex min-h-10 max-w-full items-center break-all text-xs font-medium text-amber-800 underline underline-offset-4">Review recommendation · {row.run_id}</Link>
      {row.assignments.map((assignment, index) => <p key={`${assignment.officer_id}:${assignment.bottleneck_id}:${assignment.start_time}:${index}`} className="break-words text-sm">{assignment.officer_name} ({assignment.badge_number}) → {assignment.bottleneck_name}{assignment.start_time && assignment.end_time ? ` · ${operationalTime(assignment.start_time)}–${operationalTime(assignment.end_time)} Manila` : ""}</p>)}
    </RememberedDetails>)}
    <div className="mt-2 flex gap-3">
      <button className="min-h-11 disabled:opacity-50" disabled={loading || page <= 1} onClick={() => setPage(n => n - 1)}>Newer publications</button>
      <button className="min-h-11 disabled:opacity-50" disabled={loading || !next} onClick={() => setPage(n => n + 1)}>Older publications</button>
    </div>
  </RememberedDetails>;
}
