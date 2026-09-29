import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { exportRecommendation } from "../services/backend";

export function RecommendationExportButton({runId, compact = false}: {runId: string; compact?: boolean}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <div>
    <button type="button" aria-label={busy ? "Exporting recommendation" : "Export recommendation"} title="Export recommendation as CSV"
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? "h-9" : "h-10"}`}
      disabled={!runId || busy} onClick={async () => {
      setBusy(true); setError(null);
      try { await exportRecommendation(runId); } catch (e) { setError(e instanceof Error ? e.message : "Export failed."); }
      finally { setBusy(false); }
    }}>
      {compact && (busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />)}
      {busy ? "Exporting…" : compact ? "Export CSV" : "Export recommendation"}
    </button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}
