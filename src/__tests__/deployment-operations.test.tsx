import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OperationsPanel } from "../app/pages/GanttChart/OperationsPanel";
import { GanttTimeline } from "../app/pages/GanttChart/GanttTimeline";
import { AreaFilter, inArea } from "../app/components/AreaFilter";
import * as backend from "../app/services/backend";

vi.mock("../app/services/backend",async original=>({...await original<typeof import("../app/services/backend")>(),deploymentOperation:vi.fn()}));
const nodes=[{id:"A",name:"Intersection A",area_name:"Prime State"}];
const officers:backend.DashboardOfficerRecord[]=[{id:1,name:"Officer Alpha",badge_number:"ALPHA",shift:"morning",status:"available",skills:[]}];
const blocks:backend.OfficerTimeBlock[]=[{id:1,officer:1,officer_name:"Officer Alpha",badge_number:"ALPHA",kind:"break",start_time:"2099-01-01T08:00:00+08:00",end_time:"2099-01-01T09:00:00+08:00",note:"Meal"}];
beforeEach(()=>{vi.resetAllMocks();vi.mocked(backend.deploymentOperation).mockImplementation(async(path,payload)=>payload?{}:path.startsWith("review/")?{needs_review:true,scope:"Remaining schedule",issues:[{bottleneck:"A",reason:"Officer no longer eligible",assignment_ids:[8]}]}:path.startsWith("time-blocks/")?blocks:[]);});

it("uses exact area names and supports ungrouped intersections",()=>{
  const change=vi.fn();render(<AreaFilter nodes={[...nodes,...nodes,{area_name:""}]} value="" onChange={change}/>);
  expect(screen.getAllByText("Prime State")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Area filter"),{target:{value:"Prime State"}});
  expect(change).toHaveBeenCalledWith("Prime State");expect(inArea({},"__ungrouped")).toBe(true);expect(inArea(nodes[0],"Prime")).toBe(false);
});

it("renders explicit break reservations on the officer timeline",()=>{
  render(<GanttTimeline deployments={[]} blocks={blocks} officers={officers} viewMode="officer" day="2099-01-01" shift="morning"/>);
  const bar=screen.getByText("Break");expect(bar.style.left).toBe("25%");expect(bar.style.width).toBe("12.5%");
});

it("shows affected assignments and sends zero actual headcount in field feedback",async()=>{
  const changed=vi.fn(),onBlocks=vi.fn();render(<OperationsPanel day="2099-01-01" shift="morning" area="" nodes={nodes} officers={officers} canManage refreshKey={0} onBlocks={onBlocks} onChanged={changed}/>);
  expect(await screen.findByText(/Schedule needs review/)).toBeTruthy();expect(screen.getByText(/assignments 8/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Observed intersection"),{target:{value:"A"}});fireEvent.change(screen.getByLabelText("Observed time"),{target:{value:"07:30"}});fireEvent.change(screen.getByLabelText("Officers present"),{target:{value:"0"}});
  fireEvent.click(screen.getByText("Save observation"));
  await waitFor(()=>expect(changed).toHaveBeenCalled());expect(backend.deploymentOperation).toHaveBeenCalledWith("observations/",expect.objectContaining({actual_officers:0,observed_at:"2099-01-01T07:30:00+08:00",bottleneck:"A",traffic:"free"}));
});

it("preserves reservation form values and displays an overlap error",async()=>{
  vi.mocked(backend.deploymentOperation).mockImplementation(async(path,payload)=>{if(payload)throw new Error("Officer has overlapping assignment");return path.startsWith("review/")?{needs_review:false,scope:"Remaining schedule",issues:[]}:[];});
  render(<OperationsPanel day="2099-01-01" shift="morning" area="" nodes={nodes} officers={officers} canManage refreshKey={0} onBlocks={vi.fn()} onChanged={vi.fn()}/>);
  await screen.findByText(/no issues detected/);
  fireEvent.change(screen.getByLabelText("Officer"),{target:{value:"1"}});fireEvent.change(screen.getByLabelText("Starts"),{target:{value:"08:00"}});fireEvent.change(screen.getByLabelText("Ends"),{target:{value:"09:00"}});
  fireEvent.click(screen.getByText("Reserve time"));expect(await screen.findByRole("alert")).toHaveProperty("textContent",expect.stringContaining("overlapping"));expect(screen.getByLabelText("Starts")).toHaveProperty("value","08:00");
});
