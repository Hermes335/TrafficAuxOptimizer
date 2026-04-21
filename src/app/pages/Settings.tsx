import { useEffect, useState } from "react";
import { Database, ServerCog, ShieldAlert, Activity } from "lucide-react";
import {
  fetchSystemHealthSnapshot,
  getApiBaseUrl,
  type SystemHealthSnapshot,
} from "../services/backend";

export function Settings() {
  const [health, setHealth] = useState<SystemHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  return (
    <div className="flex h-full flex-col gap-4 bg-gray-50 p-6">
      <div>
        <h1 className="text-2xl font-bold">System Configuration</h1>
        <p className="text-sm text-gray-600">Runtime health and environment connectivity</p>
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

      {loading && <p className="text-sm text-gray-500">Loading system status...</p>}
      {!loading && error && <p className="text-sm text-red-600">{error}</p>}

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