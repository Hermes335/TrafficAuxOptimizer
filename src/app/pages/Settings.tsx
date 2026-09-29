import { useEffect, useState } from "react";
import { Database, ServerCog, ShieldAlert, Activity } from "lucide-react";
import { LoadingState } from "../components/LoadingState";
import {
  fetchSystemHealthSnapshot,
  getApiBaseUrl,
  type SystemHealthSnapshot,
} from "../services/backend";

export function Settings() {
  const [health, setHealth] = useState<SystemHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    fetchSystemHealthSnapshot()
      .then((snapshot) => {
        if (!active) {
          return;
        }
        setHealth(snapshot);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) {
          return;
        }
        const message = err instanceof Error ? err.message : "Failed to load system settings";
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
  }, [refreshKey]);
  useEffect(() => {
    const timer = window.setInterval(() => setRefreshKey(n => n + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="flex h-full flex-col gap-4 bg-gray-50 p-6">
      <div>
        <h1 className="text-2xl font-bold">System Health</h1>
        <p className="text-sm text-gray-600">Runtime health and environment connectivity</p>
        <button className="mt-2 rounded border px-3 py-1 text-sm" onClick={() => setRefreshKey(n => n + 1)}>Refresh health</button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl border bg-white p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-500">
            <Activity className="h-4 w-4 text-yellow-500" />
            Public API Health
          </div>
          <div className="text-xl font-bold">
            {loading ? "Loading..." : health?.apiStatus ?? "unknown"}
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-500">
            <Database className="h-4 w-4 text-yellow-500" />
            Database Status
          </div>
          <div className="text-xl font-bold">
            {loading
              ? "Loading..."
              : health?.adminHealth?.database ?? (health?.adminForbidden ? "admin required" : "unknown")}
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-500">
            <ServerCog className="h-4 w-4 text-yellow-500" />
            Queue Status
          </div>
          <div className="text-xl font-bold">
            {loading
              ? "Loading..."
              : health?.adminHealth?.queue ?? (health?.adminForbidden ? "admin required" : "unknown")}
          </div>
        </div>
      </div>

      {health?.adminHealth && <div className="rounded-xl border bg-white p-4 text-sm">
        <p>Operational readiness: <strong>{health.adminHealth.status}</strong></p>
        <p>Worker: {health.adminHealth.workers ?? "unknown"} · Scheduler: {health.adminHealth.scheduler ?? "unknown"}</p>
        <p>Backend version: {health.adminHealth.version ?? "unknown"} · Pending migrations: {health.adminHealth.pending_migrations ?? "unknown"}</p>
        {Object.entries(health.adminHealth.providers ?? {}).map(([name, provider]) => <p key={name}>{name}: {provider.status}
          {provider.age_seconds !== null && ` · ${Math.max(0, Math.round(provider.age_seconds / 60))} minutes old`}</p>)}
        <p className="mt-1 text-xs text-gray-500">Last check: {health.adminHealth.timestamp}</p>
      </div>}

      <div className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Environment</h2>
        <div className="space-y-2 text-sm">
          <div className="rounded bg-gray-50 p-2">
            <span className="font-medium text-gray-700">Backend Base URL: </span>
            <span className="text-gray-600">{getApiBaseUrl()}</span>
          </div>
          <div className="rounded bg-gray-50 p-2">
            <span className="font-medium text-gray-700">Admin System Health Endpoint: </span>
            <span className="text-gray-600">/api/admin/system-health/</span>
          </div>
        </div>
      </div>

      {loading && <LoadingState label="Loading system status..." />}
      {!loading && error && <LoadingState error={error} />}

      {!loading && !error && health?.adminForbidden && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <ShieldAlert className="h-4 w-4" />
            Admin access required
          </div>
          <p>System health details are protected by backend admin permissions.</p>
        </div>
      )}
    </div>
  );
}
