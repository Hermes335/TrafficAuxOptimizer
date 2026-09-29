import { useEffect, useState } from "react";
import { fetchScheduleRevisions, type ScheduleRevisionRecord } from "../services/backend";
import { operationalTime } from "../services/operationalTime";

export function ScheduleHistory({day, refreshKey}: {day: string; refreshKey: number}) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ScheduleRevisionRecord[]>([]);
  const [next, setNext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => { setPage(1); setRows([]); }, [day]);
  useEffect(() => {
    let active = true;
    fetchScheduleRevisions(day, page).then(result => {
      if (!active) return;
      setRows(result.results); setNext(Boolean(result.next)); setError(null);
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "History unavailable."); });
    return () => { active = false; };
  }, [day, page, refreshKey, retry]);
  return <details className="rounded border bg-white p-3 text-sm">
    <summary className="cursor-pointer font-medium">Publication history for {day}</summary>
    {error && <p role="alert" className="mt-2 text-red-700">{error} <button className="underline" onClick={() => setRetry(n => n + 1)}>Retry history</button></p>}
    {!error && !rows.length && <p className="mt-2 text-gray-500">No recorded publications for this date.</p>}
    {rows.map(row => <details key={row.id} className="mt-2 border-t pt-2">
      <summary>{row.shift} · Published {operationalTime(row.published_at)} by {row.published_by} · Effective {operationalTime(row.effective_start)}–{operationalTime(row.effective_end)}</summary>
      <p className="break-all text-xs text-gray-500">{row.run_id}</p>
      {row.assignments.map(assignment => <p key={`${assignment.officer_id}:${assignment.bottleneck_id}`}>{assignment.officer_name} ({assignment.badge_number}) → {assignment.bottleneck_name}</p>)}
    </details>)}
    <div className="mt-2 flex gap-3">
      <button disabled={page <= 1} onClick={() => setPage(n => n - 1)}>Newer publications</button>
      <button disabled={!next} onClick={() => setPage(n => n + 1)}>Older publications</button>
    </div>
  </details>;
}
