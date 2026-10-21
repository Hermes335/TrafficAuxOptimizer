import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { Layout } from "../app/components/Layout";

vi.mock("../app/contexts/AuthContext", () => ({ useAuth: () => ({ user: { role: "administrator" } }) }));
vi.mock("../app/contexts/WeatherContext", () => ({ WeatherProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("../app/components/Header", () => ({
  Header: ({ onOpenNavigation }: { onOpenNavigation: () => void }) => <button aria-label="Open navigation" onClick={onOpenNavigation}>Navigation</button>,
}));
afterEach(() => vi.unstubAllGlobals());

it("closes the mobile drawer when desktop navigation appears and restores page interaction", async () => {
  let width = 390;
  const queries: { matches: boolean; update: () => void }[] = [];
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("matchMedia", (query: string) => {
    const matches = () => width >= Number(query.match(/\d+/)?.[0] ?? 0);
    const listeners = new Set<() => void>();
    const media = {
      matches: matches(), media: query, onchange: null,
      addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
      update: () => {
        if (media.matches === matches()) return;
        media.matches = matches();
        listeners.forEach(listener => listener());
      },
    };
    queries.push(media);
    return media;
  });
  const resize = (nextWidth: number) => act(() => {
    width = nextWidth;
    queries.forEach(query => query.update());
  });

  render(<MemoryRouter><Layout /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  expect(await screen.findByRole("dialog", { name: "TrafficOffOptimizer" })).toBeTruthy();
  expect(document.body.style.pointerEvents).toBe("none");

  resize(640);
  expect(screen.getByRole("dialog")).toBeTruthy();
  resize(768);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.body.style.pointerEvents).toBe("");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Dashboard");

  resize(390);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
});

it("uses labeled desktop navigation by default, adapts before a choice, then preserves the user's choice", () => {
  let width = 1440;
  const updates = new Set<() => void>();
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("matchMedia", (query: string) => {
    const listeners = new Set<() => void>();
    const media = {
      matches: width >= Number(query.match(/\d+/)?.[0] ?? 0), media: query, onchange: null,
      addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    };
    updates.add(() => {
      const matches = width >= Number(query.match(/\d+/)?.[0] ?? 0);
      if (matches === media.matches) return;
      media.matches = matches;
      listeners.forEach(listener => listener());
    });
    return media;
  });
  const resize = (next: number) => act(() => { width = next; updates.forEach(update => update()); });

  render(<MemoryRouter><Layout /></MemoryRouter>);
  expect(screen.getByRole("button", { name: "Collapse navigation" })).toBeTruthy();
  resize(1024);
  expect(screen.getByRole("button", { name: "Expand navigation" })).toBeTruthy();
  resize(1440);
  expect(screen.getByRole("button", { name: "Collapse navigation" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
  resize(1600);
  resize(1024);
  resize(1440);
  expect(screen.getByRole("button", { name: "Expand navigation" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
  resize(390);
  resize(1024);
  expect(screen.getByRole("button", { name: "Collapse navigation" })).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "Skip to main content" }));
  expect(document.activeElement?.id).toBe("main-content");
});
