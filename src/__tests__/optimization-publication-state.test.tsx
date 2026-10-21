import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useNavigate } from "react-router";
import { OptimizationEngine } from "../app/pages/OptimizationEngine";
import { PageStateProvider } from "../app/contexts/PageStateContext";
import * as backend from "../app/services/backend";

vi.mock("../app/contexts/AuthContext", () => ({useAuth: () => ({user: {role: "dispatcher"}})}));
vi.mock("../app/components/PrettyCurve", () => ({default: ({generations, values}: {generations: number[]; values: number[]}) => <output aria-label="Recorded chart data">{JSON.stringify({generations, values})}</output>}));
vi.mock("../app/services/backend", async original => ({...await original<typeof import("../app/services/backend")>(),
  fetchOptimizationStatus: vi.fn(), fetchOptimizationResults: vi.fn(), subscribeToDashboardStream: vi.fn(() => () => {}),
}));

const savedPublication = (state: backend.RunPublicationState["state"]): backend.RunPublicationState => ({
  state, run_id: "saved-A", publication_count: state === "unpublished" ? 0 : 1,
  revision_id: state === "unpublished" ? null : 17, operational_date: "2099-01-05", shift: "afternoon",
  published_at: "2099-01-05T14:00:00+08:00", published_by: "Supervisor One",
  effective_start: "2099-01-05T14:00:00+08:00", effective_end: "2099-01-05T22:00:00+08:00",
  replacing_run_ids: state === "replaced" || state === "partially_replaced" ? ["saved-B"] : [],
  manual_changes: state === "modified", message: `Server-confirmed ${state} state.`,
});
const results = (publication_state?: backend.RunPublicationState): backend.OptimizationResults => ({
  run_id: "saved-A", status: "completed", publication_state,
  parameters: {operational_date: "2099-01-05", shift: "afternoon", mode: "operational"},
  fitness_scores: Array.from({length: 300}, (_, index) => 89 + index / 1000),
  top_solutions: [{fitness: 92.3, assignments: [{officer_id: 1, bottleneck_id: "A", bottleneck_name: "Saved junction"}]}],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => {resolve = yes;});
  return {promise, resolve};
}
const publicationRegion = () => within(screen.getByRole("region", {name: "Recommendation publication status"}));
function openDetails(open = true) {
  const details = screen.getByText("Advanced charts and scoring").closest("details")!;
  details.open = open;
  fireEvent(details, new Event("toggle"));
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({width: 700, height: 300, x: 0, y: 0, left: 0, top: 0, right: 700, bottom: 300, toJSON: () => ({})});
  window.history.replaceState(null, "", "/optimization-engine?run_id=saved-A");
  vi.mocked(backend.fetchOptimizationStatus).mockResolvedValue({run_id: "saved-A", status: "completed", current_generation: 300, total_generations: 300, current_fitness: 92.3});
  vi.mocked(backend.fetchOptimizationResults).mockResolvedValue(results());
});
afterEach(() => {vi.restoreAllMocks(); vi.useRealTimers();});

it.each([
  ["unpublished", "Unpublished"], ["published", "Published"], ["modified", "Published · Modified"],
  ["partially_replaced", "Partially replaced"], ["replaced", "Replaced"],
] as const)("shows persisted %s provenance independently of completed execution", async (state, label) => {
  vi.mocked(backend.fetchOptimizationResults).mockResolvedValue(results(savedPublication(state)));
  const page = render(<MemoryRouter><OptimizationEngine /></MemoryRouter>);
  await publicationRegion().findByText(label);
  expect(screen.getByText("Completed")).toBeTruthy();
  if (state !== "unpublished") expect(publicationRegion().getByRole("link", {name: "Open schedule for this publication"})).toHaveProperty("href", expect.stringContaining("/gantt-chart?date=2099-01-05&shift=afternoon"));
  if (state === "modified") expect(publicationRegion().getByText(/has manual changes/)).toBeTruthy();
  if (state.includes("replaced")) expect(publicationRegion().getByRole("link", {name: "View replacing run saved-B"})).toHaveProperty("href", expect.stringContaining("run_id=saved-B"));
  page.unmount();
  render(<MemoryRouter><OptimizationEngine /></MemoryRouter>);
  await publicationRegion().findByText(label);
  expect(backend.fetchOptimizationResults).toHaveBeenCalledTimes(2);
});

it("never treats missing publication metadata as an unpublished recommendation", async () => {
  render(<MemoryRouter><OptimizationEngine /></MemoryRouter>);
  await screen.findByText("Saved junction");
  expect(publicationRegion().getByText("Publication status unavailable")).toBeTruthy();
  expect(publicationRegion().queryByText("Unpublished")).toBeNull();
});

it("serializes refresh requests after a publication event and ignores terminal score changes", async () => {
  const pending = deferred<backend.OptimizationResults>();
  vi.mocked(backend.fetchOptimizationResults)
    .mockResolvedValueOnce(results(savedPublication("unpublished")))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue(results(savedPublication("replaced")));
  render(<MemoryRouter><OptimizationEngine /></MemoryRouter>);
  await publicationRegion().findByText("Unpublished");
  act(() => window.dispatchEvent(new Event("deployment-publication-changed")));
  await waitFor(() => expect(backend.fetchOptimizationResults).toHaveBeenCalledTimes(2));
  act(() => window.dispatchEvent(new Event("deployment-publication-changed")));
  expect(backend.fetchOptimizationResults).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(results(savedPublication("published"))));
  await publicationRegion().findByText("Replaced");
  expect(backend.fetchOptimizationStatus).toHaveBeenCalledTimes(1);
  expect(screen.getByText("100%")).toBeTruthy();
});

it("keeps the saved plan available after a failed provenance refresh and recovers on retry", async () => {
  vi.mocked(backend.fetchOptimizationResults)
    .mockResolvedValueOnce(results(savedPublication("published")))
    .mockRejectedValueOnce(new Error("Temporary service failure"))
    .mockResolvedValue(results(savedPublication("modified")));
  render(<MemoryRouter><OptimizationEngine /></MemoryRouter>);
  await publicationRegion().findByText("Published");
  fireEvent.click(publicationRegion().getByRole("button", {name: "Refresh publication status"}));
  await publicationRegion().findByText("Publication status unavailable");
  expect(screen.getByText("Saved junction")).toBeTruthy();
  expect(publicationRegion().queryByText("Published")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("Temporary service failure");
  fireEvent.click(publicationRegion().getByRole("button", {name: "Refresh publication status"}));
  await publicationRegion().findByText("Published · Modified");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("refreshes provenance from deployment events and a periodic fallback without restarting completed execution", async () => {
  vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
  let receive!: Parameters<typeof backend.subscribeToDashboardStream>[0];
  vi.mocked(backend.subscribeToDashboardStream).mockImplementation(callback => {receive = callback; return () => {};});
  vi.mocked(backend.fetchOptimizationResults).mockResolvedValue(results(savedPublication("published")));
  render(<MemoryRouter><OptimizationEngine /></MemoryRouter>);
  await act(async () => {});
  await act(async () => receive({event: "deployment_changed"}));
  expect(backend.fetchOptimizationResults).toHaveBeenCalledTimes(2);
  await act(async () => {vi.advanceTimersByTime(60000);});
  expect(backend.fetchOptimizationResults).toHaveBeenCalledTimes(3);
  expect(backend.fetchOptimizationStatus).toHaveBeenCalledTimes(1);
});

it("mounts charts on expansion with their real generation numbers, unmounts on close and remembers reopening this run", async () => {
  function Harness() {
    const navigate = useNavigate();
    return <><button onClick={() => navigate("/optimization-engine?run_id=saved-B")}>Other run</button><button onClick={() => navigate("/optimization-engine?run_id=saved-A")}>Original run</button><OptimizationEngine /></>;
  }
  render(<MemoryRouter initialEntries={["/optimization-engine?run_id=saved-A"]}><PageStateProvider><Harness /></PageStateProvider></MemoryRouter>);
  await screen.findByText("Saved junction");
  expect(screen.queryByLabelText("Recorded chart data")).toBeNull();
  openDetails();
  const chart = JSON.parse(screen.getByLabelText("Recorded chart data").textContent!);
  expect(chart.generations).toEqual(Array.from({length: 200}, (_, index) => index + 101));
  expect(chart.values).toEqual(results().fitness_scores!.slice(-200));
  openDetails(false);
  expect(screen.queryByLabelText("Recorded chart data")).toBeNull();
  openDetails();
  fireEvent.click(screen.getByText("Other run"));
  await waitFor(() => expect(backend.fetchOptimizationResults).toHaveBeenCalledWith("saved-B"));
  expect(screen.queryByLabelText("Recorded chart data")).toBeNull();
  fireEvent.click(screen.getByText("Original run"));
  await screen.findByLabelText("Recorded chart data");
});

it("waits until an expanded chart has real dimensions before mounting it", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({width: 0, height: 0, x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, toJSON: () => ({})});
  render(<MemoryRouter><OptimizationEngine /></MemoryRouter>);
  await screen.findByText("Saved junction");
  openDetails();
  expect(screen.queryByLabelText("Recorded chart data")).toBeNull();
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({width: 350, height: 240, x: 0, y: 0, left: 0, top: 0, right: 350, bottom: 240, toJSON: () => ({})});
  fireEvent(window, new Event("resize"));
  expect(screen.getByLabelText("Recorded chart data")).toBeTruthy();
});
