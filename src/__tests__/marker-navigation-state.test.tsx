import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { createRef } from "react";
import { Dashboard } from "../app/pages/Dashboard";
import { PageStateProvider } from "../app/contexts/PageStateContext";
import * as backend from "../app/services/backend";
import { useMapClickHandler } from "../app/hooks/useMapClickHandler";

const fixture = vi.hoisted(() => ({reload: vi.fn(), click: null as Parameters<typeof useMapClickHandler>[0] | null,
  deleting: null as string | null, bottlenecks: [] as backend.Bottleneck[]}));
vi.mock("../app/contexts/AuthContext", () => ({useAuth: () => ({user: {role: "supervisor"}})}));
vi.mock("../app/contexts/WeatherContext", () => ({useWeather: () => ({weather: {source: "unavailable"}, loading: false, error: null, refreshWeather: vi.fn()})}));
vi.mock("../app/services/backend", async original => ({
  ...await original<typeof import("../app/services/backend")>(), createPOI: vi.fn(), createDashboardBottleneck: vi.fn(),
}));
vi.mock("../app/hooks/useDashboardData", async () => {
  const backend = await import("../app/services/backend");
  return {useDashboardData: () => ({dashboardSnapshot: {...backend.getFallbackDashboardSnapshot(), bottlenecks: fixture.bottlenecks}, weatherSnapshot: {source: "unavailable"},
    deployedOfficersCount: 0, totalOfficersCount: 0, activeDeployments: [], reloadDashboard: fixture.reload,
    pois: [], setPois: vi.fn(), trafficReadings: [], setBottleneckActionError: vi.fn(), setBottleneckActionNotice: vi.fn(),
    setDeletingBottleneckId: vi.fn(), deletingBottleneckId: fixture.deleting,
  })};
});
vi.mock("../app/hooks/useMapIntegration", () => ({useMapIntegration: () => ({
  mapRef: {current: null}, mapContainerRef: createRef(), markersRef: {current: []}, hasFittedRef: {current: false}, mapInstance: null,
})}));
vi.mock("../app/hooks/useMapClickHandler", () => ({useMapClickHandler: (options: Parameters<typeof useMapClickHandler>[0]) => {fixture.click = options;}}));
vi.mock("../app/hooks/useMapMarkers", () => ({useMapMarkers: () => {}}));
vi.mock("../app/hooks/useMapAssignmentLines", () => ({useMapAssignmentLines: () => {}}));
vi.mock("../app/hooks/useIncidentMapPreview", () => ({useIncidentMapPreview: () => ({
  report: null, loading: false, error: null, retry: vi.fn(), focusLocation: vi.fn(),
})}));

beforeEach(() => {
  vi.resetAllMocks();
  fixture.deleting = null;
  fixture.bottlenecks = [];
  fixture.reload.mockResolvedValue(undefined);
  vi.mocked(backend.createPOI).mockResolvedValue({id: 99} as backend.POI);
  vi.mocked(backend.createDashboardBottleneck).mockResolvedValue({id: "new-node"} as backend.Bottleneck);
});
function Harness() {
  return <PageStateProvider><MemoryRouter><nav><Link to="/">Dashboard</Link><Link to="/away">Leave</Link></nav>
    <Routes><Route path="/" element={<Dashboard/>}/><Route path="/away" element={<p>Other page</p>}/></Routes>
  </MemoryRouter></PageStateProvider>;
}
function setup() { return render(<Harness/>); }
function place(kind: "poi" | "bottleneck" = "poi", latitude = 10.72) {
  fireEvent.click(screen.getByRole("button", {name: "Add Marker"}));
  fireEvent.click(screen.getByRole("button", {name: kind === "poi" ? "Point of Interest" : "Bottleneck Node"}));
  act(() => fixture.click!.setPendingPoint({latitude, longitude: 122.56}));
}
async function returnToDashboard() {
  fireEvent.click(screen.getByText("Leave"));
  await screen.findByText("Other page");
  fireEvent.click(screen.getByRole("link", {name: "Dashboard"}));
}

it.each(["poi", "bottleneck"] as const)("banner cancellation discards the %s draft before placing a new marker", kind => {
  setup();place(kind);
  fireEvent.change(screen.getByLabelText("Name"), {target: {value: "Discard this draft"}});
  fireEvent.change(screen.getByLabelText("Type"), {target: {value: kind === "poi" ? "school" : "other"}});
  fireEvent.click(screen.getByRole("button", {name: "Cancel marker placement"}));
  place(kind, 10.73);
  expect(screen.getByLabelText("Name")).toHaveProperty("value", "");
  expect(screen.getByLabelText("Type")).toHaveProperty("value", kind === "poi" ? "other" : "intersection");
  expect(screen.getByText(/Location: 10.73/)).toBeTruthy();
});

it("cancelling a saved marker with a failed refresh permits creating a different marker", async () => {
  fixture.reload.mockRejectedValueOnce(new Error("Refresh unavailable"));
  setup();place();
  fireEvent.change(screen.getByLabelText("Name"), {target: {value: "First marker"}});
  fireEvent.click(screen.getByRole("button", {name: "Create"}));
  await screen.findByRole("alert");
  expect(fixture.click!.addMode).toBeNull();
  expect(screen.getByRole("button", {name: "Add Marker"})).toHaveProperty("disabled", true);
  // A refresh retry itself must never create a duplicate.
  fireEvent.click(screen.getByRole("button", {name: "Retry refresh"}));
  await waitFor(() => expect(screen.queryByRole("form", {name: "Create poi"})).toBeNull());
  expect(backend.createPOI).toHaveBeenCalledTimes(1);
  place();
  fireEvent.change(screen.getByLabelText("Name"), {target: {value: "Second marker"}});
  fixture.reload.mockRejectedValueOnce(new Error("Refresh unavailable"));
  fireEvent.click(screen.getByRole("button", {name: "Create"}));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", {name: "Cancel marker placement"}));
  place("poi", 10.74);
  expect(screen.queryByText("Retry refresh")).toBeNull();
  expect(screen.getByLabelText("Name")).toHaveProperty("disabled", false);
  fireEvent.change(screen.getByLabelText("Name"), {target: {value: "Third marker"}});
  fireEvent.click(screen.getByRole("button", {name: "Create"}));
  await waitFor(() => expect(backend.createPOI).toHaveBeenCalledTimes(3));
  expect(backend.createPOI).toHaveBeenLastCalledWith(expect.objectContaining({name: "Third marker", latitude: 10.74}));
});

it("keeps marker saves locked across navigation and refreshes the currently mounted dashboard", async () => {
  let finish!: (value: backend.POI) => void;
  vi.mocked(backend.createPOI).mockReturnValueOnce(new Promise(resolve => {finish = resolve;}));
  setup();place();
  fireEvent.change(screen.getByLabelText("Name"), {target: {value: "Pending marker"}});
  fireEvent.click(screen.getByRole("button", {name: "Create"}));
  await returnToDashboard();
  expect(screen.getByRole("button", {name: "Cancel marker placement"})).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", {name: "Add Marker"})).toHaveProperty("disabled", true);
  expect(fixture.click!.addMode).toBeNull();
  fireEvent.submit(screen.getByRole("form", {name: "Create poi"}));
  expect(backend.createPOI).toHaveBeenCalledTimes(1);
  await act(async () => finish({id: 99} as backend.POI));
  await waitFor(() => expect(screen.queryByRole("form", {name: "Create poi"})).toBeNull());
  expect(fixture.reload).toHaveBeenCalledTimes(1);
});

it("keeps both cancel controls consistent while another marker operation is pending", () => {
  const view = setup();place();
  fireEvent.change(screen.getByLabelText("Name"), {target: {value: "Unfinished marker"}});
  fixture.deleting = "existing-node";view.rerender(<Harness/>);
  expect(screen.getByRole("button", {name: "Cancel marker placement"})).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", {name: "Cancel"})).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", {name: "Create"})).toHaveProperty("disabled", true);
  fireEvent.submit(screen.getByRole("form", {name: "Create poi"}));
  expect(backend.createPOI).not.toHaveBeenCalled();
  fixture.deleting = null;view.rerender(<Harness/>);
  expect(screen.getByLabelText("Name")).toHaveProperty("value", "Unfinished marker");
  fireEvent.click(screen.getByRole("button", {name: "Cancel marker placement"}));
  expect(screen.queryByRole("form", {name: "Create poi"})).toBeNull();
  place();expect(screen.getByLabelText("Name")).toHaveProperty("value", "");
});

it.each(["poi", "bottleneck"] as const)("editing a bottleneck after a saved %s refresh failure allows a new placement", async kind => {
  fixture.bottlenecks = [{id: "existing", name: "Existing junction", status: "normal", latitude: 10.7, longitude: 122.5}];
  fixture.reload.mockRejectedValueOnce(new Error("Refresh unavailable"));
  const create = kind === "poi" ? backend.createPOI : backend.createDashboardBottleneck;
  setup();place(kind);
  fireEvent.change(screen.getByLabelText("Name"), {target: {value: "Already saved marker"}});
  fireEvent.click(screen.getByRole("button", {name: "Create"}));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", {name: "Retry refresh"})).toHaveProperty("disabled", false);
  fireEvent.click(screen.getByRole("button", {name: /^Edit bottleneck/}));
  expect(screen.getByRole("region", {name: /^Edit bottleneck/})).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name: "Close"}));
  expect(screen.getByRole("button", {name: "Add Marker"})).toHaveProperty("disabled", false);
  await returnToDashboard();
  expect(screen.getByRole("button", {name: "Add Marker"})).toHaveProperty("disabled", false);
  place(kind, 10.74);
  expect(screen.queryByRole("button", {name: "Retry refresh"})).toBeNull();
  expect(screen.getByLabelText("Name")).toHaveProperty("value", "");
  expect(screen.getByLabelText("Name").closest("fieldset")).toHaveProperty("disabled", false);
  fireEvent.change(screen.getByLabelText("Name"), {target: {value: "New marker after edit"}});
  fireEvent.click(screen.getByRole("button", {name: "Create"}));
  await waitFor(() => expect(screen.queryByRole("form", {name: `Create ${kind}`})).toBeNull());
  expect(create).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenLastCalledWith(expect.objectContaining({name: "New marker after edit", latitude: 10.74}));
});

it("keeps refresh recovery reachable if the marker menu was open when saving", async () => {
  fixture.reload.mockRejectedValueOnce(new Error("Refresh unavailable"));
  setup();place();
  fireEvent.change(screen.getByLabelText("Name"), {target: {value: "Already saved marker"}});
  fireEvent.click(screen.getByRole("button", {name: "Add Marker"}));
  fireEvent.click(screen.getByRole("button", {name: "Create"}));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", {name: "Point of Interest"})).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", {name: "Bottleneck Node"})).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", {name: "Point of Interest"}));
  expect(screen.getByRole("form", {name: "Create poi"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name: "Retry refresh"}));
  await waitFor(() => expect(screen.queryByRole("form", {name: "Create poi"})).toBeNull());
  expect(screen.getByRole("button", {name: "Add Marker"})).toHaveProperty("disabled", false);
  expect(backend.createPOI).toHaveBeenCalledTimes(1);
});
