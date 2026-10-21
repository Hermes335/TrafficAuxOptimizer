import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { OptimizationEngine } from "../app/pages/OptimizationEngine";
import { computeAutoWeights } from "../app/hooks/useOptimizationConfig";
import * as backend from "../app/services/backend";

vi.mock("../app/components/PrettyCurve", () => ({ default: ({values, generations}: {values: number[]; generations: number[]}) => <><output aria-label="Search generation scores">{JSON.stringify(values)}</output><output aria-label="Search generation numbers">{JSON.stringify(generations)}</output></> }));
vi.mock("../app/components/OptimizationDetailsSection", async original => ({...await original<typeof import("../app/components/OptimizationDetailsSection")>(), MeasuredResultChart: ({children}: {children: React.ReactNode}) => <>{children}</>}));
vi.mock("../app/contexts/AuthContext", () => ({useAuth: () => ({user: {role: "dispatcher"}})}));
vi.mock("../app/services/backend", () => ({
  fetchOptimizationStatus: vi.fn(), fetchOptimizationResults: vi.fn(), subscribeToDashboardStream: vi.fn(() => () => {}),
}));

function renderEngine(strict = false) {
  const page = <MemoryRouter><OptimizationEngine /></MemoryRouter>;
  render(strict ? <StrictMode>{page}</StrictMode> : page);
  const details = screen.getByText("Advanced charts and scoring").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/optimization-engine?run_id=staffing-test");
  vi.mocked(backend.fetchOptimizationStatus).mockResolvedValue({run_id:"staffing-test", status:"completed",
    current_generation:22, total_generations:300, current_fitness:96});
});
afterEach(() => vi.useRealTimers());

it("shows the staffing target and reserves alongside actual roster utilization", async () => {
  vi.mocked(backend.fetchOptimizationResults).mockResolvedValue({run_id:"staffing-test", status:"completed",
    top_solutions:[{staffing_targets:{QUIET:2}, reserve_officers:6, staffing_efficiency:100,
      resource_utilization:25, staffing_shortages:{}, assignments:[
        {officer_id:1, bottleneck_id:"QUIET", bottleneck_name:"Quiet junction"},
        {officer_id:2, bottleneck_id:"QUIET", bottleneck_name:"Quiet junction"},
      ]}]});
  renderEngine();
  expect(await screen.findByText("Staffing target: 2 officers")).toBeTruthy();
  expect(screen.getByText("Officers in reserve: 6")).toBeTruthy();
  expect(screen.getByText("Staffing efficiency: 100.0%")).toBeTruthy();
  expect(screen.getByText("Roster utilization: 25.0%")).toBeTruthy();
});

it("keeps historical results readable without inventing a staffing target or reserve count", async () => {
  vi.mocked(backend.fetchOptimizationResults).mockResolvedValue({run_id:"staffing-test", status:"completed",
    top_solutions:[{resource_utilization:100, assignments:[
      {officer_id:1, bottleneck_id:"LEGACY", bottleneck_name:"Historical junction"},
    ]}]});
  renderEngine();
  await screen.findByText("Historical junction");
  expect(screen.queryByText(/Staffing target:/)).toBeNull();
  expect(screen.queryByText(/Officers in reserve:/)).toBeNull();
  expect(screen.getByText("Skills were not assessed for this saved assignment.")).toBeTruthy();
  expect(screen.getByText(/Score breakdown unavailable for this saved run/)).toBeTruthy();
  expect(screen.queryByRole("region", {name: "Saved planning window"})).toBeNull();
  expect(screen.getByText(/Starting-location assumptions were not recorded for this run/)).toBeTruthy();
  expect(screen.queryByText(/TTMO HQ|assumed 3 km/)).toBeNull();
});

it.each([
  ["hq_for_initial_deployment", /At the start of each operational day, this run assumes officers start at TTMO HQ \(10\.689327, 122\.581486\)\. Same-day recorded previous posts take priority for later moves/],
  ["known_coordinates_then_hq", /same-day recorded posts or saved officer coordinates recorded that day, then assumes TTMO HQ \(10\.689327, 122\.581486\) when neither is available\. Coordinates from previous days are not carried forward/],
] as const)("explains the saved %s HQ assumption without implying GPS tracking", async (policy, explanation) => {
  vi.mocked(backend.fetchOptimizationResults).mockResolvedValue({run_id: "staffing-test", status: "completed",
    top_solutions: [{avg_response_time: 7.25, assignments: []}],
    input_snapshot: {
      captured_at: "2099-01-01T06:00:00+08:00", bottlenecks: [],
      weather: {source: "live", data_status: "live", is_stale: false, is_synthetic: false},
      travel_time_model: {initial_location_policy: policy, origin_reset: "daily",
        default_origin: {name: "TTMO HQ", latitude: 10.689327, longitude: 122.581486, assumed: true}},
    },
  });
  renderEngine();
  const description = await screen.findByText(explanation);
  expect(description.textContent).toContain("not live GPS tracking");
  expect(screen.getByText("Estimated travel: 7.3 min")).toBeTruthy();
  expect(description.textContent).not.toContain("assumed 3 km");
});

it("retains the recorded legacy distance assumption instead of applying today's HQ default", async () => {
  vi.mocked(backend.fetchOptimizationResults).mockResolvedValue({run_id: "staffing-test", status: "completed",
    top_solutions: [{assignments: []}],
    input_snapshot: {
      captured_at: "2026-09-25T06:00:00+08:00", bottlenecks: [],
      weather: {source: "live", data_status: "live", is_stale: false, is_synthetic: false},
      travel_time_model: {missing_officer_location_distance_km: 3},
    },
  });
  renderEngine();
  const description = await screen.findByText(/This saved run assumed 3 km when officer coordinates were missing/);
  expect(description.textContent).toContain("not live GPS tracking");
  expect(description.textContent).not.toContain("TTMO HQ");
});

it("uses saved skill explanations and distinguishes unmatched from locations without a preference", async () => {
  const match = {policy_version: "skills-v1", preferred_skills: ["school_crossing"], matched_skills: ["school_crossing"], status: "matched" as const, explanation: "Saved school crossing match."};
  vi.mocked(backend.fetchOptimizationResults).mockResolvedValue({run_id: "staffing-test", status: "completed",
    top_solutions: [{assignments: [
      {officer_id: 1, badge_number: "ALPHA", bottleneck_id: "A", bottleneck_name: "School", skill_match: match},
      {officer_id: 2, badge_number: "BETA", bottleneck_id: "A", bottleneck_name: "School", skill_match: {...match, matched_skills: [], status: "no_recorded_match", explanation: "Saved assignment satisfies staffing; no recorded preference match."}},
      {officer_id: 3, badge_number: "GAMMA", bottleneck_id: "B", bottleneck_name: "Road", skill_match: {...match, preferred_skills: [], matched_skills: [], status: "not_applicable", explanation: "Saved location has no specific preference."}},
    ]}],
  });
  renderEngine();
  await screen.findByText("Recorded skill match: School crossing.");
  expect(screen.getByText("Saved school crossing match.")).toBeTruthy();
  expect(screen.getByText("No recorded skill match.")).toBeTruthy();
  expect(screen.getByText("No specific skill preference.")).toBeTruthy();
  expect(screen.queryByText("Skills were not assessed for this saved assignment.")).toBeNull();
});

it("does not increase staffing weight just because the roster has surplus capacity", () => {
  const inputs = [[{tsi:0.2}], 1, []] as const;
  const low = computeAutoWeights([...inputs[0]], inputs[1], [...inputs[2]], 20);
  const high = computeAutoWeights([...inputs[0]], inputs[1], [...inputs[2]], 80);
  expect(low.resourceUtilizationWeight).toBe(high.resourceUtilizationWeight);
  expect(low.reasons.join(" ")).toContain("surplus officers stay available");
});

it("keeps a final schedule score out of the curve while saved generation history loads", async () => {
  let resolveResults!: (value: backend.OptimizationResults) => void;
  vi.mocked(backend.fetchOptimizationStatus).mockResolvedValue({run_id: "staffing-test", status: "completed",
    current_generation: 89, total_generations: 300, current_fitness: 92.295125});
  vi.mocked(backend.fetchOptimizationResults).mockReturnValue(new Promise(resolve => {resolveResults = resolve;}));
  renderEngine();
  await screen.findByText("Final schedule score");
  expect(screen.getByLabelText("Search generation scores").textContent).toBe("[]");
  await act(async () => resolveResults({run_id: "staffing-test", status: "completed",
    fitness_scores: [89.6188, 89.9713], top_solutions: [{fitness: 92.295125, assignments: []}]}));
  expect(screen.getByLabelText("Search generation scores").textContent).toBe("[89.6188,89.9713]");
  expect(screen.getByText("92.30")).toBeTruthy();
});

it("does not fabricate a generation from the final score if saved result loading fails", async () => {
  vi.mocked(backend.fetchOptimizationStatus).mockResolvedValue({run_id: "staffing-test", status: "completed",
    current_generation: 89, total_generations: 300, current_fitness: 92.295125});
  vi.mocked(backend.fetchOptimizationResults).mockRejectedValue(new Error("Saved results unavailable."));
  renderEngine();
  await screen.findByText("Saved results unavailable.");
  expect(screen.getByLabelText("Search generation scores").textContent).toBe("[]");
  expect(screen.getByText("92.30")).toBeTruthy();
});

it("preserves generations 101 through 300 when displaying the last 200 saved scores", async () => {
  const scores = Array.from({length: 300}, (_, index) => 89 + index / 1000);
  vi.mocked(backend.fetchOptimizationStatus).mockResolvedValue({run_id: "staffing-test", status: "completed",
    current_generation: 300, total_generations: 300, current_fitness: 92.295125});
  vi.mocked(backend.fetchOptimizationResults).mockResolvedValue({run_id: "staffing-test", status: "completed",
    fitness_scores: scores, top_solutions: []});
  renderEngine();
  await screen.findByText("Final schedule score");
  expect(JSON.parse(screen.getByLabelText("Search generation numbers").textContent ?? "[]")).toEqual(Array.from({length: 200}, (_, index) => index + 101));
  expect(JSON.parse(screen.getByLabelText("Search generation scores").textContent ?? "[]")).toEqual(scores.slice(-200));
});

it("waits for slow status and result responses before polling again, then stops on completion", async () => {
  vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
  let resolveStatus!: (value: backend.OptimizationStatus) => void;
  let resolveResults!: (value: backend.OptimizationResults) => void;
  const running = {run_id: "staffing-test", status: "running", current_generation: 88,
    total_generations: 300, current_fitness: 89.948};
  vi.mocked(backend.fetchOptimizationStatus)
    .mockReturnValueOnce(new Promise(resolve => {resolveStatus = resolve;}))
    .mockResolvedValue({...running, status: "completed", current_generation: 89, current_fitness: 92.295125});
  vi.mocked(backend.fetchOptimizationResults)
    .mockReturnValueOnce(new Promise(resolve => {resolveResults = resolve;}))
    .mockResolvedValue({run_id: "staffing-test", status: "completed", fitness_scores: [89.948, 89.9713], top_solutions: []});
  renderEngine();
  await act(async () => {vi.advanceTimersByTime(6000);});
  expect(backend.fetchOptimizationStatus).toHaveBeenCalledTimes(1);
  await act(async () => resolveStatus(running));
  await act(async () => {vi.advanceTimersByTime(6000);});
  expect(backend.fetchOptimizationStatus).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Search fitness")).toBeTruthy();
  await act(async () => resolveResults({run_id: "staffing-test", status: "running", top_solutions: []}));
  await act(async () => {vi.advanceTimersByTime(2000);});
  expect(backend.fetchOptimizationStatus).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Final schedule score")).toBeTruthy();
  expect(screen.getByLabelText("Search generation scores").textContent).toBe("[89.948,89.9713]");
  await act(async () => {vi.advanceTimersByTime(10000);});
  expect(backend.fetchOptimizationStatus).toHaveBeenCalledTimes(2);
});

it("ignores a delayed response from the replaced StrictMode effect after completion", async () => {
  let resolveOld!: (value: backend.OptimizationStatus) => void;
  vi.mocked(backend.fetchOptimizationStatus)
    .mockReturnValueOnce(new Promise(resolve => {resolveOld = resolve;}))
    .mockResolvedValue({run_id: "staffing-test", status: "completed", current_generation: 89,
      total_generations: 300, current_fitness: 92.295125});
  vi.mocked(backend.fetchOptimizationResults).mockResolvedValue({run_id: "staffing-test", status: "completed",
    fitness_scores: [89.948, 89.9713], top_solutions: []});
  renderEngine(true);
  await screen.findByText("Final schedule score");
  await act(async () => resolveOld({run_id: "staffing-test", status: "running", current_generation: 70,
    total_generations: 300, current_fitness: 89.9}));
  expect(screen.getByText("Final schedule score")).toBeTruthy();
  expect(screen.getByLabelText("Search generation scores").textContent).toBe("[89.948,89.9713]");
  expect(backend.fetchOptimizationResults).toHaveBeenCalledTimes(1);
});

it("retries failed result loading and clears the old error after a successful review", async () => {
  vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
  vi.mocked(backend.fetchOptimizationResults)
    .mockRejectedValueOnce(new Error("Temporary results failure"))
    .mockResolvedValue({run_id: "staffing-test", status: "completed", fitness_scores: [89.9713], top_solutions: []});
  renderEngine();
  await act(async () => {});
  expect(screen.getByText("Temporary results failure")).toBeTruthy();
  await act(async () => {vi.advanceTimersByTime(2000);});
  expect(screen.queryByText("Temporary results failure")).toBeNull();
  expect(screen.getByLabelText("Search generation scores").textContent).toBe("[89.9713]");
  await act(async () => {vi.advanceTimersByTime(10000);});
  expect(backend.fetchOptimizationStatus).toHaveBeenCalledTimes(2);
});

it.each(["operational", "shadow"] as const)("shows the saved %s planning window and final score instead of inventing full-shift coverage", async mode => {
  vi.mocked(backend.fetchOptimizationResults).mockResolvedValue({run_id: "staffing-test", status: "completed",
    parameters: {mode, shift: "morning", operational_date: "2099-01-01"},
    top_solutions: [{fitness: 103.5, assignments: [], score_breakdown: {
      version: "fitness-breakdown-v1", basis: "time_weighted_final_assignments", components: [],
      incident_bonus: {score: 0, weight: 0.15, contribution: 0}, constraint_adjustment: 0, rounding_adjustment: 0, total: 103.5,
    }}],
    input_snapshot: {
      captured_at: "2099-01-01T11:00:00+08:00", bottlenecks: [],
      weather: {source: "live", data_status: "live", is_stale: false, is_synthetic: false},
      planning_window: {
        start_time: `2099-01-01T${mode === "shadow" ? "06:00" : "11:03"}:00+08:00`,
        end_time: "2099-01-01T14:00:00+08:00", captured_at: "2099-01-01T11:00:00+08:00",
        mode, review_lead_seconds: mode === "shadow" ? 0 : 120, baseline_revision: "saved-baseline",
      },
    },
  });
  renderEngine();
  await screen.findByRole("region", {name: "Saved planning window"});
  expect(screen.getByRole("heading", {name: mode === "shadow" ? "Full shift · Shadow comparison" : "Remaining shift planning"})).toBeTruthy();
  expect(screen.getByText("103.50")).toBeTruthy();
  expect(screen.getByText("103.5000")).toBeTruthy();
  if (mode === "operational") expect(screen.getByText(/allowed 2 minutes for review/)).toBeTruthy();
  else expect(screen.getByText(/comparison covers the full selected shift and cannot be published/)).toBeTruthy();
});
