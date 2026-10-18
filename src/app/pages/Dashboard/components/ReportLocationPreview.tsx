import { ArrowLeft, LocateFixed, MapPin, RefreshCw, X } from "lucide-react";
import { Link } from "react-router";
import type { useIncidentMapPreview } from "../../../hooks/useIncidentMapPreview";

interface ReportLocationPreviewProps {
  preview: ReturnType<typeof useIncidentMapPreview>;
  onClose: () => void;
}

export function ReportLocationPreview({ preview, onClose }: ReportLocationPreviewProps) {
  const { report, loading, error, retry, focusLocation } = preview;
  const pending = report?.status === "pending";
  const label = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, character => character.toUpperCase());

  return (
    <section aria-label="Report location preview" className="absolute bottom-3 left-3 z-20 w-80 max-w-[calc(100%-5rem)] rounded-xl border border-amber-200 bg-white p-3 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-700" />{report ? pending ? "Pending review" : `${label(report.status)} incident` : "Report location"}</h2>
        <button type="button" aria-label="Close report preview" onClick={onClose} className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-amber-600"><X aria-hidden="true" className="h-4 w-4" /></button>
      </div>
      {loading && <p role="status" className="mt-2 text-xs text-slate-600">Loading reported location…</p>}
      {error && <div className="mt-2 space-y-2">
        <p role="alert" className="text-xs text-rose-700">{error}</p>
        <button type="button" onClick={retry} className="inline-flex min-h-8 items-center gap-1.5 text-xs font-semibold text-slate-700 underline"><RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />Retry report preview</button>
      </div>}
      {report && <div className="mt-1 space-y-1">
        <p title={report.reference || `#${report.id}`} className="truncate text-xs text-slate-500">Report {report.reference || `#${report.id}`}</p>
        <p className="text-xs font-medium text-slate-800">{label(report.incident_type)} · {label(report.severity)}</p>
        <p className="line-clamp-2 break-words text-xs text-slate-600">{report.description}</p>
        {pending && <p className="text-xs font-medium text-amber-800">Not active until approved.</p>}
      </div>}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2">
        <Link to="/incident-review" aria-label="Return to Review Reports" className="inline-flex min-h-8 items-center gap-1.5 text-xs font-semibold text-amber-800 underline underline-offset-2"><ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />Back to review</Link>
        {report && <button type="button" aria-label="Center on pin" onClick={focusLocation} className="inline-flex min-h-8 items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-950"><LocateFixed aria-hidden="true" className="h-3.5 w-3.5" />Recenter</button>}
      </div>
    </section>
  );
}
