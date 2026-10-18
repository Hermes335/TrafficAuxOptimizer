import { useEffect, useRef, useState } from "react";
import { Check, ImageOff, LoaderCircle, MapPin, RefreshCw, ShieldCheck, X } from "lucide-react";
import { Link } from "react-router";
import {
  fetchIncidentPhoto,
  fetchPendingReports,
  reviewIncidentReport,
  type ReportIncident,
} from "../services/incidentReporting";
import { OPERATIONAL_TIME_ZONE } from "../services/operationalTime";

const secondaryButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50";

function label(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}

function reportReference(report: ReportIncident) {
  return report.reference || `#${report.id}`;
}

function PrivateReportPhoto({ incidentId }: { incidentId: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(null);
    fetchIncidentPhoto(incidentId).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {
      if (active) setError("The photo could not be loaded.");
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [incidentId, attempt]);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
      {url ? <img src={url} alt="Photo submitted with this incident report" className="max-h-80 w-full object-contain" /> : error ? (
        <div className="flex flex-col items-center gap-2 p-5 text-center text-sm text-slate-600">
          <ImageOff aria-hidden="true" className="h-5 w-5" />
          <p>{error}</p>
          <button type="button" className={secondaryButton} onClick={() => setAttempt(value => value + 1)}>Retry photo</button>
        </div>
      ) : <p className="p-5 text-center text-sm text-slate-500" aria-busy="true">Loading report photo…</p>}
    </div>
  );
}

function PendingReportCard({ report, disabled, saving, error, onReview }: {
  report: ReportIncident;
  disabled: boolean;
  saving: boolean;
  error?: string;
  onReview: (id: number, decision: "approve" | "reject") => void;
}) {
  const [confirmReject, setConfirmReject] = useState(false);
  const reference = reportReference(report);
  const latitude = report.latitude;
  const longitude = report.longitude;
  const hasLocation = typeof latitude === "number" && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && typeof longitude === "number" && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
  const submittedAt = report.timestamp && Number.isFinite(Date.parse(report.timestamp))
    ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: OPERATIONAL_TIME_ZONE }).format(new Date(report.timestamp))
    : null;
  const severityClass = report.severity === "critical" ? "bg-red-50 text-red-700 ring-red-200"
    : report.severity === "major" ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-slate-100 text-slate-700 ring-slate-200";

  return (
    <article aria-label={`Report ${reference}`} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-all text-xs font-medium uppercase tracking-wide text-slate-500">Public report {reference}</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">{label(report.incident_type)}</h2>
          {submittedAt && <p className="mt-1 text-xs text-slate-500">{submittedAt} · Manila time</p>}
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${severityClass}`}>{label(report.severity)}</span>
      </div>

      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{report.description}</p>

      <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
        <p className="flex items-center gap-2 font-medium text-slate-700"><MapPin aria-hidden="true" className="h-4 w-4 shrink-0" />Reported location</p>
        {hasLocation ? (
          <>
            <p className="mt-1 font-mono text-xs">{latitude.toFixed(6)}, {longitude.toFixed(6)}</p>
            <Link className="mt-2 inline-flex min-h-9 items-center gap-1.5 font-semibold text-amber-800 underline underline-offset-4 hover:text-amber-950"
              to={`/?report_id=${report.id}`}>View pin on map <MapPin aria-hidden="true" className="h-3.5 w-3.5" /></Link>
          </>
        ) : <p className="mt-1">Exact coordinates unavailable{report.bottleneck ? ` · ${report.bottleneck}` : ""}.</p>}
      </div>

      {report.photo_url && <PrivateReportPhoto incidentId={report.id} />}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <div className="mt-auto border-t border-slate-100 pt-4">
        {confirmReject ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">Reject this report? It will not appear as an active incident.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={disabled} onClick={() => onReview(report.id, "reject")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-50">
                {saving && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}Confirm rejection
              </button>
              <button type="button" disabled={disabled} onClick={() => setConfirmReject(false)} className={secondaryButton}>Keep report</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-label={`Approve report ${reference}`} disabled={disabled} onClick={() => onReview(report.id, "approve")} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:cursor-wait disabled:opacity-50">
              {saving ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" className="h-4 w-4" />}Approve incident
            </button>
            <button type="button" aria-label={`Reject report ${reference}`} disabled={disabled} onClick={() => setConfirmReject(true)} className={secondaryButton}><X aria-hidden="true" className="h-4 w-4" />Reject</button>
          </div>
        )}
      </div>
    </article>
  );
}

export function IncidentReview() {
  const [reports, setReports] = useState<ReportIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [reviewErrors, setReviewErrors] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const reviewInFlight = useRef(false);
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    fetchPendingReports().then(rows => {
      if (!active) return;
      setReports(rows);
      setLoaded(true);
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : "Could not load pending reports.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadAttempt]);

  const review = async (id: number, decision: "approve" | "reject") => {
    if (loading || reviewInFlight.current) return;
    reviewInFlight.current = true;
    setReviewingId(id);
    setReviewErrors(errors => ({ ...errors, [id]: "" }));
    setNotice(null);
    try {
      await reviewIncidentReport(id, decision);
      if (!mounted.current) return;
      const reference = reportReference(reports.find(report => report.id === id)!);
      setReports(rows => rows.filter(report => report.id !== id));
      setNotice(decision === "approve" ? `Report ${reference} approved. The incident is now active on the dashboard.` : `Report ${reference} rejected.`);
      heading.current?.focus();
    } catch (error: unknown) {
      if (mounted.current) setReviewErrors(errors => ({ ...errors, [id]: error instanceof Error ? error.message : "The report could not be reviewed. Please try again." }));
    } finally {
      reviewInFlight.current = false;
      if (mounted.current) setReviewingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold tracking-tight text-slate-900">Review incident reports</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">Check reports from the public before adding them to the dashboard. Approved incidents can influence the next optimization.</p>
        </div>
        <button type="button" disabled={loading || reviewingId !== null} className={secondaryButton} onClick={() => setLoadAttempt(attempt => attempt + 1)}>
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh reports
        </button>
      </div>

      <div role="status" aria-live="polite" className={notice ? "rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" : "sr-only"}>{notice || ""}</div>
      {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p>{loadError}{loaded && " Previously loaded reports are shown below."}</p>
        <button type="button" disabled={loading || reviewingId !== null} className={secondaryButton} onClick={() => setLoadAttempt(attempt => attempt + 1)}>Retry loading reports</button>
      </div>}

      {loading && !loaded ? <p className="py-12 text-center text-sm text-slate-500" role="status">Loading pending reports…</p> : loaded && reports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
          <ShieldCheck aria-hidden="true" className="mx-auto h-9 w-9 text-slate-400" />
          <h2 className="mt-3 text-lg font-semibold text-slate-900">No reports waiting for review</h2>
          <p className="mt-2 text-sm text-slate-500">New public reports will appear here. Refresh to check for updates.</p>
        </div>
      ) : reports.length > 0 && (
        <section aria-label="Pending incident reports" aria-busy={loading}>
          <p className="mb-3 text-sm font-medium text-slate-500">{reports.length} {reports.length === 1 ? "report" : "reports"} awaiting review{loading ? " · Refreshing…" : ""}</p>
          <div className="grid items-stretch gap-4 lg:grid-cols-2">
            {reports.map(report => <PendingReportCard key={report.id} report={report} disabled={loading || reviewingId !== null} saving={reviewingId === report.id} error={reviewErrors[report.id]} onReview={review} />)}
          </div>
        </section>
      )}
    </div>
  );
}
