import { fetchAllPages, fetchWithTimeout, getApiBaseUrl } from "./backend";

export interface ReportLocation {
  id: string; name: string; latitude: number; longitude: number;
}
export interface ReportIncident {
  id: number; reference?: string; source?: string; incident_type: string; severity: string;
  description: string; latitude: number | null; longitude: number | null;
  bottleneck: string | null; photo_url?: string; status: string; timestamp?: string;
}
export interface ReportPayload {
  bottleneck?: string;
  latitude: number; longitude: number; incident_type: string; severity: string;
  description: string; photo?: File; submission_key: string;
}
export interface ReportReceipt { id: number; reference: string; status: string }
export class ReportRequestError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = "ReportRequestError"; }
}

async function request(path: string, options?: RequestInit & { timeout?: number }) {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/${path}`, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    const details = Object.entries(data).map(([key, value]) => {
      const text = Array.isArray(value) ? value.join(" ") : typeof value === "string" ? value : "";
      return text ? `${key === "detail" || key === "non_field_errors" ? "" : `${key.replace(/_/g, " ")}: `}${text}` : "";
    }).filter(Boolean).join(" ");
    throw new ReportRequestError(details || (response.status === 401 ? "Your session expired. Please sign in again." :
      response.status === 429 ? "Too many reports. Please wait before trying again." : "Unable to complete this request. Please try again."), response.status);
  }
  return response;
}

export async function fetchReportLocations(): Promise<ReportLocation[]> {
  return (await request("incidents/locations/")).json();
}
export async function fetchReportMeta(): Promise<{
  incident_types: Array<{value: string; label: string}>;
  severities: Array<{value: string; label: string}>;
}> {
  return (await request("incidents/meta/")).json();
}
export async function submitIncidentReport(payload: ReportPayload): Promise<ReportReceipt> {
  const body = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) body.append(key, value instanceof File ? value : String(value));
  }
  return (await request("incidents/report/", {method: "POST", body, timeout: 60000})).json();
}
export async function fetchReportIncident(id: number): Promise<ReportIncident> {
  return (await request(`dashboard/incidents/${id}/`)).json();
}
export async function saveReportIncident(id: number, payload: Omit<ReportPayload, "photo" | "submission_key">): Promise<void> {
  await request(`incidents/${id}/update/`, {method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)});
}
export function fetchPendingReports(): Promise<ReportIncident[]> {
  return fetchAllPages<ReportIncident>(`${getApiBaseUrl()}/api/incidents/review/`);
}
export async function reviewIncidentReport(id: number, decision: "approve" | "reject"): Promise<void> {
  await request(`incidents/${id}/review/`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({decision})});
}
export async function fetchIncidentPhoto(id: number): Promise<Blob> {
  return (await request(`incidents/${id}/photo/`)).blob();
}
