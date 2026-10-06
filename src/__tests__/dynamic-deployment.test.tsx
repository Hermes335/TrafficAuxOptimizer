import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GanttTimeline } from "../app/pages/GanttChart/GanttTimeline";
import { AssignmentEditor, StaffingEditor } from "../app/pages/GanttChart/ScheduleEditors";
import * as backend from "../app/services/backend";
import { isDeploymentActive } from "../app/services/operationalTime";

vi.mock("../app/services/backend", async original=>({
  ...await original<typeof import("../app/services/backend")>(),
  updateDashboardBottleneck:vi.fn(),saveDeploymentAssignment:vi.fn(),
}));
const day="2099-01-01";
const nodes:backend.BottleneckOption[]=[{id:"A",name:"First intersection",area_name:"Prime State",min_officers_required:0,max_officers_allowed:4,
  staffing_windows:[{start_time:`${day}T06:00:00+08:00`,end_time:`${day}T14:00:00+08:00`,required:0,reason:"Quiet"}]}];
const officers:backend.DashboardOfficerRecord[]=[{id:1,name:"Officer Alpha",badge_number:"ALPHA",shift:"morning",status:"available",skills:[]}];
const assignment:backend.DeploymentScheduleItem={id:1,officer_id:1,officer:"ALPHA",officer_name:"Officer Alpha",bottleneck:"A",bottleneck_name:"First intersection",
  start_time:`${day}T06:30:00+08:00`,end_time:`${day}T07:30:00+08:00`,shift:"morning",status:"assigned",assignment_type:"static"};
beforeEach(()=>vi.resetAllMocks());

it("shows officers on the live map only during their assignment window",()=>{
  const start=Date.parse(assignment.start_time),end=Date.parse(assignment.end_time);
  expect(isDeploymentActive(assignment,start-1)).toBe(false);
  expect(isDeploymentActive(assignment,start)).toBe(true);
  expect(isDeploymentActive(assignment,end)).toBe(false);
  expect(isDeploymentActive({...assignment,status:"cancelled"},start)).toBe(false);
});

it("positions partial-hour bars on the Manila time axis and opens the selected assignment",()=>{
  const select=vi.fn();
  const {container}=render(<GanttTimeline deployments={[assignment]} viewMode="officer" day={day} shift="morning" onSelect={select}/>);
  const bar=container.querySelector<HTMLButtonElement>('[data-assignment-id="1"]')!;
  expect(bar.style.left).toBe("6.25%");expect(bar.style.width).toBe("12.5%");
  fireEvent.click(bar);expect(select).toHaveBeenCalledWith(assignment);
  expect(screen.getByText("06:00")).toBeTruthy();expect(screen.getByText("14:00")).toBeTruthy();
});

it("uses separate lanes for simultaneous officers at the same intersection",()=>{
  const {container}=render(<GanttTimeline deployments={[assignment,{...assignment,id:2,officer:"BETA"}]} viewMode="bottleneck" day={day} shift="morning"/>);
  const first=container.querySelector<HTMLButtonElement>('[data-assignment-id="1"]')!;
  const second=container.querySelector<HTMLButtonElement>('[data-assignment-id="2"]')!;
  expect(first.style.top).not.toBe(second.style.top);
});

it("shows zero-demand locations even with no assignments",()=>{
  render(<GanttTimeline deployments={[]} viewMode="bottleneck" day={day} shift="morning" bottlenecks={nodes}/>);
  expect(screen.getByText("Prime State")).toBeTruthy();expect(screen.getByText("No officers required")).toBeTruthy();
  expect(screen.getByText("0 required · free")).toBeTruthy();
});

it("saves a zero staffing period without changing it to the old minimum",async()=>{
  vi.mocked(backend.updateDashboardBottleneck).mockResolvedValue({} as backend.Bottleneck);
  const saved=vi.fn().mockResolvedValue(undefined),close=vi.fn();
  render(<StaffingEditor nodes={nodes} onClose={close} onSaved={saved}/>);
  fireEvent.click(screen.getByText("Add staffing period"));
  fireEvent.change(screen.getByLabelText("Period 1 label"),{target:{value:"Quiet period"}});
  fireEvent.change(screen.getByLabelText("Traffic lights"),{target:{value:"working"}});
  fireEvent.click(screen.getByText("Save staffing"));
  await waitFor(()=>expect(close).toHaveBeenCalled());
  expect(backend.updateDashboardBottleneck).toHaveBeenCalledWith("A",expect.objectContaining({min_officers_required:0,signal_status:"working",
    staffing_periods:[expect.objectContaining({start:"06:00",end:"07:00",required:0,label:"Quiet period"})]}));
});

it("submits selected times and keeps the editor open on an overlap error",async()=>{
  const saved=vi.fn(),close=vi.fn();
  vi.mocked(backend.saveDeploymentAssignment).mockRejectedValueOnce(new Error("Officer has an overlapping assignment."));
  render(<AssignmentEditor assignment={null} day={day} initialShift="morning" officers={officers} nodes={nodes} onClose={close} onSaved={saved}/>);
  fireEvent.change(screen.getByLabelText("Officer"),{target:{value:"1"}});
  fireEvent.change(screen.getByLabelText("Intersection"),{target:{value:"A"}});
  fireEvent.change(screen.getByLabelText("Start time"),{target:{value:"07:00"}});
  fireEvent.change(screen.getByLabelText("End time"),{target:{value:"08:00"}});
  fireEvent.click(screen.getByText("Save assignment"));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent","Officer has an overlapping assignment.");
  expect(close).not.toHaveBeenCalled();expect(saved).not.toHaveBeenCalled();
  expect(backend.saveDeploymentAssignment).toHaveBeenCalledWith(expect.objectContaining({officer:1,bottleneck:"A",
    start_time:`${day}T07:00:00+08:00`,end_time:`${day}T08:00:00+08:00`}),undefined);
});
