import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
// jsdom has no layout observer; keyboard focus can open Radix tooltips that use it.
beforeEach(() => vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
}));
afterEach(cleanup);

