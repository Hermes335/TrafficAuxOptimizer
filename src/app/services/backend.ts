import { clearSession, sessionChanged } from "./session";
export type BottleneckStatus = "normal" | "warning" | "critical";
export type IncidentType = "critical" | "major" | "minor";

export interface BottleneckOfficer {
  name: string;
  badge_number: string;
}

export interface Bottleneck {
  id: string;
  name: string;
  status: BottleneckStatus;
  badge?: string;
  latitude: number;
  longitude: number;
  tsi?: number;
  district?: string;
  bottleneck_type?: string;
  road_priority_weight?: number;
  weather_impact_factor?: number | null;
  deployed_officers?: number;
  required_officers?: number;
  assigned_officers?: BottleneckOfficer[];
}

export interface Incident {
  id: number;
  text: string;
  type: IncidentType;
  severity?: string;
  incident_type?: string;
  latitude?: number;
  longitude?: number;
}

export interface DashboardSnapshot {
  cityLabel: string;
  bottlenecks: Bottleneck[];
  incidents: Incident[];
  metrics: {
    coverageEfficiency: number | null;
    avgResponseTimeMinutes: number | null;
    resourceUtilization: number | null;
    weatherImpactFactor: number | null;
    shortages: number | null;
    requiredStaffing: number | null;
    assignedStaffing: number | null;
    asOf: string | null;
  };
}

export interface DashboardKpis {
  coverage_efficiency: number | null;
  avg_response_time: number | null;
  resource_utilization: number | null;
  weather_impact_factor: number | null;
  shortages: number;
  required_staffing: number;
  assigned_staffing: number;
  as_of: string;
  deployed_officers: number;
  active_officers: number;
}

export interface WeatherCurrentSnapshot {
  timestamp: string | null;
  condition: string | null;
  temperature: number | null;
  precipitation: number | null;
  weather_impact_factor: number | null;
  source: string;
  data_status: "live" | "fallback" | "cached" | "unavailable" | "unknown";
  available: boolean;
  is_synthetic: boolean;
  is_stale: boolean;
  observed_at: string | null;
  fetched_at: string | null;
}

export interface ExternalDataProvenance {
  source: string;
  data_status: "live" | "fallback" | "cached" | "unavailable" | "unknown";
  available: boolean;
  is_synthetic: boolean;
  is_stale: boolean;
  observed_at: string | null;
  fetched_at: string | null;
}

export interface LiveDashboardEvent {
  event: string;
  timestamp?: string;
  bottleneck_id?: string;
  bottleneck_name?: string;
  tsi?: number;
  weather_impact_factor?: number;
  previous_weather_impact_factor?: number;
  run_id?: string;
  status?: string;
  current_generation?: number;
  total_generations?: number;
  current_fitness?: number;
  estimated_completion?: string;
  error?: string;
}

type LiveCallback = (event: LiveDashboardEvent) => void;

export interface OptimizationStatus {
  event?: string;
  run_id: string;
  status: string;
  current_generation: number;
  total_generations: number;
  current_fitness: number;
  estimated_completion?: string;
  updated_at?: string;
  converged_early?: boolean;
  error?: string;
}

type OptimizationCallback = (event: OptimizationStatus) => void;

function getWebSocketBaseUrl() {
  const baseUrl = getApiBaseUrl();
  return baseUrl.replace(/^http/i, "ws");
}

const fallbackDashboardSnapshot: DashboardSnapshot = {
  cityLabel: "Iloilo City, Philippines", bottlenecks: [], incidents: [],
  metrics: { coverageEfficiency: null, avgResponseTimeMinutes: null, resourceUtilization: null,
    weatherImpactFactor: null, shortages: null, requiredStaffing: null, assignedStaffing: null, asOf: null },
};

const DEFAULT_TIMEOUT_MS = 15000;

export function getApiBaseUrl() {
  const desktopUrl = typeof window !== "undefined" ? window.desktopConfig?.backendUrl : undefined;
  const configuredUrl = desktopUrl || import.meta.env.VITE_API_BASE_URL;
  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, "");
  }

  return "http://127.0.0.1:8000";
}

let refreshPromise: Promise<string | null> | null = null;
async function tryRefreshToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) { clearSession(); return null; }
  refreshPromise = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/auth/refresh/`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({refresh: refreshToken}), signal: controller.signal,
      });
      // A login/logout in another operation makes this response obsolete.
      if (localStorage.getItem("refresh_token") !== refreshToken) return localStorage.getItem("auth_token");
      if (response.status === 401 || response.status === 400) {
        clearSession();
        return null;
      }
      if (!response.ok) throw new Error("Session refresh is temporarily unavailable. Please retry.");
      const data = await response.json();
      if (localStorage.getItem("refresh_token") !== refreshToken) return localStorage.getItem("auth_token");
      if (!data.access || !data.refresh) throw new Error("Invalid session refresh response.");
      localStorage.setItem("auth_token", data.access);
      localStorage.setItem("refresh_token", data.refresh);
      sessionChanged();
      return data.access;
    } finally { window.clearTimeout(timer); }
  })();
  try { return await refreshPromise; }
  finally { refreshPromise = null; }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;

  const token = localStorage.getItem("auth_token");
  const headers: HeadersInit = {
    ...fetchOptions.headers,
  };
  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });

    // If 401, try refreshing the token and retry once
    if (response.status === 401) {
      const currentToken = localStorage.getItem("auth_token");
      const newToken = currentToken && currentToken !== token ? currentToken : await tryRefreshToken();
      if (newToken) {
        (headers as Record<string, string>)["Authorization"] = `Bearer ${newToken}`;
        const retryResponse = await fetch(url, {
          ...fetchOptions,
          headers,
          signal: controller.signal,
        });
        if (retryResponse.status === 401 && localStorage.getItem("auth_token") === newToken) clearSession();
        return retryResponse;
      }
      // Session expiry is propagated to AuthContext by the shared session event.
    }

    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export interface ApiPage<T> { count: number; next: string | null; results: T[] }
export async function fetchPage<T>(url: string): Promise<ApiPage<T>> {
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(await extractApiError(response, `Failed to load records: ${response.status}`));
  const data = await response.json();
  return Array.isArray(data) ? {count: data.length, next: null, results: data} : data;
}
export async function fetchAllPages<T>(url: string): Promise<T[]> {
  const rows: T[] = [];
  const visited = new Set<string>();
  let next: string | null = url;
  while (next) {
    const resolved = new URL(next, getApiBaseUrl()).toString();
    if (new URL(resolved).origin !== new URL(getApiBaseUrl()).origin || visited.has(resolved)) throw new Error("Invalid pagination link.");
    visited.add(resolved);
    const page = await fetchPage<T>(resolved);
    rows.push(...page.results);
    next = page.next;
  }
  return rows;
}

export function getFallbackDashboardSnapshot() {
  return fallbackDashboardSnapshot;
}

export function buildWebSocketUrl(path: string, token?: string) {
  const url = new URL(path, `${getWebSocketBaseUrl()}/`);
  if (token) {
    url.searchParams.set("token", token);
  }
  return url.toString();
}

function createWebSocketSubscription<T>(
  path: string,
  onEvent: (data: T) => void,
  token?: string,
  onConnection?: (state: ConnectionState) => void,
): () => void {
  let socket: WebSocket | null = null;
  let shouldReconnect = true;
  let reconnectDelayMs = 500;
  let reconnectTimer: number | undefined;

  const connect = () => {
    onConnection?.("connecting");
    socket = new WebSocket(buildWebSocketUrl(path, localStorage.getItem("auth_token") ?? token));
    socket.onopen = () => { reconnectDelayMs = 500; onConnection?.("live"); };

    socket.onmessage = (event) => {
      try {
        onEvent(JSON.parse(event.data) as T);
      } catch {
        return;
      }
    };

    socket.onclose = () => {
      onConnection?.("disconnected");
      if (!shouldReconnect) {
        return;
      }
      reconnectTimer = window.setTimeout(() => {
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, 8000);
        connect();
      }, reconnectDelayMs);
    };

    socket.onerror = () => {
      socket?.close();
    };
  };

  connect();

  return () => {
    shouldReconnect = false;
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
    }
    socket?.close();
  };
}

export type ConnectionState = "connecting" | "live" | "disconnected";
export function subscribeToDashboardStream(onEvent: LiveCallback, token?: string, onConnection?: (state: ConnectionState) => void) {
  return createWebSocketSubscription<LiveDashboardEvent>("/ws/dashboard/", onEvent, token, onConnection);
}

export function subscribeToOptimizationStream(runId: string, onEvent: OptimizationCallback, token?: string) {
  return createWebSocketSubscription<OptimizationStatus>(`/ws/optimization/${runId}/`, onEvent, token);
}

export async function fetchDashboardSnapshot(shift = "afternoon"): Promise<DashboardSnapshot> {
  const base = getApiBaseUrl();
  const [kpiRes, bottlenecks, incidents] = await Promise.all([
    fetchWithTimeout(`${base}/api/dashboard/kpis/?shift=${shift}`),
    fetchAllPages<Bottleneck>(`${base}/api/dashboard/bottlenecks/?shift=${shift}`),
    fetchAllPages<Incident>(`${base}/api/dashboard/incidents/active/`),
  ]);
  if (!kpiRes.ok) throw new Error("Failed to load dashboard metrics.");
  const kpis = await kpiRes.json() as DashboardKpis;
  return {
    cityLabel: "Iloilo City, Philippines", bottlenecks, incidents,
    metrics: {
      coverageEfficiency: kpis.coverage_efficiency, avgResponseTimeMinutes: kpis.avg_response_time,
      resourceUtilization: kpis.resource_utilization, weatherImpactFactor: kpis.weather_impact_factor,
      shortages: kpis.shortages, requiredStaffing: kpis.required_staffing,
      assignedStaffing: kpis.assigned_staffing, asOf: kpis.as_of,
    },
  };
}

export async function fetchDashboardKpis(): Promise<DashboardKpis> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/dashboard/kpis/`);
  if (!response.ok) {
    throw new Error(`Failed to fetch dashboard KPIs: ${response.status}`);
  }
  return response.json() as Promise<DashboardKpis>;
}

export async function fetchCurrentWeather(): Promise<WeatherCurrentSnapshot> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/weather/current/`);
  if (!response.ok) {
    throw new Error(`Failed to fetch weather data: ${response.status}`);
  }
  return response.json() as Promise<WeatherCurrentSnapshot>;
}

export interface OptimizationRunRequest {
  shift?: string;
  operational_date?: string;
  mode?: "operational" | "shadow";
  session_id?: string;
  population_size?: number;
  generations?: number;
  mutation_rate?: number;
  crossover_rate?: number;
  elitism_count?: number;
  tsi_weight?: number;
  wif_weight?: number;
  rpw_weight?: number;
  resource_utilization_weight?: number;
}

export interface OptimizationRunResponse {
  run_id: string;
  status: string;
  current_generation: number;
  total_generations: number;
  current_fitness: number;
  estimated_completion?: string;
}

export interface OptimizationConfigRequest {
  shift?: string;
  operational_date?: string;
  mode?: "operational" | "shadow";
  session_id?: string;
  population_size?: number;
  generations?: number;
  mutation_rate?: number;
  crossover_rate?: number;
  elitism_count?: number;
  tsi_weight?: number;
  wif_weight?: number;
  rpw_weight?: number;
  resource_utilization_weight?: number;
}

export interface OptimizationConfigResponse {
  parameters: OptimizationConfigRequest;
  valid: boolean;
  errors?: Record<string, string | string[]>;
}

export async function fetchOptimizationConfig(
  request: OptimizationConfigRequest,
): Promise<OptimizationConfigResponse> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/optimization/configure/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok && response.status !== 400) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Failed to fetch optimization config: ${response.status} ${errorBody}`);
  }

  return response.json() as Promise<OptimizationConfigResponse>;
}

export async function runOptimization(request: OptimizationRunRequest): Promise<OptimizationRunResponse> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/optimization/start/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(await extractApiError(response, `Failed to start optimization run: ${response.status}`));
  }

  return response.json() as Promise<OptimizationRunResponse>;
}

export async function fetchOptimizationStatus(runId: string): Promise<OptimizationStatus> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/optimization/status/${runId}/`);

  if (!response.ok) {
    throw new Error(`Failed to fetch optimization status: ${response.status}`);
  }

  return response.json() as Promise<OptimizationStatus>;
}

export interface ParetoPoint {
  fitness?: number;
  coverage_efficiency?: number;
  avg_response_time?: number;
  resource_utilization?: number;
  road_priority_coverage?: number;
  coverage?: number;
  inverse_response_time?: number;
  weather_responsiveness?: number;
  resource_balance?: number;
}

export interface OptimizationResults {
  parameters?: {mode?: "operational" | "shadow"; operational_date?: string; session_id?: string};
  run_id: string;
  status: string;
  fitness_scores?: number[];
  total_generations?: number;
  top_solutions: Array<{
    rank?: number;
    fitness?: number;
    coverage_efficiency?: number;
    avg_response_time?: number;
    resource_utilization?: number;
    road_priority_coverage?: number;
    constraints_violated?: boolean;
    staffing_shortages?: Record<string, number>;
    staffing_targets?: Record<string, number>;
    staffing_efficiency?: number;
    reserve_officers?: number;
    generated_at?: string;
    assignments?: Array<{
      officer_id?: number;
      badge_number?: string;
      bottleneck_id?: string;
      bottleneck_name?: string;
    }>;
  }>;
  pareto_curve_data?: ParetoPoint[];
  converged_early?: boolean;
  synthetic_data_used?: string[] | null;
  input_snapshot?: {
    captured_at: string;
    bottlenecks: Array<{id: string; tsi: number; road_priority_weight: number; provenance: {source: string; data_status: string; is_stale: boolean; is_synthetic: boolean; observed_at: string | null}}>;
    weather: {source: string; data_status: string; is_stale: boolean; is_synthetic: boolean; assumption?: string};
  };
}

export async function fetchOptimizationResults(runId: string): Promise<OptimizationResults> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/optimization/results/${runId}/`);
  if (!response.ok) {
    throw new Error(`Failed to fetch optimization results: ${response.status}`);
  }
  return response.json() as Promise<OptimizationResults>;
}

export interface OptimizationHistoryItem {
  id: number;
  run_id: string;
  timestamp: string;
  parameters: Record<string, unknown>;
  fitness_scores: number[];
  result_data: Record<string, unknown>;
  status: string;
  created_by: number;
  generations_completed?: number;
}

export function fetchOptimizationHistory(page = 1, status?: string): Promise<ApiPage<OptimizationHistoryItem>> {
  return fetchPage<OptimizationHistoryItem>(`${getApiBaseUrl()}/api/optimization/history/?page=${page}&page_size=10${status ? "&status=" + status : ""}`);
}

export interface DeploymentScheduleItem {
  id: number;
  officer: string;
  officer_name: string;
  bottleneck: string;
  shift: string;
  start_time: string;
  end_time: string;
  assignment_type: string;
  status: string;
}

export interface PublishOptimizationDeploymentsRequest {
  run_id: string;
  shift?: "morning" | "afternoon";
  start_time?: string;
  end_time?: string;
  assignment_type?: "static" | "mobile" | "response";
  status?: string;
  replace_existing?: boolean;
  operational_date?: string;
  expected_revision?: string;
  idempotency_key?: string;
  input_override_reason?: string;
}

export interface PublishOptimizationDeploymentsResponse {
  run_id: string;
  created: number;
  skipped: Array<{ officer_id?: number; bottleneck_id?: string }>;
  shift: string;
  start_time: string;
  end_time: string;
}

export async function fetchDeploymentSchedule(date?: string): Promise<DeploymentScheduleItem[]> {
  return fetchAllPages<DeploymentScheduleItem>(`${getApiBaseUrl()}/api/deployments/schedule/${date ? "?date=" + encodeURIComponent(date) : ""}`);
}

export async function clearDeploymentSchedule(shift?: string, date?: string): Promise<{ cleared: number }> {
  const url = new URL(`${getApiBaseUrl()}/api/deployments/schedule/`);
  if (shift) url.searchParams.set("shift", shift);
  if (date) url.searchParams.set("date", date);
  const response = await fetchWithTimeout(url.toString(), {
    method: "DELETE",
  });

  if (!response.ok) {
    const detail = await extractApiError(response, `Failed to clear deployment schedule: ${response.status}`);
    throw new Error(detail);
  }

  return response.json() as Promise<{ cleared: number }>;
}

export async function publishDeploymentsFromOptimization(
  payload: PublishOptimizationDeploymentsRequest,
): Promise<PublishOptimizationDeploymentsResponse> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/deployments/publish-optimization/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await extractApiError(response, `Failed to publish optimization deployment: ${response.status}`);
    throw Object.assign(new Error(detail), {status: response.status});
  }

  return response.json() as Promise<PublishOptimizationDeploymentsResponse>;
}

export async function cancelOptimizationRun(runId: string): Promise<{ run_id: string; status: string }> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/optimization/cancel/${runId}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const detail = await extractApiError(response, `Failed to cancel optimization run: ${response.status}`);
    throw new Error(detail);
  }

  return response.json() as Promise<{ run_id: string; status: string }>;
}

export interface BottleneckOption {
  id: string;
  name: string;
}

export interface DashboardBottleneckPayload {
  id?: string;
  name: string;
  latitude: number;
  longitude: number;
  district?: string;
  bottleneck_type?: "intersection" | "bridge" | "school_zone" | "market" | "terminal" | "other";
  road_priority_weight?: number;
  tsi?: number;
}

export interface DashboardOfficerRecord {
  id: number;
  name: string;
  badge_number: string;
  shift: "morning" | "afternoon";
  status: "available" | "deployed" | "off_duty" | "unavailable";
  skills: string[];
  current_latitude?: number | null;
  current_longitude?: number | null;
}

export interface DashboardOfficerPayload {
  name: string;
  badge_number: string;
  shift: "morning" | "afternoon";
  status: "available" | "deployed" | "off_duty" | "unavailable";
  skills?: string[];
  current_latitude?: number | null;
  current_longitude?: number | null;
}

async function extractApiError(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string") return payload.detail;
    if (payload && typeof payload === "object") return Object.entries(payload).map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(", ") : JSON.stringify(errors)}`).join("; ");
  } catch {
    // Keep fallback when the backend does not return JSON detail.
  }
  return fallback;
}

export async function fetchBottlenecks(): Promise<BottleneckOption[]> {
  return fetchAllPages<BottleneckOption>(`${getApiBaseUrl()}/api/dashboard/bottlenecks/`);
}

export async function createDashboardBottleneck(payload: DashboardBottleneckPayload): Promise<Bottleneck> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/dashboard/bottlenecks/manage/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await extractApiError(response, `Failed to create bottleneck: ${response.status}`);
    throw new Error(detail);
  }
  return response.json() as Promise<Bottleneck>;
}

export async function deleteDashboardBottleneck(bottleneckId: string): Promise<void> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/dashboard/bottlenecks/manage/${encodeURIComponent(bottleneckId)}/`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const detail = await extractApiError(response, `Failed to remove bottleneck: ${response.status}`);
    throw new Error(detail);
  }
}

export async function updateDashboardBottleneck(
  bottleneckId: string,
  payload: Omit<DashboardBottleneckPayload, "id">
): Promise<Bottleneck> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/dashboard/bottlenecks/manage/${encodeURIComponent(bottleneckId)}/`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await extractApiError(response, `Failed to update bottleneck: ${response.status}`);
    throw new Error(detail);
  }
  return response.json() as Promise<Bottleneck>;
}

export async function fetchDashboardOfficers(): Promise<DashboardOfficerRecord[]> {
  return fetchAllPages<DashboardOfficerRecord>(`${getApiBaseUrl()}/api/dashboard/officers/`);
}

export async function createDashboardOfficer(payload: DashboardOfficerPayload): Promise<void> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/dashboard/officers/manage/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await extractApiError(response, `Failed to create officer: ${response.status}`);
    throw new Error(detail);
  }
}

export async function updateDashboardOfficer(officerId: number, payload: Partial<DashboardOfficerPayload>): Promise<void> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/dashboard/officers/manage/${officerId}/`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await extractApiError(response, `Failed to update officer: ${response.status}`);
    throw new Error(detail);
  }
}

export async function deleteDashboardOfficer(officerId: number): Promise<void> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/dashboard/officers/manage/${officerId}/`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const detail = await extractApiError(response, `Failed to remove officer: ${response.status}`);
    throw new Error(detail);
  }
}

export interface IncidentReportPayload {
  bottleneck: string;
  incident_type: string;
  severity: string;
  description: string;
}

export interface IncidentMetaOption {
  value: string;
  label: string;
}

export interface IncidentMetaSnapshot {
  incident_types: IncidentMetaOption[];
  severities: IncidentMetaOption[];
  statuses: IncidentMetaOption[];
}

export async function fetchIncidentMeta(): Promise<IncidentMetaSnapshot> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/incidents/meta/`);
  if (!response.ok) {
    throw new Error(`Failed to fetch incident metadata: ${response.status}`);
  }
  return response.json() as Promise<IncidentMetaSnapshot>;
}

export async function reportIncident(payload: IncidentReportPayload): Promise<void> {
  const body = new FormData();
  body.append("bottleneck", payload.bottleneck);
  body.append("incident_type", payload.incident_type);
  body.append("severity", payload.severity);
  body.append("description", payload.description);

  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/incidents/report/`, {
    method: "POST",
    body,
  });
  if (!response.ok) {
    throw new Error(`Failed to submit incident: ${response.status}`);
  }
}

export async function resolveIncident(incidentId: number): Promise<void> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/incidents/${incidentId}/resolve/`, {
    method: "PUT",
  });
  if (!response.ok) {
    throw new Error(`Failed to resolve incident: ${response.status}`);
  }
}

export async function fetchIncident(incidentId: number): Promise<{
  id: number;
  incident_type: string;
  severity: string;
  description: string;
  bottleneck: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
}> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/dashboard/incidents/${incidentId}/`);
  if (!response.ok) throw new Error(await extractApiError(response, `Incident ${incidentId} could not be loaded.`));
  return response.json();
}

export async function updateIncident(
  incidentId: number,
  data: { incident_type?: string; severity?: string; description?: string; bottleneck?: string },
): Promise<void> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/incidents/${incidentId}/update/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await extractApiError(response, `Failed to update incident: ${response.status}`));
  }
}

// ---- POI ----

export interface POI {
  id: number;
  poi_id: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  icon_url: string;
  is_active: boolean;
  priority_boost: number;
  created_at: string;
  updated_at: string;
}

export async function fetchPOIs(): Promise<POI[]> {
  return fetchAllPages<POI>(`${getApiBaseUrl()}/api/dashboard/pois/`);
}

export async function createPOI(data: {
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  priority_boost?: number;
}): Promise<POI> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/dashboard/pois/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(await extractApiError(response, `Failed to create POI: ${response.status}`));
  return response.json() as Promise<POI>;
}

export async function updatePOI(
  poiId: string,
  data: { name?: string; category?: string; priority_boost?: number; is_active?: boolean },
): Promise<POI> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/dashboard/pois/${poiId}/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(`Failed to update POI: ${response.status}`);
  return response.json() as Promise<POI>;
}

export async function deletePOI(poiId: string): Promise<void> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/dashboard/pois/${poiId}/`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await extractApiError(response, `Failed to delete POI: ${response.status}`));
}

export interface AuditLogRecord {
  id: number;
  user: number;
  action: string;
  resource: string;
  changes: Record<string, unknown>;
  timestamp: string;
}

export function fetchAuditLogs(page = 1): Promise<ApiPage<AuditLogRecord>> {
  return fetchPage<AuditLogRecord>(`${getApiBaseUrl()}/api/admin/audit-logs/?page=${page}&page_size=25`);
}

export interface AdminSystemHealthSnapshot {
  status: string;
  timestamp: string;
  database: string;
  queue: string;
  workers?: string;
  scheduler?: string;
  version?: string;
  pending_migrations?: number;
  providers?: Record<string, {status: string; observed_at: string | null; age_seconds: number | null}>;
}

export async function exportRecommendation(runId: string): Promise<void> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/optimization/export/${encodeURIComponent(runId)}/`);
  if (!response.ok) throw new Error(await extractApiError(response, "Recommendation export failed."));
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "recommendation.csv";
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ScheduleRevisionRecord {
  id: number; run_id: string; operational_date: string; shift: string; published_at: string;
  effective_start: string; effective_end: string; published_by: string;
  previous_assignments: PublicationAssignment[]; assignments: PublicationAssignment[];
}
export function fetchScheduleRevisions(date: string, page = 1) {
  return fetchPage<ScheduleRevisionRecord>(`${getApiBaseUrl()}/api/deployments/revisions/?date=${encodeURIComponent(date)}&page=${page}`);
}

export interface SystemHealthSnapshot {
  apiStatus: string;
  adminHealth: AdminSystemHealthSnapshot | null;
  adminForbidden: boolean;
}

export async function fetchSystemHealthSnapshot(): Promise<SystemHealthSnapshot> {
  const apiResponse = await fetchWithTimeout(`${getApiBaseUrl()}/api/health/`);
  if (!apiResponse.ok) {
    throw new Error(`Failed to fetch public health: ${apiResponse.status}`);
  }

  const apiPayload = (await apiResponse.json()) as { status?: string };
  const apiStatus = apiPayload.status ?? "unknown";

  const adminResponse = await fetchWithTimeout(`${getApiBaseUrl()}/api/admin/system-health/`);
  if (adminResponse.status === 403) {
    return {
      apiStatus,
      adminHealth: null,
      adminForbidden: true,
    };
  }

  if (!adminResponse.ok) {
    throw new Error(`Failed to fetch admin system health: ${adminResponse.status}`);
  }

  const adminPayload = (await adminResponse.json()) as AdminSystemHealthSnapshot;
  return {
    apiStatus,
    adminHealth: adminPayload,
    adminForbidden: false,
  };
}

export async function createMapIncident(payload: {latitude:number; longitude:number; incident_type:string; severity:string; description:string}) {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/dashboard/incidents/`, {
    method: "POST", headers: {"Content-Type":"application/json"}, body:JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await extractApiError(response, "Incident could not be saved."));
  return response.json() as Promise<{id:number}>;
}

export interface PublicationPreview extends PublishOptimizationDeploymentsResponse {
  operational_date: string;
  staff_added: number[];
  staff_removed: number[];
  replaced: number;
  conflicts: string[];
  expected_revision: string;
  captured_at: string;
  input_issues: string[];
  added_assignments: PublicationAssignment[];
  removed_assignments: PublicationAssignment[];
}
export interface PublicationAssignment {
  officer_id: number; officer_name: string; badge_number: string;
  bottleneck_id: string; bottleneck_name: string; start_time: string; end_time: string;
}
export async function previewPublication(payload: PublishOptimizationDeploymentsRequest): Promise<PublicationPreview> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/deployments/preview-optimization/`, {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload),
  });
  if (response.status === 404) {
    throw new Error("Schedule preview is unavailable on the running backend (HTTP 404). Restart Django with the updated code.");
  }
  if (!response.ok) throw new Error(await extractApiError(response, `Publication preview failed (HTTP ${response.status}).`));
  return response.json();
}
export function fetchOfficersPage(page: number, search: string, status: string, shift: string) {
  const query = new URLSearchParams({page: String(page), page_size: "25", search, status, shift});
  return fetchPage<DashboardOfficerRecord>(`${getApiBaseUrl()}/api/dashboard/officers/?${query}`);
}
