export type BottleneckStatus = "normal" | "warning" | "critical";
export type IncidentType = "critical" | "major" | "minor";

export interface Bottleneck {
  id: string;
  name: string;
  status: BottleneckStatus;
  badge?: string;
  latitude: number;
  longitude: number;
}

export interface Incident {
  id: number;
  text: string;
  type: IncidentType;
}

export interface DashboardSnapshot {
  cityLabel: string;
  bottlenecks: Bottleneck[];
  incidents: Incident[];
  metrics: {
    coverageEfficiency: number;
    avgResponseTimeMinutes: number;
    resourceUtilization: number;
    weatherCorrelation: number;
  };
}

export interface WeatherCurrentSnapshot {
  timestamp: string;
  condition: string;
  temperature: number;
  precipitation: number;
  weather_impact_factor: number;
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
}

type OptimizationCallback = (event: OptimizationStatus) => void;

function getWebSocketBaseUrl() {
  const baseUrl = getApiBaseUrl();
  return baseUrl.replace(/^http/i, "ws");
}

const fallbackDashboardSnapshot: DashboardSnapshot = {
  cityLabel: "Iloilo City, Philippines",
  bottlenecks: [
    { id: "B-001", name: "University of Iloilo - Main", status: "normal", latitude: 10.6979, longitude: 122.5626 },
    { id: "B-003", name: "Jaro Plaza Intersection", status: "normal", latitude: 10.7169, longitude: 122.5448 },
    { id: "B-012", name: "General Luna St. Bridge", status: "critical", badge: "ACTIVE INCIDENT", latitude: 10.7008, longitude: 122.5716 },
    { id: "B-018", name: "SM City Iloilo Diversion", status: "critical", latitude: 10.7243, longitude: 122.5451 },
    { id: "B-020", name: "Molo Church Perimeter", status: "normal", latitude: 10.6909, longitude: 122.5356 },
    { id: "B-022", name: "Iloilo Terminal Market", status: "normal", latitude: 10.6943, longitude: 122.5688 },
    { id: "B-025", name: "Location Area 1", status: "normal", latitude: 10.707, longitude: 122.5532 },
    { id: "B-026", name: "Location Area 2", status: "warning", latitude: 10.7128, longitude: 122.5751 },
    { id: "B-027", name: "Location Area 3", status: "normal", latitude: 10.6995, longitude: 122.5484 },
    { id: "B-028", name: "Location Area 4", status: "warning", latitude: 10.7048, longitude: 122.5609 },
  ],
  incidents: [
    { id: 1, text: "Critical: Vehicle Collision - B-012 General Luna Bridge", type: "critical" },
    { id: 2, text: "Major: Road Closure - B-018 SM City Diversion", type: "major" },
    { id: 3, text: "Minor: Construction Work - B-005 Molo District", type: "minor" },
  ],
  metrics: {
    coverageEfficiency: 85,
    avgResponseTimeMinutes: 12,
    resourceUtilization: 78,
    weatherCorrelation: 0.82,
  },
};

export function getApiBaseUrl() {
  if (typeof window !== "undefined" && window.desktopConfig?.backendUrl) {
    return window.desktopConfig.backendUrl;
  }

  return "http://127.0.0.1:8000";
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

export function subscribeToDashboardStream(onEvent: LiveCallback, token?: string) {
  let socket: WebSocket | null = null;
  let shouldReconnect = true;
  let reconnectDelayMs = 500;
  let reconnectTimer: number | undefined;

  const connect = () => {
    socket = new WebSocket(buildWebSocketUrl("/ws/dashboard/", token));

    socket.onmessage = (event) => {
      try {
        onEvent(JSON.parse(event.data) as LiveDashboardEvent);
      } catch {
        return;
      }
    };

    socket.onclose = () => {
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

export function subscribeToOptimizationStream(runId: string, onEvent: OptimizationCallback, token?: string) {
  let socket: WebSocket | null = null;
  let shouldReconnect = true;
  let reconnectDelayMs = 500;
  let reconnectTimer: number | undefined;

  const connect = () => {
    socket = new WebSocket(buildWebSocketUrl(`/ws/optimization/${runId}/`, token));

    socket.onmessage = (event) => {
      try {
        onEvent(JSON.parse(event.data) as OptimizationStatus);
      } catch {
        return;
      }
    };

    socket.onclose = () => {
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

export async function fetchDashboardSnapshot(): Promise<DashboardSnapshot> {
  const base = getApiBaseUrl();
  const [kpiRes, bottleneckRes, incidentRes] = await Promise.all([
    fetch(`${base}/api/dashboard/kpis/`),
    fetch(`${base}/api/dashboard/bottlenecks/`),
    fetch(`${base}/api/dashboard/incidents/active/`),
  ]);

  if (!kpiRes.ok || !bottleneckRes.ok || !incidentRes.ok) {
    throw new Error("Failed to load dashboard data");
  }

  const kpis = (await kpiRes.json()) as {
    coverage_efficiency: number;
    avg_response_time: number;
    resource_utilization: number;
    weather_correlation: number;
  };
  const bottlenecks = (await bottleneckRes.json()) as Array<{
    id: string;
    name: string;
    status: BottleneckStatus;
    latitude: number;
    longitude: number;
  }>;
  const incidents = (await incidentRes.json()) as Incident[];

  const projected = bottlenecks.map((item, index) => ({
    id: item.id,
    name: item.name,
    status: item.status,
    latitude: item.latitude,
    longitude: item.longitude,
  }));

  return {
    cityLabel: "Iloilo City, Philippines",
    bottlenecks: projected,
    incidents,
    metrics: {
      coverageEfficiency: kpis.coverage_efficiency,
      avgResponseTimeMinutes: kpis.avg_response_time,
      resourceUtilization: kpis.resource_utilization,
      weatherCorrelation: kpis.weather_correlation,
    },
  };
}

export async function fetchCurrentWeather(): Promise<WeatherCurrentSnapshot> {
  const response = await fetch(`${getApiBaseUrl()}/api/weather/current/`);
  if (!response.ok) {
    throw new Error(`Failed to fetch weather data: ${response.status}`);
  }
  return response.json() as Promise<WeatherCurrentSnapshot>;
}

export interface OptimizationRunRequest {
  shift?: string;
  population_size?: number;
  generations?: number;
  mutation_rate?: number;
  crossover_rate?: number;
  elitism_count?: number;
}

export interface OptimizationRunResponse {
  run_id: string;
  status: string;
  current_generation: number;
  total_generations: number;
  current_fitness: number;
  estimated_completion?: string;
}

export async function runOptimization(request: OptimizationRunRequest): Promise<OptimizationRunResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/optimization/start/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Failed to start optimization run: ${response.status}`);
  }

  return response.json() as Promise<OptimizationRunResponse>;
}

export async function fetchOptimizationStatus(runId: string): Promise<OptimizationStatus> {
  const response = await fetch(`${getApiBaseUrl()}/api/optimization/status/${runId}/`);

  if (!response.ok) {
    throw new Error(`Failed to fetch optimization status: ${response.status}`);
  }

  return response.json() as Promise<OptimizationStatus>;
}

export interface OptimizationResults {
  run_id: string;
  status: string;
  fitness_scores?: number[];
  total_generations?: number;
  top_solutions: Array<{
    score?: number;
    efficiency?: number;
    coverage?: number;
    congestion_reduction?: number;
    officer_utilization?: number;
    assignments?: Array<{
      bottleneck_id?: string;
      bottleneck_name?: string;
      officers?: string[];
      required_officers?: number;
    }>;
  }>;
}

export async function fetchOptimizationResults(runId: string): Promise<OptimizationResults> {
  const response = await fetch(`${getApiBaseUrl()}/api/optimization/results/${runId}/`);
  if (!response.ok) {
    throw new Error(`Failed to fetch optimization results: ${response.status}`);
  }
  return response.json() as Promise<OptimizationResults>;
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

export async function fetchDeploymentSchedule(): Promise<DeploymentScheduleItem[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/deployments/schedule/`);
  if (!response.ok) {
    throw new Error(`Failed to fetch deployment schedule: ${response.status}`);
  }
  return response.json() as Promise<DeploymentScheduleItem[]>;
}

export interface BottleneckOption {
  id: string;
  name: string;
}

export async function fetchBottlenecks(): Promise<BottleneckOption[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/dashboard/bottlenecks/`);
  if (!response.ok) {
    throw new Error(`Failed to fetch bottlenecks: ${response.status}`);
  }
  const rows = (await response.json()) as Array<{ id: string; name: string }>;
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export interface IncidentReportPayload {
  bottleneck: string;
  incident_type: string;
  severity: string;
  description: string;
}

export async function reportIncident(payload: IncidentReportPayload): Promise<void> {
  const body = new FormData();
  body.append("bottleneck", payload.bottleneck);
  body.append("incident_type", payload.incident_type);
  body.append("severity", payload.severity);
  body.append("description", payload.description);

  const response = await fetch(`${getApiBaseUrl()}/api/incidents/report/`, {
    method: "POST",
    body,
  });
  if (!response.ok) {
    throw new Error(`Failed to submit incident: ${response.status}`);
  }
}

export interface ScenarioRecord {
  id: number;
  name: string;
  description: string;
  preset_parameters: Record<string, unknown>;
  is_default: boolean;
}

export async function fetchScenarios(): Promise<ScenarioRecord[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/scenarios/`);
  if (!response.ok) {
    throw new Error(`Failed to fetch scenarios: ${response.status}`);
  }
  return response.json() as Promise<ScenarioRecord[]>;
}

export async function createScenario(payload: {
  name: string;
  description: string;
  preset_parameters: Record<string, unknown>;
  is_default?: boolean;
}): Promise<ScenarioRecord> {
  const response = await fetch(`${getApiBaseUrl()}/api/scenarios/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to create scenario: ${response.status}`);
  }
  return response.json() as Promise<ScenarioRecord>;
}

export interface AnalyticsTrendPoint {
  timestamp: string;
  traffic_severity_index: number;
  avg_speed: number;
}

export async function fetchAnalyticsTrends(): Promise<AnalyticsTrendPoint[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/analytics/trends/`);
  if (!response.ok) {
    throw new Error(`Failed to fetch analytics trends: ${response.status}`);
  }

  const payload = (await response.json()) as { trends?: AnalyticsTrendPoint[] };
  return Array.isArray(payload.trends) ? payload.trends : [];
}

export interface AuditLogRecord {
  id: number;
  user: number;
  action: string;
  resource: string;
  changes: Record<string, unknown>;
  timestamp: string;
}

export async function fetchAuditLogs(): Promise<AuditLogRecord[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/admin/audit-logs/`);
  if (!response.ok) {
    throw new Error(`Failed to fetch audit logs: ${response.status}`);
  }
  return response.json() as Promise<AuditLogRecord[]>;
}

export interface AdminSystemHealthSnapshot {
  status: string;
  timestamp: string;
  database: string;
  queue: string;
}

export interface SystemHealthSnapshot {
  apiStatus: string;
  adminHealth: AdminSystemHealthSnapshot | null;
  adminForbidden: boolean;
}

export async function fetchSystemHealthSnapshot(): Promise<SystemHealthSnapshot> {
  const apiResponse = await fetch(`${getApiBaseUrl()}/api/health/`);
  if (!apiResponse.ok) {
    throw new Error(`Failed to fetch public health: ${apiResponse.status}`);
  }

  const apiPayload = (await apiResponse.json()) as { status?: string };
  const apiStatus = apiPayload.status ?? "unknown";

  const adminResponse = await fetch(`${getApiBaseUrl()}/api/admin/system-health/`);
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
