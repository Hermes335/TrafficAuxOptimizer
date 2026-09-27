import { StrictMode } from "react";
import { expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { OptimizationRunning } from "../app/pages/OptimizationRunning";
import * as backend from "../app/services/backend";
vi.mock("../app/components/PrettyCurve",()=>({default:()=>null}));
vi.mock("../app/services/backend",()=>({
  runOptimization: vi.fn(),
  fetchOptimizationStatus: vi.fn(),
  fetchOptimizationResults: vi.fn(),
  subscribeToOptimizationStream: vi.fn(()=>()=>{}),
  cancelOptimizationRun: vi.fn(),
}));
const status = {run_id:"existing",status:"completed",current_generation:50,total_generations:50,current_fitness:12};
it("reconnects to a saved run without starting another optimization",async()=>{
  vi.clearAllMocks();
  window.history.replaceState(null,"","/optimization-running?run_id=existing");
  vi.mocked(backend.fetchOptimizationStatus).mockResolvedValue(status);
  render(<MemoryRouter><OptimizationRunning /></MemoryRouter>);
  await screen.findByText("Optimization complete.");
  expect(backend.fetchOptimizationStatus).toHaveBeenCalledWith("existing");
  expect(backend.runOptimization).not.toHaveBeenCalled();
});
it("React strict effects start only one job and connect to its persisted run",async()=>{
  vi.clearAllMocks();
  window.history.replaceState(null,"","/optimization-running?shift=morning");
  vi.mocked(backend.runOptimization).mockResolvedValue({...status,status:"queued"});
  vi.mocked(backend.fetchOptimizationStatus).mockResolvedValue(status);
  render(<StrictMode><MemoryRouter><OptimizationRunning /></MemoryRouter></StrictMode>);
  await waitFor(()=>expect(backend.fetchOptimizationStatus).toHaveBeenCalled());
  expect(backend.runOptimization).toHaveBeenCalledTimes(1);
  expect(window.location.search).toContain("run_id=existing");
});

