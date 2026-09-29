import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { popupCard, poiPopup } from "../app/services/mapPopup";
import { operationalDate, operationalTime, operationalHour } from "../app/services/operationalTime";
import { getCongestionSeverity, computeRelativeThresholds, getRelativeCongestionSeverity } from "../app/types/severity";
import { MarkerCreationForm } from "../app/pages/Dashboard/components/MarkerCreationForm";
import { IncidentTicker } from "../app/pages/Dashboard/components/IncidentTicker";
import { PublishScheduleButton } from "../app/components/PublishScheduleButton";
import { useDashboardData, dashboardEventNeedsRefresh } from "../app/hooks/useDashboardData";
import * as backend from "../app/services/backend";
vi.mock("../app/services/backend", async importOriginal => ({
  ...await importOriginal<typeof import("../app/services/backend")>(),
  createPOI: vi.fn(), createMapIncident: vi.fn(), createDashboardBottleneck: vi.fn(),
  previewPublication: vi.fn(), publishDeploymentsFromOptimization: vi.fn(),
  fetchDashboardSnapshot: vi.fn(), fetchDashboardOfficers: vi.fn(), fetchDeploymentSchedule: vi.fn(),
  fetchPOIs: vi.fn(), fetchCurrentWeather: vi.fn(), subscribeToDashboardStream: vi.fn(() => () => {}),
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

it.each(["poi", "incident"] as const)("failed %s POST keeps an unsaved draft without adding a marker", async kind => {
  const create = kind === "poi" ? backend.createPOI : backend.createMapIncident;
  vi.mocked(create).mockRejectedValueOnce(new Error("POST failed"));
  const onSaved = vi.fn();
  render(<MarkerCreationForm kind={kind} point={{latitude:0,longitude:0}} onSaved={onSaved} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(kind === "poi" ? "Name" : "Description"), {target:{value:"Draft"}});
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
  });
  vi.mocked(backend.publishDeploymentsFromOptimization).mockResolvedValue({created:2,shift:"morning"} as backend.PublishOptimizationDeploymentsResponse);
  render(<PublishScheduleButton runId="morning-run" date="2026-09-24" />);
  fireEvent.click(screen.getByText("Preview publication"));
  expect(await screen.findByText("morning")).toBeTruthy();
  expect(backend.publishDeploymentsFromOptimization).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Confirm publication"));
  await waitFor(()=>expect(backend.publishDeploymentsFromOptimization).toHaveBeenCalledWith(expect.objectContaining({
    run_id:"morning-run",operational_date:"2026-09-24",replace_existing:true,
    expected_revision:"reviewed-schedule",idempotency_key:expect.any(String),
  })));
});

it("a saved run with generated inputs explains why publication is unavailable", () => {
  render(<PublishScheduleButton runId="older-run" syntheticSources={["road_priority_weight", "tsi"]} />);
  expect(screen.getByRole("button", {name: "Preview publication"})).toHaveProperty("disabled", true);
  expect(screen.getByRole("alert").textContent).toContain("generated inputs (road_priority_weight, tsi)");
  expect(backend.previewPublication).not.toHaveBeenCalled();
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
  const {result} = renderHook(()=>useDashboardData("morning"));
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
