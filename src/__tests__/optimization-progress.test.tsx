import { StrictMode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { OptimizationRunning } from "../app/pages/OptimizationRunning";
import * as backend from "../app/services/backend";
vi.mock("../app/components/PrettyCurve",()=>({default:({values, secondaryValues, generations}: {values: number[]; secondaryValues: number[]; generations: number[]}) =>
  <><output data-testid="search-values">{JSON.stringify(values)}</output><output data-testid="search-means">{JSON.stringify(secondaryValues)}</output><output data-testid="search-generations">{JSON.stringify(generations)}</output></>}));
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
  vi.mocked(backend.fetchOptimizationResults).mockResolvedValue({run_id: "existing", status: "completed", fitness_scores: [12], top_solutions: []});
});
const chartValues = () => JSON.parse(screen.getByTestId("search-values").textContent ?? "[]") as number[];
const chartMeans = () => JSON.parse(screen.getByTestId("search-means").textContent ?? "[]") as number[];
const savedSearch = Array.from({length: 89}, (_, index) => index === 88 ? 89.9713 : 89.6 + index * 0.004);
const completedSchedule = {...status, current_generation: 89, total_generations: 300, current_fitness: 92.295125, converged_early: true};
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
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

it("keeps terminal schedule score out of search history and restores the unstreamed final search generation", async () => {
  window.history.replaceState(null, "", "/optimization-running?run_id=existing");
  let receive!: (value: backend.OptimizationStatus) => void;
  vi.mocked(backend.subscribeToOptimizationStream).mockImplementation((_id, callback) => {receive = callback; return () => {};});
  vi.mocked(backend.fetchOptimizationStatus).mockResolvedValue({...status, status: "running", current_generation: 88, total_generations: 300, current_fitness: 89.948});
  const history = deferred<backend.OptimizationResults>();
  vi.mocked(backend.fetchOptimizationResults).mockReturnValue(history.promise);
  render(<MemoryRouter><OptimizationRunning /></MemoryRouter>);
  await waitFor(() => expect(chartValues()).toEqual([89.948]));
  expect(screen.getByTestId("search-generations").textContent).toBe("[88]");
  await act(async () => receive(completedSchedule));
  expect(chartValues()).toEqual([89.948]);
  expect(screen.getByText("Final schedule score")).toBeTruthy();
  expect(screen.getByText("92.3")).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  expect(screen.getByText("GEN 89 · LIMIT 300")).toBeTruthy();
  expect(screen.queryByText(/from Gen 1/)).toBeNull();
  await act(async () => receive(completedSchedule));
  expect(backend.fetchOptimizationResults).toHaveBeenCalledTimes(1);
  await act(async () => history.resolve({run_id: "existing", status: "completed", fitness_scores: savedSearch, top_solutions: [{fitness: 92.295125}]}));
  await waitFor(() => expect(chartValues()).toEqual(savedSearch));
  expect(chartValues()[88]).toBe(89.9713);
  expect(JSON.parse(screen.getByTestId("search-generations").textContent ?? "[]")).toEqual(Array.from({length: 89}, (_, index) => index + 1));
  expect(chartValues()).not.toContain(92.295125);
  expect(chartMeans()[88]).toBeCloseTo(savedSearch.reduce((sum, score) => sum + score, 0) / 89, 9);
  expect(screen.getByText("Based on 89 saved search generations")).toBeTruthy();
  expect(screen.getByText(/final schedule is scored after assignment matching/)).toBeTruthy();
  await act(async () => receive({...completedSchedule, status: "running", current_generation: 87, current_fitness: 1}));
  expect(chartValues()).toEqual(savedSearch);
  expect(screen.getByText("GEN 89 · LIMIT 300")).toBeTruthy();
  expect(backend.fetchOptimizationResults).toHaveBeenCalledTimes(1);
});

it("reopening a completed run hydrates saved history once under StrictMode without plotting its final schedule score", async () => {
  window.history.replaceState(null, "", "/optimization-running?run_id=existing");
  vi.mocked(backend.fetchOptimizationStatus).mockResolvedValue(completedSchedule);
  const history = deferred<backend.OptimizationResults>();
  vi.mocked(backend.fetchOptimizationResults).mockReturnValue(history.promise);
  render(<StrictMode><MemoryRouter><OptimizationRunning /></MemoryRouter></StrictMode>);
  await screen.findByText("Final schedule score");
  expect(chartValues()).toEqual([]);
  expect(backend.fetchOptimizationResults).toHaveBeenCalledTimes(1);
  await act(async () => history.resolve({run_id: "existing", status: "completed", fitness_scores: savedSearch, top_solutions: []}));
  await waitFor(() => expect(chartValues()).toEqual(savedSearch));
  expect(chartMeans()).toHaveLength(89);
  expect(chartMeans().every(Number.isFinite)).toBe(true);
  expect(backend.runOptimization).not.toHaveBeenCalled();
  expect(backend.fetchOptimizationResults).toHaveBeenCalledTimes(1);
});

it("preserves genuine live search points and reports when saved history cannot be loaded", async () => {
  window.history.replaceState(null, "", "/optimization-running?run_id=existing");
  let receive!: (value: backend.OptimizationStatus) => void;
  vi.mocked(backend.subscribeToOptimizationStream).mockImplementation((_id, callback) => {receive = callback; return () => {};});
  vi.mocked(backend.fetchOptimizationStatus).mockResolvedValue({...status, status: "running", current_generation: 88, current_fitness: 89.948});
  vi.mocked(backend.fetchOptimizationResults).mockRejectedValue(new Error("Connection unavailable"));
  render(<MemoryRouter><OptimizationRunning /></MemoryRouter>);
  await waitFor(() => expect(chartValues()).toEqual([89.948]));
  await act(async () => receive(completedSchedule));
  await screen.findByText(/Saved search history is unavailable/);
  expect(chartValues()).toEqual([89.948]);
  expect(chartMeans()).toEqual([89.948]);
  expect(screen.getByText("Based on 1 received search generations")).toBeTruthy();
  expect(screen.getByText("92.3")).toBeTruthy();
});

it.each(["failed", "cancelled"])("does not insert a %s terminal score into the convergence curve", async terminal => {
  window.history.replaceState(null, "", "/optimization-running?run_id=existing");
  let receive!: (value: backend.OptimizationStatus) => void;
  vi.mocked(backend.subscribeToOptimizationStream).mockImplementation((_id, callback) => {receive = callback; return () => {};});
  vi.mocked(backend.fetchOptimizationStatus).mockResolvedValue({...status, status: "running", current_generation: 88, current_fitness: 89.948});
  render(<MemoryRouter><OptimizationRunning /></MemoryRouter>);
  await waitFor(() => expect(chartValues()).toEqual([89.948]));
  await act(async () => receive({...completedSchedule, status: terminal}));
  expect(chartValues()).toEqual([89.948]);
  expect(chartMeans()).toEqual([89.948]);
  expect(backend.fetchOptimizationResults).not.toHaveBeenCalled();
});

it("rejects malformed saved scores and non-finite live scores without contaminating the curve or mean", async () => {
  window.history.replaceState(null, "", "/optimization-running?run_id=existing");
  let receive!: (value: backend.OptimizationStatus) => void;
  vi.mocked(backend.subscribeToOptimizationStream).mockImplementation((_id, callback) => {receive = callback; return () => {};});
  vi.mocked(backend.fetchOptimizationStatus).mockResolvedValue({...status, status: "running", current_generation: 87, current_fitness: 89.944});
  vi.mocked(backend.fetchOptimizationResults).mockResolvedValue({run_id: "existing", status: "completed", fitness_scores: [89.944, Number.NaN], top_solutions: []});
  render(<MemoryRouter><OptimizationRunning /></MemoryRouter>);
  await waitFor(() => expect(chartValues()).toEqual([89.944]));
  await act(async () => receive({...status, status: "running", current_generation: 88, current_fitness: Number.POSITIVE_INFINITY}));
  expect(chartValues()).toEqual([89.944]);
  await act(async () => receive(completedSchedule));
  await screen.findByText(/Saved search history is unavailable/);
  expect(chartValues()).toEqual([89.944]);
  expect(chartMeans()).toEqual([89.944]);
});
