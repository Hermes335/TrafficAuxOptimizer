import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router";
import { Optimization } from "../app/pages/Optimization";
import { PageStateProvider } from "../app/contexts/PageStateContext";
import * as backend from "../app/services/backend";

vi.mock("../app/services/backend", async original => ({
  ...await original<typeof import("../app/services/backend")>(),
  subscribeToDashboardStream: vi.fn(() => () => {}), fetchOptimizationConfig: vi.fn(), fetchOptimizationReadiness: vi.fn(), fetchOptimizationHistory: vi.fn(),
  fetchDashboardSnapshot: vi.fn(), fetchCurrentWeather: vi.fn(), fetchPOIs: vi.fn(),
}));

function readiness(request: backend.OptimizationRunRequest, changes: Partial<backend.OptimizationReadiness> = {}): backend.OptimizationReadiness {
  return {
    ready: true, checked_at: "2026-10-21T00:00:00+08:00", mode: request.mode ?? "operational",
    shift: request.shift === "afternoon" ? "afternoon" : "morning", operational_date: request.operational_date!,
    planning_start: `${request.operational_date}T06:00:00+08:00`, planning_end: `${request.operational_date}T14:00:00+08:00`,
    blockers: [], warnings: [], summary: {active_locations: 2, eligible_officers: 5, missing_officer_locations: 1, peak_required_officers: 4, max_staffing_shortage: 0},
    periods: [{start_time: `${request.operational_date}T06:00:00+08:00`, end_time: `${request.operational_date}T14:00:00+08:00`, required_officers: 4, available_officers: 5, shortage: 0}],
    traffic: [{bottleneck_id: "A", name: "School junction", observed_at: "2026-10-20T20:00:00+08:00", age_seconds: 14400, data_status: "live", is_stale: true, is_synthetic: false}],
    weather: {observed_at: "2026-10-20T23:58:00+08:00", age_seconds: 120, data_status: "live", is_stale: false, is_synthetic: false},
    ...changes,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function RouteLocation() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname + location.search}</output>;
}
function renderPage() {
  return render(<MemoryRouter initialEntries={["/optimization?shift=morning"]}><PageStateProvider><Optimization /><RouteLocation /></PageStateProvider></MemoryRouter>);
}
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/optimization?shift=morning");
  vi.mocked(backend.fetchOptimizationConfig).mockImplementation(async parameters => ({parameters, valid: true}));
  vi.mocked(backend.fetchOptimizationReadiness).mockImplementation(async request => readiness(request));
  vi.mocked(backend.fetchOptimizationHistory).mockResolvedValue({results: [], count: 0, next: null});
  vi.mocked(backend.fetchDashboardSnapshot).mockResolvedValue(backend.getFallbackDashboardSnapshot());
  vi.mocked(backend.fetchCurrentWeather).mockResolvedValue({} as backend.WeatherCurrentSnapshot);
  vi.mocked(backend.fetchPOIs).mockResolvedValue([]);
});

it("waits for readiness, shows advisory freshness without blocking, and preserves run parameter keys", async () => {
  vi.mocked(backend.fetchOptimizationReadiness).mockImplementation(async request => readiness(request, {warnings: ["Traffic inputs are stale; review freshness before publication."]}));
  renderPage();
  expect(screen.getByRole("button", {name: "Run Optimization"})).toHaveProperty("disabled", true);
  await screen.findByText("Ready to generate a recommendation.");
  expect(screen.getByRole("button", {name: "Run Optimization"})).toHaveProperty("disabled", false);
  const summary = screen.getByRole("region", {name: "Run readiness"});
  expect(within(summary).getByText(/Traffic inputs are stale/)).toBeTruthy();
  expect(within(summary).getByText("Eligible officers").parentElement?.textContent).toBe("Eligible officers5");
  expect(within(summary).queryByText("Assumed HQ origins")).toBeNull();
  expect(within(summary).getByText("School junction").parentElement?.textContent).toContain("stale");
  expect(screen.getByLabelText("Coverage weight")).toHaveProperty("value", "35");
  expect(screen.getByLabelText("Estimated travel weight")).toHaveProperty("value", "25");
  expect(screen.getByLabelText("Staffing efficiency weight")).toHaveProperty("value", "15");
  expect(backend.fetchOptimizationReadiness).toHaveBeenCalledWith(expect.objectContaining({
    shift: "morning", mode: "operational", tsi_weight: 0.35, wif_weight: 0.25, rpw_weight: 0.25, resource_utilization_weight: 0.15,
  }));
  fireEvent.click(screen.getByRole("button", {name: "Run Optimization"}));
  expect(screen.getByLabelText("Current route").textContent).toContain("/optimization-running?");
  expect(screen.getByLabelText("Current route").textContent).toContain("tsi_weight=0.35");
});

it.each([0, 3])("shows %i assumed HQ origins only when reported by readiness", async assumed => {
  vi.mocked(backend.fetchOptimizationReadiness).mockImplementation(async request => {
    const value = readiness(request);
    return {...value, summary: {...value.summary, missing_officer_locations: 0, assumed_hq_origins: assumed}};
  });
  renderPage();
  await screen.findByText("Ready to generate a recommendation.");
  const summary = within(screen.getByRole("region", {name: "Run readiness"}));
  expect(summary.getByText("Assumed HQ origins").parentElement?.textContent).toBe(`Assumed HQ origins${assumed}`);
  expect(summary.getByText("Missing recorded locations").parentElement?.textContent).toBe("Missing recorded locations0");
  if (assumed > 0) expect(summary.getByText(/planning assumptions, not confirmed GPS positions/)).toBeTruthy();
  else expect(summary.queryByText(/planning assumptions, not confirmed GPS positions/)).toBeNull();
});

it("shows the restored missing-location distance estimate without an HQ starting point", async () => {
  vi.mocked(backend.fetchOptimizationReadiness).mockImplementation(async request => {
    const value = readiness(request);
    return {...value, summary: {...value.summary, missing_officer_locations: 3, assumed_distance_origins: 3},
      warnings: ["3 eligible officers have no recorded starting location. Travel estimates use an assumed 3 km distance for each trip."]};
  });
  renderPage();
  await screen.findByText("Ready to generate a recommendation.");
  const summary = within(screen.getByRole("region", {name: "Run readiness"}));
  expect(summary.getByText("Officers using 3 km estimate").parentElement?.textContent).toBe("Officers using 3 km estimate3");
  expect(summary.queryByText("Assumed HQ origins")).toBeNull();
  expect(summary.getByText(/Travel estimates use an assumed 3 km/)).toBeTruthy();
});

it("identifies saved runs by planning context and does not compare unrelated run scores", async () => {
  const savedRun = (id: number, parameters: Record<string, unknown>, fitness: number): backend.OptimizationHistoryItem => ({
    id, run_id: `saved-${id}`, timestamp: "2026-10-21T00:00:00+08:00", parameters,
    fitness_scores: [fitness], result_data: {best_fitness: fitness}, status: "completed", created_by: 1, generations_completed: 1,
  });
  vi.mocked(backend.fetchOptimizationHistory).mockResolvedValue({count: 2, next: null, results: [
    savedRun(1, {operational_date: "2099-01-05", shift: "afternoon", mode: "shadow", session_id: "Lapaz field comparison"}, 92),
    savedRun(2, {operational_date: "2099-01-04", shift: "morning", mode: "operational"}, 89),
  ]});
  renderPage();
  const history = within(await screen.findByRole("list", {name: "Optimization run history"}));
  expect(history.getByText("2099-01-05 · Afternoon")).toBeTruthy();
  expect(history.getByText("Shadow comparison · Lapaz field comparison")).toBeTruthy();
  expect(history.getByText("2099-01-04 · Morning")).toBeTruthy();
  expect(history.getByText("Operational deployment")).toBeTruthy();
  expect(history.queryByTitle("Change from the previous run on this page")).toBeNull();
  fireEvent.click(history.getByRole("link", {name: "View run saved-1"}));
  expect(screen.getByLabelText("Current route").textContent).toBe("/optimization-engine?run_id=saved-1");
});

it("refreshes persisted publication badges in history and preserves readable history when refreshing fails", async () => {
  const state = (value: backend.RunPublicationState["state"]): backend.RunPublicationState => ({
    state: value, run_id: "saved-publication", publication_count: value === "unpublished" ? 0 : 1,
    revision_id: 17, operational_date: "2099-01-05", shift: "afternoon", published_at: null,
    published_by: null, effective_start: null, effective_end: null, replacing_run_ids: [], manual_changes: false, message: value,
  });
  const row: backend.OptimizationHistoryItem = {id: 17, run_id: "saved-publication", timestamp: "2099-01-05T14:00:00+08:00",
    parameters: {operational_date: "2099-01-05", shift: "afternoon", mode: "operational"}, fitness_scores: [], result_data: {}, status: "completed", created_by: 1};
  vi.mocked(backend.fetchOptimizationHistory)
    .mockResolvedValueOnce({count: 1, next: null, results: [{...row, publication_state: state("unpublished")} ]})
    .mockResolvedValueOnce({count: 1, next: null, results: [{...row, publication_state: state("published")} ]})
    .mockRejectedValueOnce(new Error("History service unavailable"))
    .mockResolvedValue({count: 1, next: null, results: [{...row, publication_state: state("replaced")} ]});
  renderPage();
  const history = within(await screen.findByRole("list", {name: "Optimization run history"}));
  await history.findByText("Unpublished");
  act(() => window.dispatchEvent(new Event("deployment-publication-changed")));
  await history.findByText("Published");
  act(() => window.dispatchEvent(new Event("deployment-publication-changed")));
  await history.findByText("Publication status unavailable");
  expect(history.getByRole("link", {name: "View run saved-publication"})).toBeTruthy();
  expect(history.queryByText("Published")).toBeNull();
  fireEvent.click(screen.getByRole("button", {name: "Retry history refresh"}));
  await history.findByText("Replaced");
  expect(screen.queryByText(/Run history could not be refreshed/)).toBeNull();
});

it("blocks impossible runs and refreshes readiness before allowing another start", async () => {
  vi.mocked(backend.fetchOptimizationReadiness).mockImplementationOnce(async request => readiness(request, {ready: false, blockers: ["No eligible officers for required staffing."]}));
  renderPage();
  await screen.findByText("No eligible officers for required staffing.");
  expect(screen.getByRole("button", {name: "Run Optimization"})).toHaveProperty("disabled", true);
  const refresh = deferred<backend.OptimizationReadiness>();
  vi.mocked(backend.fetchOptimizationReadiness).mockReturnValueOnce(refresh.promise);
  fireEvent.click(screen.getByRole("button", {name: "Refresh run readiness"}));
  expect(screen.queryByText("No eligible officers for required staffing.")).toBeNull();
  expect(screen.getByRole("button", {name: "Run Optimization"})).toHaveProperty("disabled", true);
  await waitFor(() => expect(backend.fetchOptimizationReadiness).toHaveBeenCalledTimes(2));
  await act(async () => refresh.resolve(readiness(vi.mocked(backend.fetchOptimizationReadiness).mock.calls[1][0])));
  expect(screen.getByRole("button", {name: "Run Optimization"})).toHaveProperty("disabled", false);
});

it("ignores a stale response after date, shift and mode change", async () => {
  const old = deferred<backend.OptimizationReadiness>(), latest = deferred<backend.OptimizationReadiness>();
  vi.mocked(backend.fetchOptimizationReadiness).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  renderPage();
  await waitFor(() => expect(backend.fetchOptimizationReadiness).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("Operational date (Asia/Manila)"), {target: {value: "2099-01-05"}});
  fireEvent.click(screen.getByRole("button", {name: /Afternoon/}));
  fireEvent.change(screen.getByLabelText("Recommendation mode"), {target: {value: "shadow"}});
  fireEvent.change(screen.getByLabelText("Field session (required)"), {target: {value: "New comparison"}});
  expect(screen.getByRole("button", {name: "Run Optimization"})).toHaveProperty("disabled", true);
  await waitFor(() => expect(backend.fetchOptimizationReadiness).toHaveBeenCalledTimes(2));
  const latestRequest = vi.mocked(backend.fetchOptimizationReadiness).mock.calls[1][0];
  expect(latestRequest).toMatchObject({operational_date: "2099-01-05", shift: "afternoon", mode: "shadow", session_id: "New comparison"});
  await act(async () => latest.resolve(readiness(latestRequest)));
  await act(async () => old.resolve(readiness(vi.mocked(backend.fetchOptimizationReadiness).mock.calls[0][0], {ready: false, blockers: ["Obsolete blocker"]})));
  expect(screen.queryByText("Obsolete blocker")).toBeNull();
  expect(screen.getByRole("button", {name: "Run Optimization"})).toHaveProperty("disabled", false);
});

it("hides prior readiness immediately while new parameters are checked, and recovers from a failed refresh", async () => {
  renderPage();
  await screen.findByText("Ready to generate a recommendation.");
  vi.mocked(backend.fetchOptimizationReadiness).mockRejectedValueOnce(new Error("Readiness service unavailable"));
  fireEvent.change(screen.getByLabelText("Operational date (Asia/Manila)"), {target: {value: "2099-01-06"}});
  expect(screen.queryByText("Ready to generate a recommendation.")).toBeNull();
  expect(screen.getByRole("button", {name: "Run Optimization"})).toHaveProperty("disabled", true);
  await screen.findByText("Readiness service unavailable");
  fireEvent.click(screen.getByRole("button", {name: "Refresh run readiness"}));
  await screen.findByText("Ready to generate a recommendation.");
  expect(screen.getByRole("button", {name: "Run Optimization"})).toHaveProperty("disabled", false);
});

it("rejects a readiness response for a different selected shift", async () => {
  vi.mocked(backend.fetchOptimizationReadiness).mockImplementation(async request => readiness(request, {shift: "afternoon"}));
  renderPage();
  await screen.findByText(/Readiness did not match the selected date/);
  expect(screen.getByRole("button", {name: "Run Optimization"})).toHaveProperty("disabled", true);
});
