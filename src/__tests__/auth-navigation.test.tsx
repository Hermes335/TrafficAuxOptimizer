import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { AuthProvider, useAuth, type UserRole } from "../app/contexts/AuthContext";
import { AuthRedirect } from "../app/components/AuthRedirect";
import { ProtectedRoute } from "../app/components/ProtectedRoute";
import { Login } from "../app/pages/Login";
import { loginDestination } from "../app/services/loginDestination";
import { sessionChanged } from "../app/services/session";

vi.mock("../app/hooks/useTrafficActivity", () => ({ useTrafficActivity: () => {} }));
vi.mock("../app/services/backend", () => ({
  getApiBaseUrl: () => "https://api.example.com",
  fetchDashboardKpis: async () => ({ deployed_officers: 0, avg_response_time: null }),
  fetchDashboardSnapshot: async () => ({ bottlenecks: [] }),
}));

beforeEach(() => localStorage.clear());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function storeSession(role: UserRole, token = "initial-access") {
  localStorage.setItem("auth_token", token);
  localStorage.setItem("refresh_token", "initial-refresh");
  localStorage.setItem("auth_user", JSON.stringify({ id: 1, username: "Officer", role }));
}

function Destination() {
  const location = useLocation();
  return <div data-testid="destination">{location.pathname + location.search + location.hash}</div>;
}

it("signs out locally immediately, bounds revocation, and preserves a newer session", async () => {
  storeSession("supervisor");
  let signal!: AbortSignal;
  const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    signal = options.signal as AbortSignal;
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
  vi.useFakeTimers();
  await act(async () => { await result.current.logout(); });
  expect(result.current.isAuthenticated).toBe(false);
  expect(localStorage.getItem("auth_token")).toBeNull();
  expect(localStorage.getItem("refresh_token")).toBeNull();
  expect(localStorage.getItem("auth_user")).toBeNull();
  expect(signal.aborted).toBe(false);
  expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/auth/logout/", expect.objectContaining({
    headers: expect.objectContaining({ Authorization: "Bearer initial-access" }),
    body: JSON.stringify({ refresh: "initial-refresh" }),
  }));
  act(() => { storeSession("administrator", "new-access"); sessionChanged(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(signal.aborted).toBe(true);
  expect(result.current.token).toBe("new-access");
  expect(result.current.isAuthenticated).toBe(true);
  expect(localStorage.getItem("auth_token")).toBe("new-access");
});

it("restores a protected destination including its query and fragment after login", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    access: "signed-in", user: { id: 1, username: "Officer", role: "dispatcher" },
  }))));
  render(<MemoryRouter initialEntries={["/gantt-chart?date=2026-10-21&shift=afternoon#timeline"]}><AuthProvider><Routes>
    <Route path="/login" element={<AuthRedirect><Login /></AuthRedirect>} />
    <Route path="/gantt-chart" element={<ProtectedRoute><Destination /></ProtectedRoute>} />
    <Route path="/" element={<Destination />} />
  </Routes></AuthProvider></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText("Username or badge number"), { target: { value: "Officer" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "simulation" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign In to System" }));
  expect((await screen.findByTestId("destination")).textContent).toBe("/gantt-chart?date=2026-10-21&shift=afternoon#timeline");
});

it.each([
  ["administrator", "/audit-logs?date=today#events", "/audit-logs?date=today#events"],
  ["supervisor", "/audit-logs", "/"],
  ["dispatcher", "/optimization?shift=afternoon", "/"],
  ["supervisor", "/optimization-engine?run_id=abc", "/optimization-engine?run_id=abc"],
] as const)("AuthRedirect restores only destinations permitted for %s: %s", async (role, from, expected) => {
  storeSession(role);
  render(<MemoryRouter initialEntries={[{ pathname: "/login", state: { from } }]}><AuthProvider><Routes>
    <Route path="/login" element={<AuthRedirect><div>Login form</div></AuthRedirect>} />
    <Route path="*" element={<Destination />} />
  </Routes></AuthProvider></MemoryRouter>);
  expect((await screen.findByTestId("destination")).textContent).toBe(expected);
});

it("Login itself restores the intended destination when rendered without AuthRedirect", async () => {
  storeSession("dispatcher");
  render(<MemoryRouter initialEntries={[{ pathname: "/login", state: { from: { pathname: "/incident-review", search: "?page=2", hash: "#report-92" } } }]}><AuthProvider><Routes>
    <Route path="/login" element={<Login />} />
    <Route path="*" element={<Destination />} />
  </Routes></AuthProvider></MemoryRouter>);
  expect((await screen.findByTestId("destination")).textContent).toBe("/incident-review?page=2#report-92");
});

it.each([
  "https://untrusted.invalid/gantt-chart", "//untrusted.invalid/gantt-chart", "/\\untrusted.invalid/gantt-chart",
  "/login", "/missing-page", "/%2F%2Funtrusted.invalid", "/gantt-chart\n", "javascript:alert(1)",
])("ignores an unsafe or unsupported login destination: %s", from => {
  expect(loginDestination({ from }, "administrator")).toBe("/");
});

it("rejects malformed destination objects and restores a permitted report editor", () => {
  expect(loginDestination({ from: { pathname: "/gantt-chart", search: 3 } }, "supervisor")).toBe("/");
  expect(loginDestination({ from: { pathname: "/gantt-chart", search: "//untrusted.invalid" } }, "supervisor")).toBe("/");
  expect(loginDestination({ from: { pathname: "/incident-report/91", search: "?return=review", hash: "#location" } }, "dispatcher"))
    .toBe("/incident-report/91?return=review#location");
});
