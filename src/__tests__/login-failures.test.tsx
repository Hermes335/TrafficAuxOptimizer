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
  fireEvent.change(await screen.findByLabelText("Username or badge number"), { target: { value: "demo_admin" } });
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
  expect(screen.getByLabelText("Username or badge number")).toHaveProperty("value", "demo_admin");
  expect(screen.getByLabelText("Password")).toHaveProperty("value", "test-password");
  rejectRequest(new TypeError("Failed to fetch"));
  expect(await screen.findByText(/Cannot reach the server/)).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("Cannot reach the server");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("alert")));
  expect(screen.getByLabelText("Username or badge number")).toHaveProperty("value", "demo_admin");
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
  expect(screen.getByLabelText("Password").getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByLabelText("Password").getAttribute("aria-describedby")).toBe("login-error");
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "new-password" } });
  await waitFor(() => expect(screen.queryByText(/4 attempts remaining/)).toBeNull());
  expect(screen.getByLabelText("Password").getAttribute("aria-invalid")).toBe("false");
});

it("focuses missing fields and connects their announced errors", async () => {
  await showLogin();
  const username = screen.getByLabelText("Username or badge number");
  fireEvent.change(username, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign In to System" }));
  expect(screen.getByRole("alert").textContent).toContain("Username or badge number is required");
  expect(document.activeElement).toBe(username);
  expect(username.getAttribute("aria-describedby")).toBe("login-error");
  fireEvent.change(username, { target: { value: "Officer" } });
  const password = screen.getByLabelText("Password");
  fireEvent.change(password, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign In to System" }));
  expect(screen.getByRole("alert").textContent).toContain("Password is required");
  expect(document.activeElement).toBe(password);
  expect(password.getAttribute("aria-describedby")).toBe("login-error");
});

it("offers password reset instructions without an error and makes public reporting discoverable", async () => {
  await showLogin();
  fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
  expect(screen.getByRole("status").textContent).toContain("Provide your username or badge number through your office’s usual support channel");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Forgot password?" }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("link", { name: /Report a traffic incident/ }).getAttribute("href")).toBe("/incident-report");
});

it("retains the five-attempt credential lockout", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ detail: "Invalid credentials." }), { status: 401 }));
  vi.stubGlobal("fetch", fetch);
  await showLogin();
  for (let attempt = 0; attempt < 5; attempt++) {
    fireEvent.click(screen.getByRole("button", { name: "Sign In to System" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Authenticating..." })).toBeNull());
  }
  expect(screen.getByRole("alert").textContent).toContain("Account locked for 15 minutes");
  expect(screen.getByRole("button", { name: "Sign In to System" })).toHaveProperty("disabled", true);
  expect(fetch).toHaveBeenCalledTimes(5);
});

it("keeps server rate limiting separate from invalid-credential attempts", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
  await showLogin();
  fireEvent.click(screen.getByRole("button", { name: "Sign In to System" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Too many sign-in requests"));
  expect(screen.queryByText(/Invalid credentials/)).toBeNull();
  expect(screen.getByRole("button", { name: "Sign In to System" })).toHaveProperty("disabled", false);
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
