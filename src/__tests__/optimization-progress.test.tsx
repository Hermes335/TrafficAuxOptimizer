import { StrictMode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(backend.subscribeToOptimizationStream).mockReturnValue(() => {});
});
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

it("shows early completion at 100% while retaining 48 executed generations and the 300 limit",async()=>{
  window.history.replaceState(null,"","/optimization-running?run_id=existing");
  vi.mocked(backend.fetchOptimizationStatus).mockResolvedValue({...status,current_generation:48,total_generations:300,converged_early:true});
  render(<MemoryRouter><OptimizationRunning /></MemoryRouter>);
  await screen.findByRole("heading",{name:"100% Optimization Progress"});
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  expect(screen.getByText(/Converged early after 48 generations \(limit 300\)/)).toBeTruthy();
  expect(screen.getByText("GEN 48 · LIMIT 300")).toBeTruthy();
  expect(screen.getByText("Generations completed").parentElement?.textContent).toContain("48of 300 max");
  expect(screen.queryByText(/16%/)).toBeNull();
  expect(screen.queryByText("Estimating completion from backend stream...")).toBeNull();
});

it.each(["running","failed","cancelled"])("does not mark a %s run at generation 48/300 as 100% complete",async(runStatus)=>{
  window.history.replaceState(null,"","/optimization-running?run_id=existing");
  vi.mocked(backend.fetchOptimizationStatus).mockResolvedValue({...status,status:runStatus,current_generation:48,total_generations:300});
  render(<MemoryRouter><OptimizationRunning /></MemoryRouter>);
  await screen.findByRole("heading",{name:"16% Optimization Progress"});
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("16");
});

it("ignores an older running poll response arriving after the completed stream event",async()=>{
  window.history.replaceState(null,"","/optimization-running?run_id=existing");
  let resolvePoll!: (value: backend.OptimizationStatus) => void;
  let receive!: (value: backend.OptimizationStatus) => void;
  vi.mocked(backend.fetchOptimizationStatus).mockReturnValue(new Promise(resolve=>{resolvePoll=resolve;}));
  vi.mocked(backend.subscribeToOptimizationStream).mockImplementation((_id,callback)=>{receive=callback;return()=>{};});
  render(<MemoryRouter><OptimizationRunning /></MemoryRouter>);
  await waitFor(()=>expect(backend.fetchOptimizationStatus).toHaveBeenCalled());
  await act(async()=>receive({...status,current_generation:48,total_generations:300,converged_early:true}));
  await screen.findByRole("heading",{name:"100% Optimization Progress"});
  await act(async()=>resolvePoll({...status,status:"running",current_generation:42,total_generations:300}));
  expect(screen.getByRole("heading",{name:"100% Optimization Progress"})).toBeTruthy();
  expect(screen.getByText("GEN 48 · LIMIT 300")).toBeTruthy();
});
