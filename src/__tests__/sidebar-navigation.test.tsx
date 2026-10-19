import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { expect, it, vi } from "vitest";
import { Sidebar } from "../app/components/Sidebar";

vi.mock("../app/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { role: "administrator" } }),
}));

function NavigationHarness() {
  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  return <>
    <button onClick={() => setMobileOpen(true)}>Open navigation</button>
    <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} mobileOpen={mobileOpen} onMobileOpenChange={setMobileOpen} />
    <output aria-label="Current route">{location.pathname}</output>
  </>;
}

function expectOnlyActiveLink(navigation: HTMLElement, name: string) {
  const links = within(navigation).getAllByRole("link");
  const active = within(navigation).getByRole("link", { name });
  expect(active.getAttribute("aria-current")).toBe("page");
  // Check the rendered visual state too: Tooltip's asChild composition can
  // stringify a NavLink class callback while aria-current remains correct.
  expect(active.classList.contains("bg-amber-50")).toBe(true);
  expect(active.classList.contains("text-amber-900")).toBe(true);
  for (const link of links.filter(link => link !== active)) {
    expect(link.getAttribute("aria-current")).toBeNull();
    expect(link.className).not.toContain("bg-amber-50");
    expect(link.className).not.toContain("ring-amber-200");
  }
}

it("styles only the active collapsed navigation link and updates it after navigation", () => {
  render(<MemoryRouter><NavigationHarness /></MemoryRouter>);
  const navigation = screen.getByRole("complementary", { name: "Primary navigation" });
  expectOnlyActiveLink(navigation, "Dashboard");

  fireEvent.click(within(navigation).getByRole("link", { name: "Optimization" }));
  expect(screen.getByLabelText("Current route").textContent).toBe("/optimization");
  expectOnlyActiveLink(navigation, "Optimization");

  fireEvent.click(within(navigation).getByRole("link", { name: "Dashboard" }));
  expect(screen.getByLabelText("Current route").textContent).toBe("/");
  expectOnlyActiveLink(navigation, "Dashboard");
});

it("opens the mobile navigation and closes the sheet after following a route", async () => {
  render(<MemoryRouter><NavigationHarness /></MemoryRouter>);
  expect(screen.queryByRole("navigation", { name: "Mobile navigation" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  const dialog = await screen.findByRole("dialog", { name: "TrafficOffOptimizer" });
  const mobileNavigation = within(dialog).getByRole("navigation", { name: "Mobile navigation" });
  expectOnlyActiveLink(mobileNavigation, "Dashboard");
  fireEvent.click(within(mobileNavigation).getByRole("link", { name: "Deployment Gantt" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByLabelText("Current route").textContent).toBe("/gantt-chart");

  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  const reopened = await screen.findByRole("navigation", { name: "Mobile navigation" });
  expectOnlyActiveLink(reopened, "Deployment Gantt");
});
