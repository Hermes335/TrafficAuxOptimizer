import { operationalDate, operationalTime } from "../services/operationalTime";
import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Clock3, FileText } from "lucide-react";
import { LoadingState, EmptyState } from "../components/LoadingState";
import { fetchAuditLogs, type AuditLogRecord } from "../services/backend";

export function AuditLogs() {
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    setLoading(true);
    fetchAuditLogs(page)
      .then((result) => {
        if (!active) {
          return;
        }
        setLogs(result.results); setCount(result.count);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) {
          return;
        }
        const message = err instanceof Error ? err.message : "Failed to load audit logs";
        setError(message);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [page]);

  const permissionDenied = useMemo(() => {
    if (!error) {
      return false;
    }
    return /403/.test(error);
  }, [error]);

  return (
    <div className="flex h-full flex-col gap-4 bg-gray-50 p-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Logs</h1>
        <p className="text-sm text-gray-600">System activity and backend change history</p>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
          <ShieldCheck className="h-4 w-4 text-yellow-500" />
          Latest Events
        </div>

        <div className="mb-3 flex gap-3">
          <button disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span>Page {page} of {Math.max(1, Math.ceil(count / 25))}</span>
          <button disabled={page * 25 >= count || loading} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
        {loading && <LoadingState label="Loading audit logs..." />}

        {!loading && permissionDenied && (
          <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
            This endpoint is admin-only. Sign in with an admin account to view audit logs.
          </div>
        )}

        {!loading && !permissionDenied && error && <LoadingState error={error} />}

        {!loading && !permissionDenied && !error && logs.length === 0 && (
          <EmptyState
            icon={FileText}
            title="No Audit Logs"
            description="No audit log entries found yet. Activities will appear here once recorded."
          />
        )}

        {!loading && !permissionDenied && !error && logs.length > 0 && (
          <div className="overflow-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">Timestamp</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Resource</th>
                  <th className="px-3 py-2">Changes</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((entry) => (
                  <tr key={entry.id} className="border-b align-top last:border-b-0">
                    <td className="px-3 py-2 text-gray-700">
                      <div className="flex items-center gap-1">
                        <Clock3 className="h-3.5 w-3.5 text-gray-400" />
                        {operationalDate(new Date(entry.timestamp))} {operationalTime(entry.timestamp)}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900">#{entry.user}</td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                        {entry.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{entry.resource}</td>
                    <td className="px-3 py-2 text-gray-600">
                      <pre className="max-w-[460px] whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-xs">
                        {JSON.stringify(entry.changes, null, 2)}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
