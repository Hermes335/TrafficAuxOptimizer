import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { OptimizationEngine } from "../app/pages/OptimizationEngine";
import { computeAutoWeights } from "../app/hooks/useOptimizationConfig";
import * as backend from "../app/services/backend";

vi.mock("../app/components/PrettyCurve", () => ({ default: () => null }));
vi.mock("../app/contexts/AuthContext", () => ({useAuth: () => ({user: {role: "dispatcher"}})}));
vi.mock("../app/services/backend", () => ({
  fetchOptimizationStatus: vi.fn(), fetchOptimizationResults: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/optimization-engine?run_id=staffing-test");
  vi.mocked(backend.fetchOptimizationStatus).mockResolvedValue({run_id:"staffing-test", status:"completed",
    current_generation:22, total_generations:300, current_fitness:96});
});

it("shows the staffing target and reserves alongside actual roster utilization", async () => {
  vi.mocked(backend.fetchOptimizationResults).mockResolvedValue({run_id:"staffing-test", status:"completed",
    top_solutions:[{staffing_targets:{QUIET:2}, reserve_officers:6, staffing_efficiency:100,
      resource_utilization:25, staffing_shortages:{}, assignments:[
        {officer_id:1, bottleneck_id:"QUIET", bottleneck_name:"Quiet junction"},
        {officer_id:2, bottleneck_id:"QUIET", bottleneck_name:"Quiet junction"},
      ]}]});
  render(<MemoryRouter><OptimizationEngine /></MemoryRouter>);
  expect(await screen.findByText("Staffing target: 2 officers")).toBeTruthy();
  expect(screen.getByText("Officers in reserve: 6")).toBeTruthy();
  expect(screen.getByText("Staffing Efficiency: 100.0%")).toBeTruthy();
  expect(screen.getByText("Resource Utilization: 25.0%")).toBeTruthy();
});

it("keeps historical results readable without inventing a staffing target or reserve count", async () => {
  vi.mocked(backend.fetchOptimizationResults).mockResolvedValue({run_id:"staffing-test", status:"completed",
    top_solutions:[{resource_utilization:100, assignments:[
      {officer_id:1, bottleneck_id:"LEGACY", bottleneck_name:"Historical junction"},
    ]}]});
  render(<MemoryRouter><OptimizationEngine /></MemoryRouter>);
  await screen.findByText("Historical junction");
  expect(screen.queryByText(/Staffing target:/)).toBeNull();
  expect(screen.queryByText(/Officers in reserve:/)).toBeNull();
  expect(screen.getByText("Skills were not assessed for this saved assignment.")).toBeTruthy();
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
  render(<MemoryRouter><OptimizationEngine /></MemoryRouter>);
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
