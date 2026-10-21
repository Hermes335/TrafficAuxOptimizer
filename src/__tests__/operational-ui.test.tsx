import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { popupCard, poiPopup } from "../app/services/mapPopup";
import { operationalDate, operationalTime, operationalHour } from "../app/services/operationalTime";
import { getCongestionSeverity, computeRelativeThresholds, getRelativeCongestionSeverity } from "../app/types/severity";
import { MarkerCreationForm } from "../app/pages/Dashboard/components/MarkerCreationForm";
import { IncidentTicker } from "../app/pages/Dashboard/components/IncidentTicker";
import { PublishScheduleButton } from "../app/components/PublishScheduleButton";
import { useDashboardData, dashboardEventNeedsRefresh } from "../app/hooks/useDashboardData";
import { WeatherProvider } from "../app/contexts/WeatherContext";
import * as backend from "../app/services/backend";
vi.mock("../app/services/backend", async importOriginal => ({
  ...await importOriginal<typeof import("../app/services/backend")>(),
  createPOI: vi.fn(), createMapIncident: vi.fn(), createDashboardBottleneck: vi.fn(),
  previewPublication: vi.fn(), publishDeploymentsFromOptimization: vi.fn(),
  fetchDashboardSnapshot: vi.fn(), fetchDashboardOfficers: vi.fn(), fetchDeploymentSchedule: vi.fn(),
  fetchPOIs: vi.fn(), fetchCurrentWeather: vi.fn(), fetchTrafficReadings: vi.fn().mockResolvedValue([]), subscribeToDashboardStream: vi.fn(() => () => {}),
}));
beforeEach(() => vi.clearAllMocks());

it("all popup text and editable values keep malicious HTML inert", () => {
  const payload = '<img src=x onerror="window.hacked=true"><script>alert(1)</script>';
  const card = popupCard(payload, [payload]);
  expect(card.textContent).toContain(payload);
  expect(card.querySelector("img,script")).toBeNull();
  const form = poiPopup({name: payload, category:"other",priority_boost:1} as backend.POI, vi.fn(), vi.fn());
  expect(form.querySelector("input")?.value).toBe(payload);
  expect(form.querySelector("img,script")).toBeNull();
});

it("failed POI deletion reports the error and keeps the popup", async () => {
  const remove = vi.fn().mockRejectedValue(new Error("Delete denied"));
  const form = poiPopup({name:"Saved",category:"other",priority_boost:1} as backend.POI, vi.fn(), remove);
  document.body.append(form);
  fireEvent.click(Array.from(form.querySelectorAll("button")).find(b=>b.textContent === "Delete")!);
  await waitFor(() => expect(form.querySelector('[role="alert"]')?.textContent).toBe("Delete denied"));
  expect(document.body.contains(form)).toBe(true);
  form.remove();
});

it.each(["poi", "bottleneck"] as const)("failed %s POST keeps an unsaved draft without adding a marker", async kind => {
  const create = kind === "poi" ? backend.createPOI : backend.createDashboardBottleneck;
  vi.mocked(create).mockRejectedValueOnce(new Error("POST failed"));
  const onSaved = vi.fn();
  render(<MarkerCreationForm kind={kind} point={{latitude:0,longitude:0}} onSaved={onSaved} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Name"), {target:{value:"Draft"}});
  fireEvent.click(screen.getByText("Create"));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent","POST failed");
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByText(/unsaved/)).toBeTruthy();
});

it("successful save refreshes persisted data; refresh retry never repeats POST", async () => {
  vi.mocked(backend.createPOI).mockResolvedValue({id:991,poi_id:"POI-persisted"} as backend.POI);
  const onSaved = vi.fn().mockRejectedValueOnce(new Error("Refresh failed")).mockResolvedValueOnce(undefined);
  render(<MarkerCreationForm kind="poi" point={{latitude:0,longitude:0}} onSaved={onSaved} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Name"),{target:{value:"Saved"}});
  fireEvent.click(screen.getByText("Create"));
  await screen.findByText("Retry refresh");
  fireEvent.click(screen.getByText("Retry refresh"));
  await waitFor(()=>expect(onSaved).toHaveBeenCalledTimes(2));
  expect(backend.createPOI).toHaveBeenCalledTimes(1);
  expect(backend.createPOI).toHaveBeenCalledWith(expect.not.objectContaining({id:expect.anything()}));
});

it("repositioning a collapsed marker keeps its draft and saves the new location", async () => {
  vi.mocked(backend.createPOI).mockResolvedValue({id:992} as backend.POI);
  const onSaved = vi.fn().mockResolvedValue(undefined);
  const props = {kind:"poi" as const, onSaved, onCancel:vi.fn()};
  const {rerender} = render(<MarkerCreationForm {...props} point={{latitude:10.7,longitude:122.5}} />);
  fireEvent.change(screen.getByLabelText("Name"), {target:{value:"School draft"}});
  fireEvent.change(screen.getByLabelText("Type"), {target:{value:"school"}});
  fireEvent.click(screen.getByRole("button", {name:"Choose location on map"}));
  expect(screen.queryByRole("button", {name:"Create"})).toBeNull();
  expect(backend.createPOI).not.toHaveBeenCalled();
  expect(screen.getByRole("button", {name:"Continue marker details"})).toHaveProperty("ariaExpanded", "false");
  rerender(<MarkerCreationForm {...props} point={{latitude:10.73,longitude:122.57}} />);
  await screen.findByRole("button", {name:"Create"});
  expect(screen.getByLabelText("Name")).toHaveProperty("value", "School draft");
  expect(screen.getByLabelText("Type")).toHaveProperty("value", "school");
  fireEvent.click(screen.getByRole("button", {name:"Create"}));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(backend.createPOI).toHaveBeenCalledExactlyOnceWith({name:"School draft",category:"school",latitude:10.73,longitude:122.57,priority_boost:1});
});

it("failed incident resolution keeps the saved incident visible", async () => {
  render(<MemoryRouter><IncidentTicker incidents={[{id:12,text:"Keep me",type:"major"}]} onRemoveIncident={vi.fn().mockRejectedValue(new Error("Resolution failed"))} /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button",{name:"Remove incident"}));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent","Resolution failed");
  expect(screen.getByText("Keep me")).toBeTruthy();
});

it("operational dates and both shift times are independent of browser timezone", () => {
  expect(operationalDate(new Date("2026-09-24T16:01:00Z"))).toBe("2026-09-25");
  expect(operationalHour("2026-09-23T22:00:00Z")).toBe(6);
  expect(operationalHour("2026-09-24T06:00:00Z")).toBe(14);
  expect(operationalTime("2026-09-23T22:00:00Z")).toMatch(/6:00/);
});

it("severity remains fixed when low-TSI datasets are filtered", () => {
  const node = {status:"critical",tsi:0.15};
  const thresholds = computeRelativeThresholds([{tsi:0.01},{tsi:0.05},node,{tsi:0.2}]);
  expect(getRelativeCongestionSeverity(node,thresholds)).toBe("free");
  expect(getCongestionSeverity({status:"normal",tsi:0.799})).toBe("heavy");
  expect(getCongestionSeverity({status:"normal",tsi:0.8})).toBe("critical");
});

it("publication preview uses saved run shift and requires confirmation", async () => {
  vi.mocked(backend.previewPublication).mockResolvedValue({
    run_id:"morning-run",shift:"morning",start_time:"2026-09-23T22:00:00Z",end_time:"2026-09-24T06:00:00Z",
    operational_date:"2026-09-24",created:2,skipped:[],staff_added:[2,3],staff_removed:[1],replaced:1,conflicts:[],
    expected_revision:"reviewed-schedule",captured_at:"2026-09-23T22:00:00Z",input_issues:[],added_assignments:[],removed_assignments:[],
    skill_warnings:["Officer skills changed after this recommendation was generated."],
  });
  vi.mocked(backend.publishDeploymentsFromOptimization).mockResolvedValue({created:2,shift:"morning",skill_warnings:["Published with the reviewed skill advisory."]} as backend.PublishOptimizationDeploymentsResponse);
  const {rerender} = render(<MemoryRouter><PublishScheduleButton runId="morning-run" date="2026-09-24" /></MemoryRouter>);
  fireEvent.click(screen.getByText("Preview publication"));
  expect(await screen.findByText("morning")).toBeTruthy();
  expect(backend.publishDeploymentsFromOptimization).not.toHaveBeenCalled();
  expect(screen.getByRole("region", {name: "Skill review notes"}).textContent).toContain("Officer skills changed");
  expect(screen.getByText("Confirm publication")).toHaveProperty("disabled", false);
  fireEvent.click(screen.getByText("Confirm publication"));
  await waitFor(()=>expect(backend.publishDeploymentsFromOptimization).toHaveBeenCalledWith(expect.objectContaining({
    run_id:"morning-run",operational_date:"2026-09-24",replace_existing:true,
    expected_revision:"reviewed-schedule",idempotency_key:expect.any(String),
  })));
  expect(await screen.findByText("Published schedule skill notes")).toBeTruthy();
  expect(screen.getByText("Published with the reviewed skill advisory.")).toBeTruthy();
  expect(screen.getByRole("link", {name: "Open published schedule"}).getAttribute("href")).toBe("/gantt-chart?date=2026-09-24&shift=morning");
  rerender(<MemoryRouter><PublishScheduleButton runId="another-run" date="2026-09-24" /></MemoryRouter>);
  expect(screen.queryByRole("link", {name: "Open published schedule"})).toBeNull();
});

it("publishes a timed recommendation using its saved assignment windows", async () => {
  vi.mocked(backend.previewPublication).mockResolvedValue({
    run_id:"timed-run",shift:"afternoon",start_time:"2026-10-02T06:00:00Z",end_time:"2026-10-02T14:00:00Z",
    operational_date:"2026-10-02",created:2,skipped:[],staff_added:[2,3],staff_removed:[],replaced:0,conflicts:[],
    expected_revision:"timed-review",captured_at:"2026-10-02T06:00:00Z",input_issues:[],added_assignments:[],removed_assignments:[],
    time_periods:[{start_time:"2026-10-02T06:00:00Z",end_time:"2026-10-02T14:00:00Z",assigned_officers:2,reserve_officers:0}],
  } as backend.PublicationPreview);
  vi.mocked(backend.publishDeploymentsFromOptimization).mockResolvedValue({created:2,shift:"afternoon"} as backend.PublishOptimizationDeploymentsResponse);
  render(<MemoryRouter><PublishScheduleButton runId="timed-run" date="2026-10-02" /></MemoryRouter>);
  fireEvent.click(screen.getByText("Preview publication"));
  await screen.findByText("afternoon");
  fireEvent.click(screen.getByText("Confirm publication"));
  await waitFor(() => expect(backend.publishDeploymentsFromOptimization).toHaveBeenCalled());
  const request = vi.mocked(backend.publishDeploymentsFromOptimization).mock.calls[0][0];
  expect(request).toMatchObject({run_id:"timed-run",expected_revision:"timed-review"});
  expect(request).not.toHaveProperty("start_time");
  expect(request).not.toHaveProperty("end_time");
});

const publicationPreview: backend.PublicationPreview = {
  run_id: "saved-run", shift: "morning", start_time: "2026-10-21T06:00:00+08:00", end_time: "2026-10-21T14:00:00+08:00",
  operational_date: "2026-10-21", created: 1, skipped: [], staff_added: [1], staff_removed: [], replaced: 0, conflicts: [],
  expected_revision: "review-1", captured_at: "2026-10-21T05:55:00+08:00", input_issues: [], added_assignments: [], removed_assignments: [],
};
const staleInputError = () => Object.assign(new Error("Inputs are stale or unverified."), {
  status: 409, input_issues: ["Weather: input is stale.", "Atrium: input is not verified."],
});

it("shows the specific inputs from a failed preview while keeping publication disabled", async () => {
  vi.mocked(backend.previewPublication).mockRejectedValueOnce(staleInputError());
  render(<MemoryRouter><PublishScheduleButton runId="saved-run" date="2026-10-21" /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", {name: "Preview publication"}));
  await screen.findByText("Weather: input is stale.");
  expect(screen.getByRole("list", {name: "Input issues blocking publication"}).textContent).toContain("Atrium: input is not verified.");
  expect(screen.getByText("Cannot publish: Inputs are stale or unverified.")).toBeTruthy();
  expect(screen.getByText(/Refresh preview rechecks this run's saved inputs/)).toBeTruthy();
  expect(screen.getByRole("button", {name: "Confirm publication"})).toHaveProperty("disabled", true);
  expect(backend.publishDeploymentsFromOptimization).not.toHaveBeenCalled();
  expect(backend.previewPublication).toHaveBeenCalledWith(expect.objectContaining({input_override_reason: ""}));
});

it.each(["refresh", "date change", "reopen"] as const)("clears rejected input details on %s before the next preview resolves", async action => {
  let resolvePreview!: (value: backend.PublicationPreview) => void;
  const nextPreview = new Promise<backend.PublicationPreview>(resolve => {resolvePreview = resolve;});
  vi.mocked(backend.previewPublication).mockRejectedValueOnce(staleInputError()).mockReturnValueOnce(nextPreview);
  render(<MemoryRouter><PublishScheduleButton runId="saved-run" date="2026-10-21" /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", {name: "Preview publication"}));
  await screen.findByText("Weather: input is stale.");
  if (action === "refresh") fireEvent.click(screen.getByRole("button", {name: "Refresh preview"}));
  else if (action === "date change") fireEvent.change(screen.getByLabelText("Operational date (Asia/Manila)"), {target: {value: "2026-10-22"}});
  else {
    fireEvent.click(screen.getByRole("button", {name: "Cancel"}));
    fireEvent.click(screen.getByRole("button", {name: "Preview publication"}));
  }
  expect(screen.queryByText("Weather: input is stale.")).toBeNull();
  expect(screen.queryByRole("list", {name: "Input issues blocking publication"})).toBeNull();
  expect(screen.getByRole("button", {name: "Confirm publication"})).toHaveProperty("disabled", true);
  await act(async () => resolvePreview(publicationPreview));
  await waitFor(() => expect(screen.getByRole("button", {name: "Confirm publication"})).toHaveProperty("disabled", false));
  expect(screen.queryByText("Atrium: input is not verified.")).toBeNull();
  expect(backend.publishDeploymentsFromOptimization).not.toHaveBeenCalled();
});

it("shows commit rejection input details and requires a fresh review before another publication attempt", async () => {
  vi.mocked(backend.previewPublication).mockResolvedValue(publicationPreview);
  vi.mocked(backend.publishDeploymentsFromOptimization).mockRejectedValueOnce(staleInputError());
  render(<MemoryRouter><PublishScheduleButton runId="saved-run" date="2026-10-21" /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", {name: "Preview publication"}));
  await waitFor(() => expect(screen.getByRole("button", {name: "Confirm publication"})).toHaveProperty("disabled", false));
  fireEvent.click(screen.getByRole("button", {name: "Confirm publication"}));
  await screen.findByText("Weather: input is stale.");
  expect(screen.getByRole("button", {name: "Confirm publication"})).toHaveProperty("disabled", true);
  expect(screen.queryByRole("button", {name: "Retry publication"})).toBeNull();
  fireEvent.click(screen.getByRole("button", {name: "Refresh preview"}));
  expect(screen.queryByText("Weather: input is stale.")).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", {name: "Confirm publication"})).toHaveProperty("disabled", false));
  expect(backend.publishDeploymentsFromOptimization).toHaveBeenCalledTimes(1);
});

it("a saved run with generated inputs explains why publication is unavailable", () => {
  render(<MemoryRouter><PublishScheduleButton runId="older-run" syntheticSources={["road_priority_weight", "tsi"]} /></MemoryRouter>);
  expect(screen.getByRole("button", {name: "Preview publication"})).toHaveProperty("disabled", true);
  expect(screen.getByRole("alert").textContent).toContain("generated inputs (road_priority_weight, tsi)");
  expect(backend.previewPublication).not.toHaveBeenCalled();
});

it.each([
  {mode:"operational", syntheticSources:["tsi"], reason:"generated inputs (tsi)"},
  {mode:"shadow", syntheticSources:[], reason:"Shadow recommendation"},
])("compact $mode warnings open by tap without requesting publication", async ({mode, syntheticSources, reason}) => {
  render(<MemoryRouter><PublishScheduleButton runId="blocked-run" compact mode={mode} syntheticSources={syntheticSources} /></MemoryRouter>);
  const trigger = screen.getByRole("button", {name:"Why publication is unavailable"});
  expect(trigger).toHaveProperty("disabled", false);
  fireEvent.click(trigger);
  expect((await screen.findByText(text => text.includes(reason))).textContent).toContain(reason);
  expect(screen.queryByText("Review schedule replacement")).toBeNull();
  expect(backend.previewPublication).not.toHaveBeenCalled();
  expect(backend.publishDeploymentsFromOptimization).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name:"Got it"}));
  await waitFor(() => expect(screen.queryByText("Cannot publish this run")).toBeNull());
});

it("live deployment and incident events refresh all affected collections; failures preserve data", async () => {
  let receive: (event: backend.LiveDashboardEvent) => void = () => {};
  let connection: (state: backend.ConnectionState) => void = () => {};
  vi.mocked(backend.subscribeToDashboardStream).mockImplementation((cb,_token,onConnection) => {receive=cb; connection=onConnection!; return () => {};});
  const snapshot = {...backend.getFallbackDashboardSnapshot(),incidents:[{id:2,text:"Saved",type:"major" as const}]};
  vi.mocked(backend.fetchDashboardSnapshot).mockResolvedValue(snapshot);
  vi.mocked(backend.fetchPOIs).mockResolvedValue([]);
  vi.mocked(backend.fetchDashboardOfficers).mockResolvedValue([]);
  vi.mocked(backend.fetchDeploymentSchedule).mockResolvedValue([]);
  vi.mocked(backend.fetchCurrentWeather).mockResolvedValue({} as backend.WeatherCurrentSnapshot);
  const {result} = renderHook(()=>useDashboardData("morning"), {wrapper: WeatherProvider});
  await waitFor(()=>expect(result.current.lastRefresh).not.toBeNull());
  receive({event:"deployment_changed"});
  await waitFor(()=>expect(backend.fetchDashboardOfficers).toHaveBeenCalledTimes(2));
  receive({event:"incident_updated"});
  await waitFor(()=>expect(backend.fetchDashboardSnapshot).toHaveBeenCalledTimes(3));
  vi.mocked(backend.fetchDashboardSnapshot).mockRejectedValue(new Error("Offline"));
  receive({event:"incident_reported"});
  await waitFor(()=>expect(result.current.loadError).toBe("Dashboard: Offline"));
  expect(result.current.dashboardSnapshot.incidents[0].id).toBe(2);
  connection("disconnected");
  await waitFor(()=>expect(result.current.connectionState).toBe("disconnected"));
  expect(dashboardEventNeedsRefresh("optimization_progress")).toBe(false);
});
