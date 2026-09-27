import { renderHook, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "../app/contexts/AuthContext";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { fetchAllPages, fetchDashboardOfficers, fetchPOIs, fetchIncident, createPOI, createMapIncident, resolveIncident, getFallbackDashboardSnapshot, previewPublication } from "../app/services/backend";
import { SESSION_EVENT } from "../app/services/session";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {"Content-Type": "application/json"}});
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
afterEach(() => vi.unstubAllGlobals());

it("shares one rotating refresh across simultaneous 401 responses and synchronizes the session", async () => {
  localStorage.setItem("auth_token", "old"); localStorage.setItem("refresh_token", "rotate-me");
  const session = vi.fn(); window.addEventListener(SESSION_EVENT, session);
  let refreshed = 0;
  const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
    if (url.includes("/refresh/")) {
      refreshed++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return json({access: "new", refresh: "rotated"});
    }
    return options.headers?.["Authorization"] === "Bearer old" ? json({}, 401) : json({count: 1, next: null, results: [{id: 101}]});
  });
  vi.stubGlobal("fetch", fetchMock);
  const [officers, pois] = await Promise.all([fetchDashboardOfficers(), fetchPOIs()]);
  expect(refreshed).toBe(1);
  expect(officers[0].id).toBe(101); expect(pois[0].id).toBe(101);
  expect(localStorage.getItem("auth_token")).toBe("new");
  expect(localStorage.getItem("refresh_token")).toBe("rotated");
  expect(session).toHaveBeenCalledTimes(1);
  window.removeEventListener(SESSION_EVENT, session);
});

it("a late refresh rejection cannot clear a newer login", async () => {
  localStorage.setItem("auth_token", "old"); localStorage.setItem("refresh_token", "old-refresh");
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
    if (url.includes("/refresh/")) {
      localStorage.setItem("auth_token", "new-login"); localStorage.setItem("refresh_token", "new-login-refresh");
      return json({}, 401);
    }
    return options.headers?.["Authorization"] === "Bearer old" ? json({}, 401) : json([]);
  }));
  await fetchDashboardOfficers();
  expect(localStorage.getItem("auth_token")).toBe("new-login");
});

it("expired sessions notify AuthContext and clear all credentials", async () => {
  localStorage.setItem("auth_token", "old"); localStorage.setItem("refresh_token", "expired"); localStorage.setItem("auth_user", "{}");
  vi.stubGlobal("fetch", vi.fn(async () => json({}, 401)));
  const listener = vi.fn(); window.addEventListener(SESSION_EVENT, listener);
  await expect(fetchPOIs()).rejects.toThrow();
  expect(localStorage.getItem("auth_user")).toBeNull();
  expect(listener).toHaveBeenCalled();
  window.removeEventListener(SESSION_EVENT, listener);
});

it("fetches every required page beyond 100 without dropping records", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("page=2") ?
    json({count: 101, next: null, results: [{id:101}]}) :
    json({count: 101, next: "/api/dashboard/pois/?page=2", results: Array.from({length:100}, (_,i)=>({id:i+1}))})));
  const rows = await fetchPOIs();
  expect(rows).toHaveLength(101); expect(rows[100].id).toBe(101);
});

it("rejects pagination cycles and cross-origin credential forwarding", async () => {
  const fetchMock = vi.fn(async () => json({count:1,next:"https://untrusted.invalid/records",results:[]}));
  vi.stubGlobal("fetch", fetchMock);
  await expect(fetchPOIs()).rejects.toThrow("Invalid pagination");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockResolvedValue(json({count:1,next:"/api/dashboard/pois/",results:[]}));
  await expect(fetchAllPages("http://127.0.0.1:8000/api/dashboard/pois/")).rejects.toThrow("Invalid pagination");
});

it("uses the incident detail endpoint for an ID outside the first page", async () => {
  const fetchMock = vi.fn(async (_url: string) => json({id: 501, description:"Persisted"}));
  vi.stubGlobal("fetch", fetchMock);
  expect((await fetchIncident(501)).id).toBe(501);
  expect(fetchMock.mock.calls[0][0]).toContain("/api/dashboard/incidents/501/");
});

it("returns real IDs and propagates creation and deletion failures", async () => {
  const fetchMock = vi.fn(async () => json({id:875,poi_id:"POI-server"},201));
  vi.stubGlobal("fetch", fetchMock);
  expect((await createPOI({name:"Hospital",category:"hospital",latitude:0,longitude:0})).poi_id).toBe("POI-server");
  fetchMock.mockImplementation(async () => json({detail:"Persistence failed"},503));
  await expect(createPOI({name:"Fail",category:"other",latitude:0,longitude:0})).rejects.toThrow("Persistence failed");
  await expect(createMapIncident({description:"Fail",incident_type:"other",severity:"minor",latitude:0,longitude:0})).rejects.toThrow();
  await expect(resolveIncident(875)).rejects.toThrow();
});

it("initial dashboard state contains no fake observations or entities", () => {
  const empty = getFallbackDashboardSnapshot();
  expect(empty.bottlenecks).toEqual([]); expect(empty.incidents).toEqual([]);
  expect(empty.metrics.coverageEfficiency).toBeNull();
});

it("AuthContext follows the final expired session state", async () => {
  localStorage.setItem("auth_token", "expired"); localStorage.setItem("refresh_token", "expired");
  localStorage.setItem("auth_user", JSON.stringify({id:1,username:"Dispatcher",role:"dispatcher"}));
  const {result} = renderHook(() => useAuth(), {wrapper: AuthProvider});
  await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
  vi.stubGlobal("fetch", vi.fn(async () => json({},401)));
  await expect(fetchPOIs()).rejects.toThrow();
  await waitFor(() => expect(result.current.isAuthenticated).toBe(false));
  expect(result.current.token).toBeNull();
});

it("identifies an outdated backend when schedule preview returns 404", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("Not Found", {status: 404})));
  await expect(previewPublication({run_id: "saved-run", operational_date: "2026-09-25"}))
    .rejects.toThrow("Restart Django with the updated code");
});
