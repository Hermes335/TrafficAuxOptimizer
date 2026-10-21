import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router";
import { AssignmentEditor } from "../app/pages/GanttChart/ScheduleEditors";
import { GanttTimeline } from "../app/pages/GanttChart/GanttTimeline";
import { GanttChart } from "../app/pages/GanttChart";
import * as backend from "../app/services/backend";

vi.mock("../app/contexts/AuthContext", () => ({useAuth: () => ({user: {role: "dispatcher"}})}));
vi.mock("../app/pages/GanttChart/OperationsPanel", () => ({OperationsPanel: () => null}));
vi.mock("../app/services/backend", async original => ({...await original<typeof import("../app/services/backend")>(),
  saveDeploymentAssignment: vi.fn(), fetchDeploymentSchedule: vi.fn(), fetchBottlenecks: vi.fn(),
  fetchDashboardOfficers: vi.fn(), fetchOptimizationHistory: vi.fn(), fetchScheduleProvenance: vi.fn(), subscribeToDashboardStream: vi.fn(() => () => {}),
}));
const day = "2026-10-21";
const officer: backend.DashboardOfficerRecord = {id: 1, name: "Officer Alpha", badge_number: "ALPHA", shift: "afternoon", status: "available", skills: []};
const node: backend.BottleneckOption = {id: "A", name: "Test intersection"};
const assignment: backend.DeploymentScheduleItem = {id: 1, officer_id: 1, officer: "ALPHA", officer_name: officer.name,
  bottleneck: "A", bottleneck_name: node.name, shift: "afternoon", status: "assigned", assignment_type: "static",
  start_time: `${day}T16:00:00+08:00`, end_time: `${day}T22:00:00+08:00`};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(`${day}T15:30:20+08:00`));
  vi.mocked(backend.saveDeploymentAssignment).mockResolvedValue(undefined);
  vi.mocked(backend.fetchDeploymentSchedule).mockResolvedValue([assignment]);
  vi.mocked(backend.fetchBottlenecks).mockResolvedValue([node]);
  vi.mocked(backend.fetchDashboardOfficers).mockResolvedValue([officer]);
  vi.mocked(backend.fetchOptimizationHistory).mockResolvedValue({count: 0, next: null, results: []});
  vi.mocked(backend.fetchScheduleProvenance).mockResolvedValue({operational_date: day, checked_at: `${day}T15:30:00+08:00`, shifts: []});
});
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks();});

function editor() {
  render(<AssignmentEditor assignment={null} day={day} initialShift="afternoon" officers={[officer]} nodes={[node]} onClose={vi.fn()} onSaved={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.change(screen.getByLabelText("Officer"), {target: {value: "1"}});
  fireEvent.change(screen.getByLabelText("Intersection"), {target: {value: "A"}});
}

it("defaults to the next Manila minute and preserves the server's current-minute assignment tolerance", async () => {
  // operationalDate() uses new Date(), so freeze the calendar as well as Date.now().
  vi.useFakeTimers({toFake: ["Date"]});
  vi.setSystemTime(new Date(`${day}T15:30:20+08:00`));
  editor();
  expect(screen.getByLabelText("Start time")).toHaveProperty("value", "15:31");
  fireEvent.change(screen.getByLabelText("Start time"), {target: {value: "15:30"}});
  fireEvent.click(screen.getByRole("button", {name: "Save assignment"}));
  await waitFor(() => expect(backend.saveDeploymentAssignment).toHaveBeenCalledWith(expect.objectContaining({start_time: `${day}T15:30:00+08:00`}), undefined));
  vi.useRealTimers();
});

it("rechecks time at submission after the editor has been left idle", async () => {
  editor();
  fireEvent.change(screen.getByLabelText("Start time"), {target: {value: "15:31"}});
  vi.mocked(Date.now).mockReturnValue(Date.parse(`${day}T15:33:20+08:00`));
  fireEvent.click(screen.getByRole("button", {name: "Save assignment"}));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Start time is in the past"));
  expect(backend.saveDeploymentAssignment).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByLabelText("Start time"));
});

it("explains reversed time windows and focuses the end field without sending a request", async () => {
  editor();
  fireEvent.change(screen.getByLabelText("Start time"), {target: {value: "18:00"}});
  fireEvent.change(screen.getByLabelText("End time"), {target: {value: "17:00"}});
  fireEvent.click(screen.getByRole("button", {name: "Save assignment"}));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "End time must be after start time.");
  expect(backend.saveDeploymentAssignment).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByLabelText("End time"));
});

it("centers the visible timeline on now and returns to the shift start", () => {
  vi.mocked(Date.now).mockReturnValue(Date.parse(`${day}T16:00:00+08:00`));
  const {container} = render(<GanttTimeline deployments={[assignment]} viewMode="officer" day={day} shift="all" />);
  const scroller = screen.getByLabelText("Scroll deployment timeline");
  const scrollTo = vi.fn();
  scroller.scrollTo = scrollTo;
  Object.defineProperty(scroller, "clientWidth", {value: 500});
  Object.defineProperty(container.querySelector("[data-timeline-label]"), "offsetWidth", {value: 200});
  Object.defineProperty(container.querySelector("[data-timeline-axis]"), "offsetWidth", {value: 1000});
  fireEvent.click(screen.getByRole("button", {name: "Jump to now"}));
  expect(scrollTo).toHaveBeenLastCalledWith({left: 475, behavior: "auto"});
  expect(screen.getByText(/Red line: Now/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name: "Shift start"}));
  expect(scrollTo).toHaveBeenLastCalledWith({left: 0, behavior: "auto"});
});

it("opens publication date/shift context, preserves loaded rows on equivalent links, and uses a dispatcher-safe back link", async () => {
  function Harness() {
    const navigate = useNavigate();
    return <><button onClick={() => navigate(`/gantt-chart?shift=afternoon&date=${day}&from=receipt`)}>Equivalent link</button><GanttChart /></>;
  }
  render(<MemoryRouter initialEntries={[`/gantt-chart?date=${day}&shift=afternoon`]}><Harness /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole("combobox", {name: "Viewing shift"})).toHaveProperty("value", "afternoon"));
  await waitFor(() => expect(document.querySelector('[data-assignment-id="1"]')).toBeTruthy());
  expect(screen.getByRole("link", {name: "Back to dashboard"}).getAttribute("href")).toBe("/");
  expect(backend.fetchDeploymentSchedule).toHaveBeenLastCalledWith(day);
  fireEvent.click(screen.getByRole("button", {name: "Equivalent link"}));
  await waitFor(() => expect(document.querySelector('[data-assignment-id="1"]')).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Operational date"), {target: {value: "2026-10-22"}});
  await waitFor(() => expect(backend.fetchDeploymentSchedule).toHaveBeenLastCalledWith("2026-10-22"));
  fireEvent.click(screen.getByRole("button", {name: "Equivalent link"}));
  await waitFor(() => expect(screen.getByLabelText("Operational date")).toHaveProperty("value", day));
  await waitFor(() => expect(backend.fetchDeploymentSchedule).toHaveBeenLastCalledWith(day));
});
