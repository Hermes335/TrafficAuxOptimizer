import { lazy, Suspense, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, Outlet, Route, Routes } from "react-router";
import { expect, it, vi } from "vitest";
import { RouteAccessibility } from "../app/components/RouteAccessibility";
import { Sidebar } from "../app/components/Sidebar";

vi.mock("../app/contexts/AuthContext", () => ({ useAuth: () => ({ user: { role: "administrator" } }) }));

function Shell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return <>
    <button aria-label="Open navigation" onClick={() => setMobileOpen(true)}>Open navigation</button>
    <Sidebar collapsed={false} setCollapsed={() => {}} mobileOpen={mobileOpen} onMobileOpenChange={setMobileOpen} />
    <main id="main-content"><Outlet /></main>
  </>;
}

function Page({ title, autoFocus = false }: { title: string; autoFocus?: boolean }) {
  return <><h1>{title}</h1><input aria-label="Page search" autoFocus={autoFocus} /><Link to="?shift=afternoon">Change shift</Link></>;
}

it("sets each route's title and focuses its heading only after client navigation", async () => {
  render(<MemoryRouter><Routes><Route element={<RouteAccessibility />}><Route element={<Shell />}>
    <Route index element={<Page title="Live operations" />} />
    <Route path="settings" element={<Page title="System health" />} />
  </Route></Route></Routes></MemoryRouter>);
  expect(document.title).toBe("Live operations | TrafficOffOptimizer");
  expect(document.activeElement).not.toBe(screen.getByRole("heading", { name: "Live operations" }));
  fireEvent.click(screen.getByRole("link", { name: "System health" }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "System health" })));
  expect(document.title).toBe("System health | TrafficOffOptimizer");

  const changeShift = screen.getByRole("link", { name: "Change shift" });
  changeShift.focus();
  fireEvent.click(changeShift);
  await act(() => new Promise(resolve => setTimeout(resolve, 10)));
  expect(document.activeElement).toBe(changeShift);
});

it("waits for a lazy destination and preserves destination form autofocus", async () => {
  let resolvePage!: (page: { default: () => React.ReactElement }) => void;
  const LazyPage = lazy(() => new Promise<{ default: () => React.ReactElement }>(resolve => { resolvePage = resolve; }));
  render(<MemoryRouter><Routes><Route element={<RouteAccessibility />}><Route element={<Shell />}>
    <Route index element={<Page title="Live operations" />} />
    <Route path="settings" element={<Suspense fallback={<p>Loading page…</p>}><LazyPage /></Suspense>} />
  </Route></Route></Routes></MemoryRouter>);
  fireEvent.click(screen.getByRole("link", { name: "System health" }));
  expect(screen.getByText("Loading page…")).toBeTruthy();
  await act(async () => resolvePage({ default: () => <Page title="System health" autoFocus /> }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Page search" })));
  await act(() => new Promise(resolve => setTimeout(resolve, 10)));
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Page search" }));
});

it("focuses the new heading once a lazy destination finishes loading", async () => {
  let resolvePage!: (page: { default: () => React.ReactElement }) => void;
  const LazyPage = lazy(() => new Promise<{ default: () => React.ReactElement }>(resolve => { resolvePage = resolve; }));
  render(<MemoryRouter><Routes><Route element={<RouteAccessibility />}><Route element={<Shell />}>
    <Route index element={<Page title="Live operations" />} />
    <Route path="settings" element={<Suspense fallback={<p>Loading page…</p>}><LazyPage /></Suspense>} />
  </Route></Route></Routes></MemoryRouter>);
  fireEvent.click(screen.getByRole("link", { name: "System health" }));
  expect(screen.queryByRole("heading", { name: "System health" })).toBeNull();
  await act(async () => resolvePage({ default: () => <Page title="System health" /> }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "System health" })));
});

it("moves mobile navigation focus into the destination but restores the opener when dismissed", async () => {
  render(<MemoryRouter><Routes><Route element={<RouteAccessibility />}><Route element={<Shell />}>
    <Route index element={<Page title="Live operations" />} />
    <Route path="settings" element={<Page title="System health" />} />
  </Route></Route></Routes></MemoryRouter>);
  const opener = screen.getByRole("button", { name: "Open navigation" });
  vi.spyOn(opener, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  fireEvent.click(opener);
  const sheet = await screen.findByRole("dialog");
  fireEvent.click(within(sheet).getByRole("link", { name: "System health" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "System health" })));

  fireEvent.click(opener);
  const reopened = await screen.findByRole("dialog");
  fireEvent.keyDown(reopened, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(opener);

  // Following the currently selected link should also land in the page.
  fireEvent.click(opener);
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("link", { name: "System health" }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "System health" })));
});
