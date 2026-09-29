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
});

it("does not increase staffing weight just because the roster has surplus capacity", () => {
  const inputs = [[{tsi:0.2}], 1, []] as const;
  const low = computeAutoWeights([...inputs[0]], inputs[1], [...inputs[2]], 20);
  const high = computeAutoWeights([...inputs[0]], inputs[1], [...inputs[2]], 80);
  expect(low.resourceUtilizationWeight).toBe(high.resourceUtilizationWeight);
  expect(low.reasons.join(" ")).toContain("surplus officers stay available");
});
