import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { OptimizationEngine } from "../app/pages/OptimizationEngine";
import * as backend from "../app/services/backend";

const auth = vi.hoisted(() => ({role: "administrator"}));
vi.mock("../app/contexts/AuthContext", () => ({useAuth: () => ({user: auth})}));
vi.mock("../app/components/PrettyCurve", () => ({default: () => <p>Search curve</p>}));
vi.mock("../app/services/backend", async original => ({
  ...await original<typeof import("../app/services/backend")>(),
  subscribeToDashboardStream: vi.fn(() => () => {}), fetchOptimizationStatus: vi.fn(), fetchOptimizationResults: vi.fn(), previewPublication: vi.fn(),
  publishDeploymentsFromOptimization: vi.fn(), exportRecommendation: vi.fn(),
}));

function savedResults(mode: "operational" | "shadow" = "operational"): backend.OptimizationResults {
  return {run_id: "saved-recommendation", status: "completed", parameters: {
    operational_date: "2099-01-05", shift: "afternoon", mode, session_id: "Lapaz comparison",
  }, top_solutions: [{reserve_officers: 4, staffing_shortages: {A: 1, B: 0}, assignments: [
    {officer_id: 7, badge_number: "TEST-7", bottleneck_id: "A", bottleneck_name: "Lapaz junction", start_time: "2099-01-05T14:00:00+08:00", end_time: "2099-01-05T15:00:00+08:00"},
    {officer_id: 7, badge_number: "TEST-7", bottleneck_id: "B", bottleneck_name: "Jaro junction", start_time: "2099-01-05T15:15:00+08:00", end_time: "2099-01-05T16:00:00+08:00"},
  ]}]};
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.role = "administrator";
  window.history.replaceState(null, "", "/optimization-engine?run_id=saved-recommendation");
  vi.mocked(backend.fetchOptimizationStatus).mockResolvedValue({run_id: "saved-recommendation", status: "completed", current_generation: 25, total_generations: 300, current_fitness: 90});
  vi.mocked(backend.fetchOptimizationResults).mockResolvedValue(savedResults());
  vi.mocked(backend.exportRecommendation).mockResolvedValue(undefined);
  vi.mocked(backend.previewPublication).mockResolvedValue({
    run_id: "saved-recommendation", operational_date: "2099-01-05", shift: "afternoon",
    start_time: "2099-01-05T14:00:00+08:00", end_time: "2099-01-05T22:00:00+08:00", created: 2,
    skipped: [], staff_added: [7], staff_removed: [], replaced: 0, conflicts: [], expected_revision: "reviewed",
    captured_at: "2099-01-05T13:58:00+08:00", input_issues: [], added_assignments: [], removed_assignments: [],
  });
});
afterEach(() => vi.unstubAllGlobals());

it("lets a supervisor review the saved run and export it from its context summary without publishing", async () => {
  render(<MemoryRouter><OptimizationEngine /></MemoryRouter>);
  const overview = within(screen.getByRole("region", {name: "Recommendation overview"}));
  await overview.findByText("2099-01-05");
  expect(overview.getByText("Afternoon · 2 PM–10 PM")).toBeTruthy();
  expect(overview.getByText("Lapaz comparison")).toBeTruthy();
  expect(overview.getByText("Assigned officers").parentElement?.textContent).toBe("Assigned officers1");
  expect(overview.getByText(/Staffing gaps: 1 location;/)).toBeTruthy();
  expect(screen.getAllByRole("button", {name: "Preview publication"})).toHaveLength(1);
  fireEvent.click(overview.getByRole("button", {name: "Preview publication"}));
  await screen.findByText("afternoon");
  expect(backend.previewPublication).toHaveBeenCalledExactlyOnceWith({run_id: "saved-recommendation", operational_date: "2099-01-05", replace_existing: true, input_override_reason: ""});
  expect(backend.publishDeploymentsFromOptimization).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name: "Cancel"}));
  fireEvent.click(overview.getByRole("button", {name: "Export recommendation"}));
  await waitFor(() => expect(backend.exportRecommendation).toHaveBeenCalledExactlyOnceWith("saved-recommendation"));
});

it("keeps shadow recommendations exportable and publication disabled in the top action area", async () => {
  vi.mocked(backend.fetchOptimizationResults).mockResolvedValue(savedResults("shadow"));
  render(<MemoryRouter><OptimizationEngine /></MemoryRouter>);
  const actions = within(await screen.findByRole("group", {name: "Recommendation actions"}));
  expect(actions.getByRole("button", {name: "Preview publication"})).toHaveProperty("disabled", true);
  fireEvent.click(actions.getByRole("button", {name: "Export recommendation"}));
  await waitFor(() => expect(backend.exportRecommendation).toHaveBeenCalledExactlyOnceWith("saved-recommendation"));
  expect(backend.previewPublication).not.toHaveBeenCalled();
  expect(backend.publishDeploymentsFromOptimization).not.toHaveBeenCalled();
});

it("shows a dispatcher the recommendation without supervisor actions or inaccessible optimization links", async () => {
  auth.role = "dispatcher";
  render(<MemoryRouter><OptimizationEngine /></MemoryRouter>);
  await screen.findByText("Lapaz junction");
  expect(screen.queryByRole("group", {name: "Recommendation actions"})).toBeNull();
  expect(screen.getByRole("link", {name: "Back to schedule"})).toHaveProperty("href", expect.stringContaining("/gantt-chart"));
  expect(screen.queryByRole("link", {name: "Start New Optimization"})).toBeNull();
});

it("does not offer publication when saved result details failed to load", async () => {
  vi.mocked(backend.fetchOptimizationResults).mockRejectedValue(new Error("Saved recommendation unavailable"));
  render(<MemoryRouter><OptimizationEngine /></MemoryRouter>);
  expect((await screen.findByRole("alert")).textContent).toContain("Saved recommendation unavailable");
  expect(screen.queryByRole("button", {name: "Preview publication"})).toBeNull();
});

it("refreshes persisted publication status after a confirmed publication receipt", async () => {
  const state: backend.RunPublicationState = {state: "unpublished", run_id: "saved-recommendation", publication_count: 0,
    revision_id: null, operational_date: "2099-01-05", shift: "afternoon", published_at: null, published_by: null,
    effective_start: null, effective_end: null, replacing_run_ids: [], manual_changes: false, message: "This run has not been published."};
  vi.mocked(backend.fetchOptimizationResults)
    .mockResolvedValueOnce({...savedResults(), publication_state: state})
    .mockResolvedValue({...savedResults(), publication_state: {...state, state: "published", publication_count: 1, revision_id: 17, message: "This run is published."}});
  const actual = await vi.importActual<typeof import("../app/services/backend")>("../app/services/backend");
  vi.mocked(backend.publishDeploymentsFromOptimization).mockImplementation(actual.publishDeploymentsFromOptimization);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({created: 2, shift: "afternoon"}), {status: 200, headers: {"Content-Type": "application/json"}})));
  render(<MemoryRouter><OptimizationEngine /></MemoryRouter>);
  const publication = within(screen.getByRole("region", {name: "Recommendation publication status"}));
  await publication.findByText("Unpublished");
  fireEvent.click(screen.getByRole("button", {name: "Preview publication"}));
  const confirm = await screen.findByRole("button", {name: "Confirm publication"});
  await waitFor(() => expect(confirm).toHaveProperty("disabled", false));
  fireEvent.click(confirm);
  await publication.findByText("Published");
  expect(backend.publishDeploymentsFromOptimization).toHaveBeenCalledTimes(1);
  expect(backend.fetchOptimizationStatus).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("link", {name: "Open published schedule"})).toHaveProperty("href", expect.stringContaining("date=2099-01-05&shift=afternoon"));
});
