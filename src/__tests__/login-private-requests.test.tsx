import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../app/contexts/AuthContext";
import { AuthRedirect } from "../app/components/AuthRedirect";
import { Login } from "../app/pages/Login";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it("does not request protected dashboard data or refresh a session before sign-in", async () => {
  const request = vi.fn(async () => new Response("{}", { status: 401 }));
  vi.stubGlobal("fetch", request);
  render(<MemoryRouter initialEntries={["/login"]}><AuthProvider>
    <AuthRedirect><Login /></AuthRedirect>
  </AuthProvider></MemoryRouter>);

  await screen.findByRole("button", { name: "Sign In to System" });
  await act(async () => {});
  expect(request).not.toHaveBeenCalled();
  expect(localStorage.getItem("auth_token")).toBeNull();
});
