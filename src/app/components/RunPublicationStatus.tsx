import { Link } from "react-router";
import type { RunPublicationState } from "../services/backend";
import { operationalTime } from "../services/operationalTime";

const presentations = {
  unpublished: {label: "Unpublished", style: "bg-slate-100 text-slate-700"},
  published: {label: "Published", style: "bg-green-100 text-green-800"},
  modified: {label: "Published · Modified", style: "bg-amber-100 text-amber-900"},
  partially_replaced: {label: "Partially replaced", style: "bg-amber-100 text-amber-900"},
  replaced: {label: "Replaced", style: "bg-slate-100 text-slate-700"},
  unknown: {label: "Publication status unavailable", style: "bg-slate-100 text-slate-700"},
};

export function RunPublicationBadge({publicationState, unavailable = false}: {
  publicationState?: RunPublicationState | null; unavailable?: boolean;
}) {
  const presentation = presentations[unavailable ? "unknown" : publicationState?.state ?? "unknown"] ?? presentations.unknown;
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${presentation.style}`}>{presentation.label}</span>;
}

export function RunPublicationStatus({publicationState, unavailable = false, onRefresh}: {
  publicationState?: RunPublicationState | null; unavailable?: boolean; onRefresh?: () => void;
}) {
  const state = unavailable ? null : publicationState;
  const hasPublication = !!state && state.publication_count > 0;
  const scheduleQuery = state?.operational_date
    ? `?date=${encodeURIComponent(state.operational_date)}${state.shift ? `&shift=${encodeURIComponent(state.shift)}` : ""}` : "";
  return <section aria-label="Recommendation publication status" className="mb-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">Publication status</h2>
      <RunPublicationBadge publicationState={publicationState} unavailable={unavailable} />
    </div>
    <p role="status" className="mt-3 text-sm text-slate-600">{unavailable
      ? "Publication status could not be refreshed. The saved recommendation remains available; refresh before relying on its publication status."
      : state?.message || "Publication status is unavailable for this saved run. Completing a run does not confirm publication."}</p>
    {hasPublication && <p className="mt-2 text-sm text-slate-600">
      {state.operational_date ? `${state.operational_date} · ` : ""}{state.shift === "morning" ? "Morning" : state.shift === "afternoon" ? "Afternoon" : "Shift not recorded"}
      {state.published_at ? ` · Published at ${operationalTime(state.published_at)} Manila` : ""}
      {state.revision_id != null ? ` · Publication revision ${state.revision_id}` : ""}
      {state.published_by ? ` · By ${state.published_by}` : ""}
    </p>}
    {state?.manual_changes && <p className="mt-2 text-sm text-amber-800">The published schedule has manual changes. The recommendation below retains the original saved assignments.</p>}
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      {hasPublication && state.operational_date && <Link to={`/gantt-chart${scheduleQuery}`} className="font-medium text-sky-800 underline underline-offset-2">Open schedule for this publication</Link>}
      {state?.replacing_run_ids?.map(id => <Link key={id} to={`/optimization-engine?run_id=${encodeURIComponent(id)}`} className="break-all font-medium text-sky-800 underline underline-offset-2">View replacing run {id}</Link>)}
      {onRefresh && <button type="button" onClick={onRefresh} className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50">Refresh publication status</button>}
    </div>
  </section>;
}
