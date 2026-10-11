import type { TrafficReading } from "../services/backend";
import { operationalTime } from "../services/operationalTime";

export function TrafficFreshness({ reading }: { reading?: TrafficReading }) {
  const observed = reading?.observed_at ?? reading?.timestamp;
  const age = observed ? Date.now() - Date.parse(observed) : NaN;
  if (!reading || !Number.isFinite(age) || age < -60000) {
    return <p className="mt-1 text-xs text-slate-600">Observation time unavailable · freshness unknown</p>;
  }
  const minutes = Math.max(0, Math.floor(age / 60000));
  const ageLabel = minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago`
    : minutes < 1440 ? `${Math.floor(minutes / 60)} hr ago` : `${Math.floor(minutes / 1440)} days ago`;
  // The server supplies staleness using its configured input-age policy.
  const status = reading.is_synthetic ? "Simulated" : reading.is_stale ? "Stale"
    : reading.data_status === "live" ? "Live" : reading.data_status === "cached" ? "Cached"
    : reading.data_status === "fallback" ? "Fallback" : "Unverified";
  return <p className={`mt-1 text-xs ${status === "Live" ? "text-slate-600" : "text-amber-800"}`}
    title={`${observed} · ${reading.source}`}>
    {status} · observed {ageLabel} ({operationalTime(observed!)} Manila) · {reading.source}
  </p>;
}
