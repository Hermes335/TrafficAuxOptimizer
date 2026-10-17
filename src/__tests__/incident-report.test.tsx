import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { IncidentReport } from "../app/pages/IncidentReport";
import * as reporting from "../app/services/incidentReporting";

const auth = vi.hoisted(() => ({ isAuthenticated: false }));
vi.mock("../app/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../app/services/incidentReporting", async original => ({
  ...await original<typeof import("../app/services/incidentReporting")>(),
  fetchReportLocations: vi.fn(), fetchReportMeta: vi.fn(), fetchReportIncident: vi.fn(),
  submitIncidentReport: vi.fn(), saveReportIncident: vi.fn(), fetchIncidentPhoto: vi.fn(),
}));
// Exercise the usable fallback when the device cannot create a WebGL map.
vi.mock("maplibre-gl", () => ({ default: { Map: class { constructor() { throw new Error("WebGL unavailable"); } } } }));
const meta = { incident_types: [{value:"collision", label:"Collision"}, {value:"flooding", label:"Flooding"}],
  severities: [{value:"minor", label:"Minor"}, {value:"major", label:"Major"}, {value:"critical", label:"Critical"}] };
const existing = {id:42, incident_type:"flooding", severity:"critical", description:"Saved details", bottleneck:null,
  latitude:10.725, longitude:122.56, status:"active"};

beforeEach(() => {
  vi.resetAllMocks(); auth.isAuthenticated = false;
  vi.mocked(reporting.fetchReportLocations).mockResolvedValue([{id:"B-1",name:"Known intersection",latitude:10.72,longitude:122.56}]);
  vi.mocked(reporting.fetchReportMeta).mockResolvedValue(meta);
  vi.mocked(reporting.fetchReportIncident).mockResolvedValue(existing);
  vi.mocked(reporting.submitIncidentReport).mockResolvedValue({id:70,reference:"INC-70",status:"pending"});
  vi.mocked(reporting.saveReportIncident).mockResolvedValue(undefined);
});

function renderReport(path = "/incident-report") {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/incident-report" element={<IncidentReport />} />
    <Route path="/incident-report/:id" element={<IncidentReport />} />
  </Routes></MemoryRouter>);
}
async function fillReport() {
  await screen.findByRole("button", {name:"Collision"});
  await waitFor(() => expect(screen.getByRole("button", {name:"Submit report"})).toHaveProperty("disabled",false));
  fireEvent.change(screen.getByLabelText("Or choose a known intersection"), {target:{value:"B-1"}});
  fireEvent.change(screen.getByLabelText(/Description/), {target:{value:"A flooded lane near the intersection."}});
}

describe("public incident report", () => {
  it("requires an explicit location and submits exact manual coordinates without staff navigation", async () => {
    renderReport();
    await screen.findByRole("button", {name:"Collision"});
    expect(screen.queryByRole("link", {name:"Dashboard"})).toBeNull();
    expect(screen.queryByRole("link", {name:"Review public reports"})).toBeNull();
    fireEvent.change(screen.getByLabelText(/Description/), {target:{value:"Collision at the corner."}});
    fireEvent.click(screen.getByRole("button", {name:"Submit report"}));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Choose the incident location"));
    expect(reporting.submitIncidentReport).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Or choose a known intersection"), {target:{value:"B-1"}});
    fireEvent.click(screen.getByText("Enter coordinates manually"));
    fireEvent.change(screen.getByLabelText("Latitude"), {target:{value:"10.731234"}});
    fireEvent.change(screen.getByLabelText("Longitude"), {target:{value:"122.571234"}});
    fireEvent.click(screen.getByRole("button", {name:"Use these coordinates"}));
    fireEvent.click(screen.getByRole("button", {name:"Submit report"}));
    await screen.findByRole("heading", {name:"Report received for review"});
    expect(screen.getByText("INC-70")).toBeTruthy();
    expect(reporting.submitIncidentReport).toHaveBeenCalledWith(expect.objectContaining({latitude:10.731234,longitude:122.571234,
      incident_type:"collision",severity:"major",description:"Collision at the corner.",submission_key:expect.any(String)}));
    expect(vi.mocked(reporting.submitIncidentReport).mock.calls[0][0]).not.toHaveProperty("bottleneck");
    fireEvent.click(screen.getByRole("button", {name:"Report another incident"}));
    expect(screen.getByLabelText(/Description/)).toHaveProperty("value","");
    expect(screen.getByText("No pin selected")).toBeTruthy();
  });

  it("keeps the known intersection association when submitting its selected location", async () => {
    renderReport(); await fillReport();
    fireEvent.click(screen.getByRole("button", {name:"Submit report"}));
    await screen.findByText("INC-70");
    expect(reporting.submitIncidentReport).toHaveBeenCalledWith(expect.objectContaining({bottleneck:"B-1",latitude:10.72,longitude:122.56}));
  });

  it.each(["rejected", "resolved", "archived", "investigating"])("shows the actual %s status of a report already reviewed before a retry", async status => {
    vi.mocked(reporting.submitIncidentReport).mockRejectedValueOnce(new TypeError("Connection lost."))
      .mockResolvedValueOnce({id:70,reference:"INC-70",status});
    renderReport(); await fillReport();
    fireEvent.click(screen.getByRole("button", {name:"Submit report"}));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", {name:"Retry same report"}));
    await screen.findByRole("heading", {name:"Report status confirmed"});
    expect(screen.getByRole("status").textContent).toContain(`Current status: ${status[0].toUpperCase()}${status.slice(1)}`);
    expect(screen.queryByText(/will review your report/)).toBeNull();
  });

  it("keeps the exact payload and request key when retrying an uncertain submission", async () => {
    vi.mocked(reporting.submitIncidentReport).mockRejectedValueOnce(new TypeError("Connection lost."));
    renderReport(); await fillReport();
    fireEvent.click(screen.getByRole("button", {name:"Submit report"}));
    await screen.findByRole("alert");
    expect(screen.getByLabelText(/Description/)).toHaveProperty("value","A flooded lane near the intersection.");
    expect(screen.getByLabelText(/Description/)).toHaveProperty("disabled",true);
    const first = vi.mocked(reporting.submitIncidentReport).mock.calls[0][0];
    fireEvent.click(screen.getByRole("button", {name:"Retry same report"}));
    await screen.findByText("INC-70");
    expect(vi.mocked(reporting.submitIncidentReport).mock.calls[1][0]).toBe(first);
  });

  it("allows correction after a definite rejection and retains the draft", async () => {
    vi.mocked(reporting.submitIncidentReport).mockRejectedValueOnce(new reporting.ReportRequestError("Please correct the description.",400));
    renderReport(); await fillReport();
    fireEvent.click(screen.getByRole("button", {name:"Submit report"}));
    await screen.findByText("Please correct the description.");
    expect(screen.getByLabelText(/Description/)).toHaveProperty("disabled",false);
    const previousKey = vi.mocked(reporting.submitIncidentReport).mock.calls[0][0].submission_key;
    fireEvent.change(screen.getByLabelText(/Description/), {target:{value:"Corrected road description."}});
    fireEvent.click(screen.getByRole("button", {name:"Submit report"}));
    await screen.findByText("INC-70");
    expect(vi.mocked(reporting.submitIncidentReport).mock.calls[1][0].submission_key).not.toBe(previousKey);
    expect(vi.mocked(reporting.submitIncidentReport).mock.calls[1][0].description).toBe("Corrected road description.");
  });

  it("preserves an uncertain attempt through a later rate-limit rejection", async () => {
    vi.mocked(reporting.submitIncidentReport)
      .mockRejectedValueOnce(new reporting.ReportRequestError("Gateway timeout.",503))
      .mockRejectedValueOnce(new reporting.ReportRequestError("Too many requests.",429));
    renderReport(); await fillReport();
    fireEvent.click(screen.getByRole("button", {name:"Submit report"}));
    await screen.findByRole("alert");
    const original = vi.mocked(reporting.submitIncidentReport).mock.calls[0][0];
    fireEvent.click(screen.getByRole("button", {name:"Retry same report"}));
    await screen.findByText(/Too many requests/);
    expect(screen.getByLabelText(/Description/)).toHaveProperty("disabled",true);
    fireEvent.click(screen.getByRole("button", {name:"Retry same report"}));
    await screen.findByText("INC-70");
    expect(vi.mocked(reporting.submitIncidentReport).mock.calls.map(call => call[0])).toEqual([original,original,original]);
  });

  it("blocks duplicate submissions while a response is pending", async () => {
    let resolve!: (value: reporting.ReportReceipt) => void;
    vi.mocked(reporting.submitIncidentReport).mockReturnValue(new Promise(done => {resolve = done;}));
    const {container} = renderReport(); await fillReport();
    fireEvent.submit(container.querySelector("form")!); fireEvent.submit(container.querySelector("form")!);
    expect(reporting.submitIncidentReport).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", {name:"Sending..."})).toHaveProperty("disabled",true);
    await act(async () => resolve({id:70,reference:"INC-70",status:"pending"}));
  });

  it("shows an active receipt for authenticated staff reports", async () => {
    auth.isAuthenticated = true;
    vi.mocked(reporting.submitIncidentReport).mockResolvedValue({id:70,reference:"INC-70",status:"active"});
    renderReport(); await fillReport();
    expect(screen.getByRole("link", {name:"Dashboard"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name:"Submit report"}));
    await screen.findByRole("heading", {name:"Incident reported"});
  });

  it("keeps map and manual selection usable when known intersections fail to load", async () => {
    vi.mocked(reporting.fetchReportLocations).mockRejectedValue(new Error("Unavailable"));
    renderReport();
    await screen.findByText(/Known intersections are unavailable/);
    expect(screen.getByRole("button", {name:"Submit report"})).toHaveProperty("disabled",false);
  });
});

describe("staff incident editing", () => {
  it("waits for metadata and preserves saved type, severity, and coordinates", async () => {
    let resolve!: (value: typeof meta) => void;
    vi.mocked(reporting.fetchReportMeta).mockReturnValue(new Promise(done => {resolve = done;}));
    renderReport("/incident-report/42");
    expect(screen.getByRole("button", {name:"Update report"})).toHaveProperty("disabled",true);
    await act(async () => resolve(meta));
    await screen.findByDisplayValue("Saved details");
    fireEvent.click(screen.getByRole("button", {name:"Update report"}));
    await screen.findByText("Incident updated successfully.");
    expect(reporting.saveReportIncident).toHaveBeenCalledWith(42,{latitude:10.725,longitude:122.56,
      incident_type:"flooding",severity:"critical",description:"Saved details"});
  });

  it("updates exact coordinates when staff chooses another intersection", async () => {
    renderReport("/incident-report/42"); await screen.findByDisplayValue("Saved details");
    fireEvent.change(screen.getByLabelText("Or choose a known intersection"), {target:{value:"B-1"}});
    fireEvent.click(screen.getByRole("button", {name:"Update report"}));
    await screen.findByText("Incident updated successfully.");
    expect(reporting.saveReportIncident).toHaveBeenCalledWith(42,expect.objectContaining({bottleneck:"B-1",latitude:10.72,longitude:122.56,severity:"critical"}));
  });

  it("preserves a loaded incident association without snapping its exact coordinates", async () => {
    vi.mocked(reporting.fetchReportIncident).mockResolvedValue({...existing,bottleneck:"B-1"});
    renderReport("/incident-report/42"); await screen.findByDisplayValue("Saved details");
    fireEvent.click(screen.getByRole("button", {name:"Update report"}));
    await screen.findByText("Incident updated successfully.");
    expect(reporting.saveReportIncident).toHaveBeenCalledWith(42,expect.objectContaining({bottleneck:"B-1",latitude:10.725,longitude:122.56}));
  });

  it("prevents saving a failed load and supports retry", async () => {
    vi.mocked(reporting.fetchReportIncident).mockRejectedValueOnce(new Error("Incident not found"));
    renderReport("/incident-report/42"); await screen.findByRole("alert");
    expect(screen.getByRole("button", {name:"Update report"})).toHaveProperty("disabled",true);
    fireEvent.click(screen.getByRole("button", {name:"Retry loading"}));
    await screen.findByDisplayValue("Saved details");
    expect(screen.getByRole("button", {name:"Update report"})).toHaveProperty("disabled",false);
  });
});
