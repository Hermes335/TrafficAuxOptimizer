import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router";
import { PageStateProvider, PageStateScope } from "../app/contexts/PageStateContext";
import { IncidentReport } from "../app/pages/IncidentReport";
import * as reporting from "../app/services/incidentReporting";

vi.mock("../app/contexts/AuthContext", () => ({useAuth: () => ({isAuthenticated: true})}));
vi.mock("../app/services/incidentReporting", async original => ({
  ...await original<typeof import("../app/services/incidentReporting")>(),
  fetchReportLocations: vi.fn(), fetchReportMeta: vi.fn(), fetchReportIncident: vi.fn(),
  submitIncidentReport: vi.fn(), saveReportIncident: vi.fn(), fetchIncidentPhoto: vi.fn(),
}));
vi.mock("maplibre-gl", () => ({default: {Map: class {constructor() {throw new Error("No WebGL");}}}}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(reporting.fetchReportLocations).mockResolvedValue([{id:"A",name:"Intersection A",latitude:10.72,longitude:122.56}]);
  vi.mocked(reporting.fetchReportMeta).mockResolvedValue({incident_types:[{value:"collision",label:"Collision"},{value:"flooding",label:"Flooding"}],severities:[{value:"major",label:"Major"},{value:"critical",label:"Critical"}]});
  vi.mocked(reporting.fetchReportIncident).mockImplementation(async id => ({id,description:`Saved ${id}`,incident_type:"collision",severity:"major",latitude:10.7,longitude:122.5,bottleneck:null,status:"active"}));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function Report() {
  const location = useLocation();
  return <PageStateScope key={location.pathname} name={location.pathname}><IncidentReport /></PageStateScope>;
}
function setup(path = "/incident-report") {
  return render(<PageStateProvider><MemoryRouter initialEntries={[path]}>
    <nav><Link to="/incident-report">New report</Link><Link to="/incident-report/42">Edit 42</Link><Link to="/incident-report/43">Edit 43</Link><Link to="/away">Leave page</Link></nav>
    <Routes><Route path="/away" element={<p>Other page</p>} /><Route path="/incident-report" element={<Report />} /><Route path="/incident-report/:id" element={<Report />} /></Routes>
  </MemoryRouter></PageStateProvider>);
}
async function fill() {
  await waitFor(() => expect(screen.getByRole("button",{name:"Submit report"})).toHaveProperty("disabled",false));
  fireEvent.change(screen.getByLabelText("Or choose a known intersection"),{target:{value:"A"}});
  fireEvent.change(screen.getByLabelText(/Description/),{target:{value:"Unsaved flooding report"}});
}
async function leaveAndReturn() {
  fireEvent.click(screen.getByText("Leave page"));await screen.findByText("Other page");
  fireEvent.click(screen.getByText("New report"));
  await screen.findByRole("button",{name:"Collision"});
}
async function leaveAndReturnToEdit() {
  fireEvent.click(screen.getByText("Leave page")); await screen.findByText("Other page");
  fireEvent.click(screen.getByText("Edit 42"));
  await waitFor(() => expect(screen.getByRole("button", {name: "Update report"})).toHaveProperty("disabled", false));
}

it("restores incident fields and attached photo after navigation without keeping the page mounted", async () => {
  const originalURL = URL;
  const revoke = vi.fn();
  vi.stubGlobal("URL", class extends originalURL {static createObjectURL = vi.fn(() => "blob:photo"); static revokeObjectURL = revoke;});
  setup();await fill();
  fireEvent.click(screen.getByRole("button",{name:"Flooding"}));fireEvent.click(screen.getByRole("button",{name:"Critical"}));
  fireEvent.change(screen.getByLabelText("Choose photo"),{target:{files:[new File(["photo"],"incident.jpg",{type:"image/jpeg"})]}});
  await screen.findByAltText("Photo attached to your report");
  await leaveAndReturn();
  await screen.findByAltText("Photo attached to your report");
  expect(revoke).toHaveBeenCalledWith("blob:photo");
  expect(screen.getByLabelText(/Description/)).toHaveProperty("value","Unsaved flooding report");
  expect(screen.getByRole("button",{name:"Flooding"}).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button",{name:"Critical"}).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText(/Selected:/).textContent).toContain("10.720000, 122.560000");
});

it("preserves an uncertain submission and its exact retry payload when navigating away and back", async () => {
  vi.mocked(reporting.submitIncidentReport).mockRejectedValueOnce(new TypeError("Connection lost"))
    .mockResolvedValueOnce({id:7,reference:"REF-7",status:"pending"});
  setup();await fill();fireEvent.click(screen.getByRole("button",{name:"Submit report"}));
  await screen.findByRole("alert");const original=vi.mocked(reporting.submitIncidentReport).mock.calls[0][0];
  await leaveAndReturn();
  await waitFor(() => expect(screen.getByRole("button",{name:"Retry same report"})).toHaveProperty("disabled",false));
  expect(screen.getByLabelText(/Description/)).toHaveProperty("disabled",true);
  fireEvent.click(screen.getByRole("button",{name:"Retry same report"}));await screen.findByText("REF-7");
  expect(vi.mocked(reporting.submitIncidentReport).mock.calls[1][0]).toBe(original);
  fireEvent.click(screen.getByText("Report another incident"));
  await leaveAndReturn();
  expect(screen.getByLabelText(/Description/)).toHaveProperty("value","");
  expect(screen.queryByText(/Selected:/)).toBeNull();
});

it("does not resubmit a request in flight and displays its receipt when returning", async () => {
  let finish!: (value: reporting.ReportReceipt) => void;
  vi.mocked(reporting.submitIncidentReport).mockReturnValueOnce(new Promise(resolve => {finish=resolve;}));
  setup();await fill();fireEvent.click(screen.getByRole("button",{name:"Submit report"}));
  await leaveAndReturn();
  expect(screen.getByRole("button",{name:"Sending..."})).toHaveProperty("disabled",true);
  await act(async () => finish({id:8,reference:"REF-8",status:"pending"}));
  await screen.findByText("REF-8");expect(reporting.submitIncidentReport).toHaveBeenCalledTimes(1);
});

it("keeps edit drafts separate by incident and refreshes metadata without overwriting a draft", async () => {
  setup("/incident-report/42");await screen.findByDisplayValue("Saved 42");
  fireEvent.change(screen.getByLabelText(/Description/),{target:{value:"Unfinished edit 42"}});
  fireEvent.click(screen.getByText("Edit 43"));await screen.findByDisplayValue("Saved 43");
  fireEvent.click(screen.getByText("Edit 42"));await screen.findByDisplayValue("Unfinished edit 42");
  await waitFor(() => expect(screen.getByRole("button",{name:"Update report"})).toHaveProperty("disabled",false));
  expect(reporting.fetchReportIncident).toHaveBeenCalledTimes(3);
});

it("preserves unapplied manual coordinates when an unchanged incident is fetched after navigation", async () => {
  setup("/incident-report/42"); await screen.findByDisplayValue("Saved 42");
  fireEvent.click(screen.getByText("Enter coordinates manually"));
  fireEvent.change(screen.getByLabelText("Latitude"), {target:{value:"10.74123"}});
  fireEvent.change(screen.getByLabelText("Longitude"), {target:{value:"122.61234"}});
  await leaveAndReturnToEdit();
  expect(reporting.fetchReportIncident).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText("Latitude")).toHaveProperty("value", "10.74123");
  expect(screen.getByLabelText("Longitude")).toHaveProperty("value", "122.61234");
  expect(screen.getByText(/Selected:/).textContent).toContain("10.700000, 122.500000");
  fireEvent.click(screen.getByRole("button", {name:"Use these coordinates"}));
  expect(screen.getByText(/Selected:/).textContent).toContain("10.741230, 122.612340");
});

it("syncs manual coordinates when the incident location changes on the server", async () => {
  setup("/incident-report/42"); await screen.findByDisplayValue("Saved 42");
  fireEvent.click(screen.getByText("Enter coordinates manually"));
  fireEvent.change(screen.getByLabelText("Latitude"), {target:{value:"10.74123"}});
  fireEvent.change(screen.getByLabelText("Longitude"), {target:{value:"122.61234"}});
  vi.mocked(reporting.fetchReportIncident).mockResolvedValue({id:42,description:"Saved 42",incident_type:"collision",severity:"major",latitude:10.75,longitude:122.6,bottleneck:null,status:"active"});
  await leaveAndReturnToEdit();
  expect(screen.getByLabelText("Latitude")).toHaveProperty("value", "10.750000");
  expect(screen.getByLabelText("Longitude")).toHaveProperty("value", "122.600000");
  fireEvent.click(screen.getByRole("button", {name:"Use these coordinates"}));
  expect(screen.getByText(/Selected:/).textContent).toContain("10.750000, 122.600000");
});

it("refreshes untouched incident details and coordinates before a later edit is saved", async () => {
  setup("/incident-report/42"); await screen.findByDisplayValue("Saved 42");
  vi.mocked(reporting.fetchReportIncident).mockResolvedValue({id:42,description:"Updated by another officer",incident_type:"flooding",severity:"major",latitude:10.75,longitude:122.6,bottleneck:null,status:"active"});
  await leaveAndReturnToEdit();
  expect(screen.getByLabelText(/Description/)).toHaveProperty("value", "Updated by another officer");
  expect(screen.getByRole("button", {name:"Flooding"}).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText(/Selected:/).textContent).toContain("10.750000, 122.600000");
  fireEvent.click(screen.getByRole("button", {name:"Critical"}));
  fireEvent.click(screen.getByRole("button", {name:"Update report"}));
  await screen.findByText("Incident updated successfully.");
  expect(reporting.saveReportIncident).toHaveBeenCalledWith(42, {latitude:10.75,longitude:122.6,incident_type:"flooding",severity:"critical",description:"Updated by another officer"});
});

it("retains a changed field while merging unrelated server updates into the draft", async () => {
  setup("/incident-report/42"); await screen.findByDisplayValue("Saved 42");
  fireEvent.change(screen.getByLabelText(/Description/), {target:{value:"My unfinished description"}});
  vi.mocked(reporting.fetchReportIncident).mockResolvedValue({id:42,description:"Saved 42",incident_type:"flooding",severity:"critical",latitude:10.76,longitude:122.61,bottleneck:null,status:"active"});
  await leaveAndReturnToEdit();
  expect(screen.getByLabelText(/Description/)).toHaveProperty("value", "My unfinished description");
  expect(screen.getByRole("button", {name:"Flooding"}).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", {name:"Critical"}).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText(/Selected:/).textContent).toContain("10.760000, 122.610000");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps same-field conflicts across navigation until the staff member chooses a value", async () => {
  setup("/incident-report/42"); await screen.findByDisplayValue("Saved 42");
  fireEvent.change(screen.getByLabelText(/Description/), {target:{value:"My description"}});
  fireEvent.change(screen.getByLabelText("Or choose a known intersection"), {target:{value:"A"}});
  vi.mocked(reporting.fetchReportIncident).mockResolvedValue({id:42,description:"Another officer's description",incident_type:"collision",severity:"major",latitude:10.77,longitude:122.62,bottleneck:null,status:"active"});
  fireEvent.click(screen.getByText("Leave page")); fireEvent.click(screen.getByText("Edit 42"));
  await screen.findByRole("button", {name:"Keep my description"});
  expect(screen.getByRole("button", {name:"Update report"})).toHaveProperty("disabled", true);
  expect(screen.getByLabelText(/Description/)).toHaveProperty("value", "My description");
  fireEvent.submit(screen.getByRole("button", {name:"Update report"}).closest("form")!);
  expect(reporting.saveReportIncident).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Leave page")); fireEvent.click(screen.getByText("Edit 42"));
  await screen.findByRole("button", {name:"Keep my description"});
  await waitFor(() => expect(screen.getByRole("button", {name:"Keep my description"})).toHaveProperty("disabled", false));
  fireEvent.click(screen.getByRole("button", {name:"Keep my description"}));
  fireEvent.click(screen.getByRole("button", {name:"Use latest location"}));
  expect(screen.getByRole("button", {name:"Update report"})).toHaveProperty("disabled", false);
  expect(screen.getByLabelText(/Description/)).toHaveProperty("value", "My description");
  expect(screen.getByText(/Selected:/).textContent).toContain("10.770000, 122.620000");
  expect(screen.getByLabelText("Latitude")).toHaveProperty("value", "10.770000");
  expect(screen.getByLabelText("Longitude")).toHaveProperty("value", "122.620000");
  fireEvent.click(screen.getByRole("button", {name:"Update report"}));
  await screen.findByText("Incident updated successfully.");
  expect(reporting.saveReportIncident).toHaveBeenCalledWith(42, {latitude:10.77,longitude:122.62,incident_type:"collision",severity:"major",description:"My description"});
});

it("advances the saved draft baseline so future server changes can refresh it", async () => {
  setup("/incident-report/42"); await screen.findByDisplayValue("Saved 42");
  fireEvent.change(screen.getByLabelText(/Description/), {target:{value:"  My saved description  "}});
  fireEvent.click(screen.getByRole("button", {name:"Update report"}));
  await screen.findByText("Incident updated successfully.");
  expect(screen.getByLabelText(/Description/)).toHaveProperty("value", "My saved description");
  vi.mocked(reporting.fetchReportIncident).mockResolvedValue({id:42,description:"A later staff update",incident_type:"collision",severity:"major",latitude:10.7,longitude:122.5,bottleneck:null,status:"active"});
  await leaveAndReturnToEdit();
  expect(screen.getByLabelText(/Description/)).toHaveProperty("value", "A later staff update");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("waits for an edit already in flight before refreshing the returning form", async () => {
  let finish!: () => void;
  vi.mocked(reporting.saveReportIncident).mockReturnValueOnce(new Promise(resolve => {finish = resolve;}));
  setup("/incident-report/42"); await screen.findByDisplayValue("Saved 42");
  fireEvent.change(screen.getByLabelText(/Description/), {target:{value:"Saved after navigation"}});
  fireEvent.click(screen.getByRole("button", {name:"Update report"}));
  fireEvent.click(screen.getByText("Leave page")); fireEvent.click(screen.getByText("Edit 42"));
  expect(screen.getByRole("button", {name:"Sending..."})).toHaveProperty("disabled", true);
  expect(reporting.fetchReportIncident).toHaveBeenCalledTimes(1);
  vi.mocked(reporting.fetchReportIncident).mockResolvedValue({id:42,description:"Saved after navigation",incident_type:"collision",severity:"major",latitude:10.7,longitude:122.5,bottleneck:null,status:"active"});
  await act(async () => finish());
  await waitFor(() => expect(screen.getByRole("button", {name:"Update report"})).toHaveProperty("disabled", false));
  expect(reporting.fetchReportIncident).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText(/Description/)).toHaveProperty("value", "Saved after navigation");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(reporting.saveReportIncident).toHaveBeenCalledTimes(1);
});

it("keeps a failed pending edit visible after the returning form refreshes", async () => {
  let fail!: (error: Error) => void;
  vi.mocked(reporting.saveReportIncident).mockReturnValueOnce(new Promise((_resolve, reject) => {fail = reject;}));
  setup("/incident-report/42"); await screen.findByDisplayValue("Saved 42");
  fireEvent.change(screen.getByLabelText(/Description/), {target:{value:"My unsaved update"}});
  fireEvent.click(screen.getByRole("button", {name:"Update report"}));
  fireEvent.click(screen.getByText("Leave page")); fireEvent.click(screen.getByText("Edit 42"));
  expect(screen.getByRole("button", {name:"Sending..."})).toHaveProperty("disabled", true);
  await act(async () => fail(new reporting.ReportRequestError("Update was rejected. Please try again.", 400)));
  await waitFor(() => expect(screen.getByRole("button", {name:"Update report"})).toHaveProperty("disabled", false));
  expect(reporting.fetchReportIncident).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText(/Description/)).toHaveProperty("value", "My unsaved update");
  expect(screen.getByRole("alert").textContent).toBe("Update was rejected. Please try again.");
  fireEvent.click(screen.getByRole("button", {name:"Update report"}));
  await screen.findByText("Incident updated successfully.");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(reporting.saveReportIncident).toHaveBeenCalledTimes(2);
});
