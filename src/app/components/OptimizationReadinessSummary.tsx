import { RefreshCw } from "lucide-react";
import type { useOptimizationReadiness } from "../hooks/useOptimizationReadiness";
import type { OptimizationReadinessReading } from "../services/backend";
import { operationalDate, operationalTime } from "../services/operationalTime";

function readingLabel(reading: OptimizationReadinessReading): string {
  if (!reading.observed_at) return "No recorded reading";
  return `${operationalDate(new Date(reading.observed_at))} ${operationalTime(reading.observed_at)} · ${reading.is_stale ? "stale" : "current"}${reading.is_synthetic ? " · generated" : ""}`;
}

export function OptimizationReadinessSummary({ readiness, error, loading, refresh }: ReturnType<typeof useOptimizationReadiness>) {
  return <section aria-label="Run readiness" aria-busy={loading} className="mt-3 space-y-3 border-t border-slate-200 pt-3 text-xs leading-relaxed">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-semibold text-slate-800">Run readiness</h3>
      <button type="button" onClick={refresh} disabled={loading} aria-label="Refresh run readiness" className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-300 px-2 font-medium text-slate-700 hover:bg-white disabled:opacity-50">
        <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh
      </button>
    </div>
    {loading && <p role="status" className="text-slate-600">Checking the selected run…</p>}
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-rose-800">{error}</p>}
    {readiness && <>
      <p className={`font-medium ${readiness.ready ? "text-green-700" : "text-rose-700"}`}>{readiness.ready ? "Ready to generate a recommendation." : "Resolve these issues before running."}</p>
      {!!readiness.blockers.length && <ul className="list-disc space-y-1 rounded-lg bg-rose-50 p-3 pl-6 text-rose-800">{readiness.blockers.map((message, index) => <li key={index}>{message}</li>)}</ul>}
      {readiness.planning_start && readiness.planning_end && <p className="text-slate-700">Planning window: <strong>{operationalTime(readiness.planning_start)}–{operationalTime(readiness.planning_end)}</strong> · Asia/Manila</p>}
      <dl className="grid grid-cols-2 gap-2">
        {[
          ["Active locations", readiness.summary.active_locations],
          ["Eligible officers", readiness.summary.eligible_officers],
          ["Peak officers required", readiness.summary.peak_required_officers],
          ["Maximum shortage", readiness.summary.max_staffing_shortage],
          ["Missing officer locations", readiness.summary.missing_officer_locations],
        ].map(([label, value]) => <div key={label} className="min-w-0 rounded-lg bg-white p-2"><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 font-semibold text-slate-900">{value}</dd></div>)}
      </dl>
      {!!readiness.warnings.length && <details className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-900" open>
        <summary className="cursor-pointer font-medium">Advisory notes ({readiness.warnings.length})</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">{readiness.warnings.map((message, index) => <li key={index}>{message}</li>)}</ul>
      </details>}
      <details className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600">
        <summary className="cursor-pointer font-medium">Input freshness and staffing periods</summary>
        <p className="mt-2">Weather: {readingLabel(readiness.weather)}</p>
        <ul className="mt-2 space-y-2">{readiness.traffic.map(reading => <li key={reading.bottleneck_id}><span className="font-medium">{reading.name || reading.bottleneck_id}</span>: {readingLabel(reading)}</li>)}</ul>
        <ul className="mt-3 space-y-2">{readiness.periods.map(period => <li key={period.start_time}>{operationalTime(period.start_time)}–{operationalTime(period.end_time)}: {period.required_officers} required, {period.available_officers} available{period.shortage > 0 ? `, ${period.shortage} short` : ""}.</li>)}</ul>
      </details>
      <p className="text-slate-500">Checked {operationalTime(readiness.checked_at)} Manila. Conditions are checked again on start. Publication has separate checks.</p>
    </>}
  </section>;
}
