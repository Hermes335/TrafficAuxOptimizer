import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { GanttChart } from "../app/pages/GanttChart";
import { PublishScheduleButton } from "../app/components/PublishScheduleButton";
import { useDashboardData } from "../app/hooks/useDashboardData";
import { WeatherProvider } from "../app/contexts/WeatherContext";
import { operationalDate } from "../app/services/operationalTime";
import * as backend from "../app/services/backend";
vi.mock("../app/services/backend", async original => ({
  ...await original<typeof import("../app/services/backend")>(),
  fetchBottlenecks: vi.fn(), fetchIncidentMeta: vi.fn(), fetchIncident: vi.fn(), updateIncident: vi.fn(),
  fetchDeploymentSchedule: vi.fn(), clearDeploymentSchedule: vi.fn(), fetchDashboardOfficers: vi.fn(), fetchOptimizationHistory: vi.fn(),
  fetchDashboardSnapshot: vi.fn(), fetchPOIs: vi.fn(), fetchCurrentWeather: vi.fn(), fetchTrafficReadings: vi.fn().mockResolvedValue([]),
  previewPublication: vi.fn(), publishDeploymentsFromOptimization: vi.fn(),
  subscribeToDashboardStream: vi.fn(() => () => {}),
}));
vi.mock("../app/contexts/AuthContext", () => ({useAuth: () => ({user: {role: "supervisor"}})}));
vi.mock("../app/pages/GanttChart/GanttTimeline", () => ({GanttTimeline: () => null}));
vi.mock("../app/components/ScheduleHistory", () => ({ScheduleHistory: () => null}));
const nodes = [{id:"A", name:"First node"}, {id:"B", name:"Saved node"}] as backend.BottleneckOption[];
const day = operationalDate();
const assignment: backend.DeploymentScheduleItem = {id:1, officer:"REVIEW-1", officer_name:"Fixture officer",
  bottleneck:"A", shift:"morning", assignment_type:"static", status:"assigned",
  start_time:`${day}T06:30:00+08:00`, end_time:`${day}T07:30:00+08:00`};
const preview: backend.PublicationPreview = {run_id:"run-A", operational_date:day, shift:"morning", created:1,
  start_time:assignment.start_time, end_time:assignment.end_time, skipped:[], staff_added:[1], staff_removed:[],
  replaced:0, conflicts:[], expected_revision:"version-A", captured_at:assignment.start_time, input_issues:[],
  added_assignments:[], removed_assignments:[]};
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  vi.mocked(backend.fetchBottlenecks).mockResolvedValue(nodes);
  vi.mocked(backend.updateIncident).mockResolvedValue(undefined);
  vi.mocked(backend.fetchDeploymentSchedule).mockResolvedValue([assignment]);
  vi.mocked(backend.fetchDashboardOfficers).mockResolvedValue([{id:1, name:"Fixture officer", badge_number:"REVIEW-1",
    status:"deployed", shift:"morning"} as backend.DashboardOfficerRecord]);
  vi.mocked(backend.fetchOptimizationHistory).mockResolvedValue({count:0, next:null, results:[]});
  vi.mocked(backend.subscribeToDashboardStream).mockReturnValue(() => {});
  vi.mocked(backend.previewPublication).mockResolvedValue(preview);
  vi.mocked(backend.publishDeploymentsFromOptimization).mockResolvedValue(preview);
  vi.mocked(backend.fetchDashboardSnapshot).mockResolvedValue(backend.getFallbackDashboardSnapshot());
  vi.mocked(backend.fetchPOIs).mockResolvedValue([]);
  vi.mocked(backend.fetchCurrentWeather).mockResolvedValue({} as backend.WeatherCurrentSnapshot);
});
it("text searches preserve the operational officer pool and active count", async () => {
  render(<MemoryRouter><GanttChart /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("assignments").textContent).toBe("1 assignments"));
  fireEvent.change(screen.getByLabelText("Search schedule"), {target:{value:"no-match"}});
  expect(screen.getByText("unassigned officers").textContent).toBe("0 unassigned officers");
  expect(screen.getByText("assignments").textContent).toBe("1 assignments");
});
it("keeps a rejected schedule clear in its confirmation and permits cancellation", async () => {
  vi.mocked(backend.clearDeploymentSchedule).mockRejectedValueOnce(new Error("Clear request unavailable"));
  render(<MemoryRouter><GanttChart /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("assignments").textContent).toBe("1 assignments"));
  fireEvent.click(screen.getByRole("button", {name:"Schedule tools"}));
  fireEvent.click(screen.getByRole("button", {name:"Clear schedule"}));
  fireEvent.change(screen.getByPlaceholderText("Type to confirm..."), {target:{value:"CLEAR_SCHEDULE"}});
  fireEvent.click(screen.getByRole("button", {name:"Clear Schedule"}));
  expect((await screen.findByRole("alert")).textContent).toBe("Clear request unavailable");
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name:"Cancel"}));
  expect(backend.clearDeploymentSchedule).toHaveBeenCalledTimes(1);
  expect(screen.getByText("assignments").textContent).toBe("1 assignments");
});
it("reports a successful clear with a failed refresh without offering to clear again", async () => {
  vi.mocked(backend.clearDeploymentSchedule).mockResolvedValueOnce({cleared:1});
  render(<MemoryRouter><GanttChart /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("assignments").textContent).toBe("1 assignments"));
  fireEvent.click(screen.getByRole("button", {name:"Schedule tools"}));
  fireEvent.click(screen.getByRole("button", {name:"Clear schedule"}));
  vi.mocked(backend.fetchDeploymentSchedule).mockRejectedValueOnce(new Error("Refresh offline"));
  fireEvent.change(screen.getByPlaceholderText("Type to confirm..."), {target:{value:"CLEAR_SCHEDULE"}});
  fireEvent.click(screen.getByRole("button", {name:"Clear Schedule"}));
  await screen.findByText(/The schedule was cleared, but the display could not be refreshed/);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(backend.clearDeploymentSchedule).toHaveBeenCalledTimes(1);
});
it("completed service is excluded from active counts and retained in historical coverage", async () => {
  vi.mocked(backend.fetchDeploymentSchedule).mockResolvedValue([{...assignment,status:"completed"}]);
  render(<MemoryRouter><GanttChart /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("unassigned officers").textContent).toBe("1 unassigned officers"));
  expect(screen.getByText("assignments").textContent).toBe("0 assignments");
  fireEvent.click(screen.getByRole("button", {name: "Show assignment list and coverage"}));
  expect(screen.getByTitle("First node @ 7:00 -> 1 officer(s)")).toBeTruthy();
});
it("uses timestamps for 06:30-07:30 coverage", async () => {
  render(<MemoryRouter><GanttChart /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("assignments").textContent).toBe("1 assignments"));
  fireEvent.click(screen.getByRole("button", {name: "Show assignment list and coverage"}));
  expect(screen.getByTitle("First node @ 6:00 -> 0 officer(s)")).toBeTruthy();
  expect(screen.getByTitle("First node @ 7:00 -> 1 officer(s)")).toBeTruthy();
});
it("refreshes preserve the chosen saved run", async () => {
  const runs = ["run-A","run-B"].map((run_id,i) => ({id:i,run_id,timestamp:new Date().toISOString(),status:"completed",
    parameters:{shift:"morning"},result_data:{},fitness_scores:[],created_by:1}));
  vi.mocked(backend.fetchOptimizationHistory).mockResolvedValue({count:2,next:null,results:runs});
  render(<MemoryRouter><GanttChart /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", {name: "Schedule tools"}));
  await screen.findByText("run-B");
  fireEvent.change(screen.getByLabelText("Completed optimization run"),{target:{value:"run-B"}});
  fireEvent.click(screen.getByRole("button", {name: "Refresh schedule"}));
  await waitFor(() => expect(backend.fetchOptimizationHistory).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText("Completed optimization run")).toHaveProperty("value","run-B");
});
it("a history failure does not block loading the schedule", async () => {
  vi.mocked(backend.fetchOptimizationHistory).mockRejectedValue(new Error("History unavailable"));
  render(<MemoryRouter><GanttChart /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("assignments").textContent).toBe("1 assignments"));
  expect(screen.getByText(/Run history: History unavailable/)).toBeTruthy();
});
it("a run changing outside an open publication review cannot change that review", async () => {
  const {rerender} = render(<PublishScheduleButton runId="run-A" date={day} />);
  fireEvent.click(screen.getByText("Preview publication")); await screen.findByText("morning");
  rerender(<PublishScheduleButton runId="run-B" date={day} />);
  fireEvent.click(screen.getByText("Confirm publication"));
  await waitFor(() => expect(backend.publishDeploymentsFromOptimization).toHaveBeenCalledWith(expect.objectContaining({run_id:"run-A",expected_revision:"version-A"})));
});
it("retries a lost publication response using the same request key", async () => {
  vi.mocked(backend.publishDeploymentsFromOptimization).mockRejectedValueOnce(new Error("Connection lost"));
  render(<PublishScheduleButton runId="run-A" date={day} />);
  fireEvent.click(screen.getByText("Preview publication")); await screen.findByText("morning");
  fireEvent.click(screen.getByText("Confirm publication")); await screen.findByText("Retry publication");
  const first = vi.mocked(backend.publishDeploymentsFromOptimization).mock.calls[0][0];
  fireEvent.click(screen.getByText("Retry publication"));
  await waitFor(() => expect(backend.publishDeploymentsFromOptimization).toHaveBeenCalledTimes(2));
  expect(vi.mocked(backend.publishDeploymentsFromOptimization).mock.calls[1][0]).toEqual(first);
});
it("a shadow recommendation cannot open a publication review", () => {
  render(<PublishScheduleButton runId="run-A" mode="shadow" />);
  expect(screen.getByText("Preview publication")).toHaveProperty("disabled", true);
  expect(screen.getByRole("status").textContent).toContain("Shadow recommendation");
});
it("optional collection failures do not block dashboard updates", async () => {
  const snapshot = {...backend.getFallbackDashboardSnapshot(), incidents:[{id:9,text:"New incident",type:"major" as const}]};
  vi.mocked(backend.fetchDashboardSnapshot).mockResolvedValue(snapshot);
  vi.mocked(backend.fetchPOIs).mockRejectedValue(new Error("POIs unavailable"));
  const {result} = renderHook(() => useDashboardData("morning"), {wrapper: WeatherProvider});
  await waitFor(() => expect(result.current.dashboardSnapshot.incidents[0]?.id).toBe(9));
  expect(result.current.loadError).toBe("Points of interest: POIs unavailable");
});
it("coalesces live event bursts into one trailing refresh", async () => {
  let receive!: (event: backend.LiveDashboardEvent) => void;
  let complete!: (snapshot: backend.DashboardSnapshot) => void;
  vi.mocked(backend.fetchDashboardSnapshot).mockReturnValueOnce(new Promise(resolve => {complete = resolve;}));
  vi.mocked(backend.subscribeToDashboardStream).mockImplementation(cb => {receive = cb; return () => {};});
  renderHook(() => useDashboardData("morning"), {wrapper: WeatherProvider});
  act(() => {for (let i=0;i<8;i++) receive({event:"incident_updated"});});
  expect(backend.fetchDashboardSnapshot).toHaveBeenCalledTimes(1);
  await act(async () => complete(backend.getFallbackDashboardSnapshot()));
  await waitFor(() => expect(backend.fetchDashboardSnapshot).toHaveBeenCalledTimes(2));
});
