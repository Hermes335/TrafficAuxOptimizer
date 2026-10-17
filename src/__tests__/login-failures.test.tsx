import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "../app/contexts/AuthContext";
import { Login } from "../app/pages/Login";
import { AuthRedirect } from "../app/components/AuthRedirect";
import { ProtectedRoute } from "../app/components/ProtectedRoute";

vi.mock("../app/services/backend", () => ({
  getApiBaseUrl: () => "https://api.example.com",
  fetchDashboardKpis: async () => ({ deployed_officers: 0, avg_response_time: null }),
  fetchDashboardSnapshot: async () => ({ bottlenecks: [] }),
}));

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

async function showLogin() {
  render(<MemoryRouter initialEntries={["/login"]}><AuthProvider><Routes>
    <Route path="/login" element={<AuthRedirect><Login /></AuthRedirect>} />
    <Route path="/" element={<ProtectedRoute><div>Signed in successfully</div></ProtectedRoute>} />
  </Routes></AuthProvider></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText("Employee ID"), { target: { value: "demo_admin" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-password" } });
}

it("keeps the form mounted while sign-in is pending and preserves inputs after failure", async () => {
  let rejectRequest!: (reason: Error) => void;
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise((_resolve, reject) => {
    rejectRequest = reject;
  })));
  await showLogin();
  fireEvent.click(screen.getByRole("button", { name: "Sign In to System" }));
  expect(screen.getByRole("button", { name: "Authenticating..." })).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("Employee ID")).toHaveProperty("value", "demo_admin");
  expect(screen.getByLabelText("Password")).toHaveProperty("value", "test-password");
  rejectRequest(new TypeError("Failed to fetch"));
  expect(await screen.findByText(/Cannot reach the server/)).toBeTruthy();
  expect(screen.getByLabelText("Employee ID")).toHaveProperty("value", "demo_admin");
  expect(screen.getByLabelText("Password")).toHaveProperty("value", "test-password");
});

it("keeps connection errors visible and does not lock out users for an offline backend", async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetch);
  await showLogin();
  for (let attempt = 0; attempt < 6; attempt++) {
    fireEvent.click(screen.getByRole("button", { name: "Sign In to System" }));
    expect(await screen.findByText(/Cannot reach the server/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign In to System" })).toHaveProperty("disabled", false);
  }
  expect(fetch).toHaveBeenCalledTimes(6);
  expect(screen.queryByText(/Account locked/)).toBeNull();
});

it("preserves credential errors until the user edits an input", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ detail: "Invalid credentials." }), { status: 401 },
  )));
  await showLogin();
  fireEvent.click(screen.getByRole("button", { name: "Sign In to System" }));
  expect(await screen.findByText("Invalid credentials. 4 attempts remaining.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "new-password" } });
  await waitFor(() => expect(screen.queryByText(/4 attempts remaining/)).toBeNull());
});

it("shows service failures without calling them invalid credentials", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Service unavailable", { status: 503 })));
  await showLogin();
  fireEvent.click(screen.getByRole("button", { name: "Sign In to System" }));
  expect(await screen.findByText(/sign-in service is unavailable/)).toBeTruthy();
  expect(screen.queryByText(/Invalid credentials/)).toBeNull();
});

it("shows a timeout message when sign-in is aborted", async () => {
  const error = new Error("Aborted");
  error.name = "AbortError";
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
  await showLogin();
  fireEvent.click(screen.getByRole("button", { name: "Sign In to System" }));
  expect(await screen.findByText(/server took too long to respond/)).toBeTruthy();
});

it("still stores a valid session and navigates after successful sign-in", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    access: "test-access", refresh: "test-refresh", user: { id: 1, username: "demo_admin", role: "administrator" },
  }), { status: 200 })));
  await showLogin();
  fireEvent.click(screen.getByRole("button", { name: "Sign In to System" }));
  expect(await screen.findByText("Signed in successfully")).toBeTruthy();
  expect(localStorage.getItem("auth_token")).toBe("test-access");
});
