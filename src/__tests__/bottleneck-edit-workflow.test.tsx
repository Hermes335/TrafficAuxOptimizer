import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createRef, useState } from "react";
import { MemoryRouter } from "react-router";
import { Dashboard } from "../app/pages/Dashboard";
import { PageStateProvider } from "../app/contexts/PageStateContext";
import * as backend from "../app/services/backend";

const fixture = vi.hoisted(() => ({reload: vi.fn(), bottlenecks: [] as backend.Bottleneck[],
  mapClick: null as null | {editPickFromMap: boolean; setEditLatitude: (value: string) => void; setEditLongitude: (value: string) => void},
}));
vi.mock("../app/contexts/AuthContext", () => ({useAuth: () => ({user: {role: "supervisor"}})}));
vi.mock("../app/contexts/WeatherContext", () => ({useWeather: () => ({weather: {source: "unavailable"}, loading: false, error: null, refreshWeather: vi.fn()})}));
vi.mock("../app/services/backend", async original => ({
  ...await original<typeof import("../app/services/backend")>(), updateDashboardBottleneck: vi.fn(),
}));
vi.mock("../app/hooks/useDashboardData", async () => {
  const {useState} = await import("react");
  const {usePageState} = await import("../app/contexts/PageStateContext");
  const {getFallbackDashboardSnapshot} = await import("../app/services/backend");
  return {useDashboardData: () => {
    const [dashboardSnapshot, setDashboardSnapshot] = useState(() => ({...getFallbackDashboardSnapshot(), bottlenecks: fixture.bottlenecks, incidents: []}));
    const [bottleneckActionError, setBottleneckActionError] = usePageState<string | null>("bottleneckForm.error", null);
    const [bottleneckActionNotice, setBottleneckActionNotice] = usePageState<string | null>("bottleneckForm.notice", null);
    const [deletingBottleneckId, setDeletingBottleneckId] = usePageState<string | null>("bottleneckForm.deletingId", null);
    return {
      dashboardSnapshot, weatherSnapshot: {source: "unavailable"}, deployedOfficersCount: 0, totalOfficersCount: 0, activeDeployments: [],
      reloadDashboard: async () => {await fixture.reload(); setDashboardSnapshot(previous => ({...previous, bottlenecks: fixture.bottlenecks}));},
      pois: [], setPois: vi.fn(), trafficReadings: [], bottleneckActionError, setBottleneckActionError,
      bottleneckActionNotice, setBottleneckActionNotice, deletingBottleneckId, setDeletingBottleneckId,
      lastRefresh: new Date().toISOString(), connectionState: "live", weatherLoading: false,
    };
  }};
});
vi.mock("../app/hooks/useMapIntegration", () => ({useMapIntegration: () => ({
  mapRef: {current: null}, mapContainerRef: createRef(), markersRef: {current: []}, hasFittedRef: {current: false}, mapInstance: null,
})}));
vi.mock("../app/hooks/useMapClickHandler", () => ({useMapClickHandler: (options: NonNullable<typeof fixture.mapClick>) => {fixture.mapClick = options;}}));
vi.mock("../app/hooks/useMapMarkers", () => ({useMapMarkers: () => {}}));
vi.mock("../app/hooks/useMapAssignmentLines", () => ({useMapAssignmentLines: () => {}}));
vi.mock("../app/hooks/useIncidentMapPreview", () => ({useIncidentMapPreview: () => ({
  report: null, loading: false, error: null, retry: vi.fn(), focusLocation: vi.fn(),
})}));

beforeEach(() => {
  vi.resetAllMocks();
  fixture.bottlenecks = [
    {id: "B-ONE", name: "Pilot junction", status: "normal", latitude: 10.7, longitude: 122.5, area_name: "Prime State"},
    {id: "B-TWO", name: "Other junction", status: "normal", latitude: 10.8, longitude: 122.6, area_name: "Lapaz"},
  ];
  fixture.reload.mockResolvedValue(undefined);
  vi.mocked(backend.updateDashboardBottleneck).mockResolvedValue(fixture.bottlenecks[0]);
});

function Navigation() {
  const [away, setAway] = useState(false);
  return <><button onClick={() => setAway(value => !value)}>Navigate</button>{!away && <Dashboard />}</>;
}
function setup() { return render(<PageStateProvider><MemoryRouter><Navigation /></MemoryRouter></PageStateProvider>); }
function edit(name = "Pilot junction") {
  const row = within(document.getElementById("dashboard-bottlenecks")!).getByText(name).closest('[role="button"]') as HTMLElement;
  fireEvent.click(within(row).getByRole("button", {name: "Edit bottleneck", hidden: true}));
}
function changeName(name = "Updated junction") { fireEvent.change(screen.getByLabelText("Name"), {target: {value: name}}); }
function navigate() { fireEvent.click(screen.getByText("Navigate")); }

it("keeps Save disabled until a meaningful change and closes an untouched editor without confirmation", () => {
  setup(); edit();
  expect(screen.getByRole("button", {name: "Save changes"})).toHaveProperty("disabled", true);
  changeName("  Pilot junction  ");
  expect(screen.getByRole("button", {name: "Save changes"})).toHaveProperty("disabled", true);
  changeName();
  expect(screen.getByRole("button", {name: "Save changes"})).toHaveProperty("disabled", false);
  changeName("Pilot junction");
  fireEvent.click(screen.getByRole("button", {name: "Cancel"}));
  expect(screen.queryByRole("region", {name: "Edit bottleneck"})).toBeNull();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(backend.updateDashboardBottleneck).not.toHaveBeenCalled();
});

it.each(["Close", "Cancel"])("confirms %s with unsaved edits, restores focus on Keep editing, and discards only when confirmed", async label => {
  setup(); edit(); changeName();
  const close = screen.getByRole("button", {name: label});
  close.focus(); fireEvent.click(close);
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name: "Keep editing"}));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(close));
  expect(screen.getByLabelText("Name")).toHaveProperty("value", "Updated junction");
  fireEvent.click(close);
  fireEvent.click(screen.getByRole("button", {name: "Discard changes"}));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.queryByRole("region", {name: "Edit bottleneck"})).toBeNull();
  edit();
  expect(screen.getByLabelText("Name")).toHaveProperty("value", "Pilot junction");
  expect(backend.updateDashboardBottleneck).not.toHaveBeenCalled();
});

it("preserves the draft when its pencil is clicked again and confirms switching to another bottleneck", async () => {
  setup(); edit(); changeName(); edit();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.getByLabelText("Name")).toHaveProperty("value", "Updated junction");
  edit("Other junction");
  fireEvent.click(screen.getByRole("button", {name: "Keep editing"}));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.getByLabelText("Name")).toHaveProperty("value", "Updated junction");
  edit("Other junction");
  fireEvent.click(screen.getByRole("button", {name: "Discard changes"}));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.getByLabelText("Name")).toHaveProperty("value", "Other junction");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Name")));
  expect(screen.getByRole("button", {name: "Save changes"})).toHaveProperty("disabled", true);
});

it("requires discard confirmation before replacing the editor with marker placement", async () => {
  setup(); edit(); changeName();
  fireEvent.click(screen.getByRole("button", {name: "Add Marker"}));
  fireEvent.click(screen.getByRole("button", {name: "Bottleneck Node"}));
  fireEvent.click(screen.getByRole("button", {name: "Keep editing"}));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.getByLabelText("Name")).toHaveProperty("value", "Updated junction");
  fireEvent.click(screen.getByRole("button", {name: "Bottleneck Node"}));
  fireEvent.click(screen.getByRole("button", {name: "Discard changes"}));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.queryByRole("region", {name: "Edit bottleneck"})).toBeNull();
  expect(screen.getByText(/Click map to place bottleneck/)).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", {name: "Add Marker"})));
});

it("keeps the edit baseline and draft across live refresh and navigation, suggesting areas outside the active filter", async () => {
  setup();
  fireEvent.change(screen.getByLabelText("Area filter"), {target: {value: "Prime State"}});
  edit();
  const areaInput = screen.getByLabelText("Area / group name");
  const suggestions = document.getElementById(areaInput.getAttribute("list")!);
  expect([...suggestions!.querySelectorAll("option")].map(option => option.value)).toEqual(["Lapaz", "Prime State"]);
  changeName();
  fixture.bottlenecks = fixture.bottlenecks.map(node => node.id === "B-ONE" ? {...node, name: "Updated junction"} : node);
  fireEvent.click(screen.getByRole("button", {name: "Refresh dashboard"}));
  await waitFor(() => expect(fixture.reload).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", {name: "Save changes"})).toHaveProperty("disabled", false);
  navigate(); navigate();
  expect(screen.getByLabelText("Name")).toHaveProperty("value", "Updated junction");
  expect(screen.getByRole("button", {name: "Save changes"})).toHaveProperty("disabled", false);
  changeName("Pilot junction");
  expect(screen.getByRole("button", {name: "Save changes"})).toHaveProperty("disabled", true);
});

it("locks edits during a save and retains the failed draft for correction and retry", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(backend.updateDashboardBottleneck).mockReturnValueOnce(new Promise((_, no) => {reject = no;}));
  setup(); edit(); changeName();
  fireEvent.click(screen.getByRole("button", {name: "Save changes"}));
  expect(screen.getByRole("button", {name: "Saving..."})).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", {name: "Close"})).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("Name").closest("fieldset")).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", {name: "Saving..."}));
  expect(backend.updateDashboardBottleneck).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("Save offline")));
  expect(screen.getByRole("alert").textContent).toBe("Save offline");
  expect(screen.getByLabelText("Name")).toHaveProperty("value", "Updated junction");
  fireEvent.click(screen.getByRole("button", {name: "Save changes"}));
  await waitFor(() => expect(screen.queryByRole("region", {name: "Edit bottleneck"})).toBeNull());
  expect(backend.updateDashboardBottleneck).toHaveBeenLastCalledWith("B-ONE", expect.objectContaining({name: "Updated junction", latitude: 10.7, longitude: 122.5, area_name: "Prime State"}));
  expect(fixture.reload).toHaveBeenCalledTimes(1);
});

it("reveals invalid collapsed coordinates and inline errors, then saves a corrected zero-officer profile", async () => {
  setup(); edit(); changeName("");
  const latitude = screen.getByLabelText("Latitude");
  const coordinates = latitude.closest("details")!;
  // The draft may contain an invalid coordinate while its section is collapsed.
  fireEvent.change(latitude, {target: {value: "91"}});
  expect(coordinates.open).toBe(false);
  fireEvent.change(screen.getByLabelText("Maximum officers"), {target: {value: "1"}});
  fireEvent.click(screen.getByRole("button", {name: "Save changes"}));
  expect(backend.updateDashboardBottleneck).not.toHaveBeenCalled();
  expect(coordinates.open).toBe(true);
  expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBe("true");
  expect(latitude.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByLabelText("Maximum officers").getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText("Enter a bottleneck name.")).toBeTruthy();
  expect(screen.getByText("Enter a latitude between -90 and 90.")).toBeTruthy();
  expect(screen.getByText("Maximum must be at least the normal minimum.")).toBeTruthy();
  changeName("Quiet junction");
  fireEvent.change(latitude, {target: {value: "10.7"}});
  fireEvent.change(screen.getByLabelText("Normal minimum"), {target: {value: "0"}});
  fireEvent.change(screen.getByLabelText("Maximum officers"), {target: {value: "0"}});
  fireEvent.click(screen.getByRole("button", {name: "Add staffing period"}));
  expect(screen.getByLabelText("Period 1 officers")).toHaveProperty("value", "0");
  fireEvent.click(screen.getByRole("button", {name: "Save changes"}));
  await waitFor(() => expect(screen.queryByRole("region", {name: "Edit bottleneck"})).toBeNull());
  expect(backend.updateDashboardBottleneck).toHaveBeenCalledExactlyOnceWith("B-ONE", expect.objectContaining({
    name: "Quiet junction", min_officers_required: 0, max_officers_allowed: 0,
    staffing_periods: [expect.objectContaining({required: 0, start: "06:00", end: "07:00"})],
  }));
});

it("marks map-picked coordinates as unsaved and preserves them across navigation until reverted", () => {
  setup(); edit();
  fireEvent.click(screen.getByRole("button", {name: "Pick location on map"}));
  expect(fixture.mapClick?.editPickFromMap).toBe(true);
  act(() => {fixture.mapClick!.setEditLatitude("10.72"); fixture.mapClick!.setEditLongitude("122.58");});
  expect(screen.getByText("Selected: 10.72, 122.58")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name: "Done picking"}));
  expect(screen.getByRole("button", {name: "Save changes"})).toHaveProperty("disabled", false);
  navigate(); navigate();
  expect(screen.getByLabelText("Latitude")).toHaveProperty("value", "10.72");
  expect(screen.getByLabelText("Longitude")).toHaveProperty("value", "122.58");
  expect(screen.getByRole("button", {name: "Save changes"})).toHaveProperty("disabled", false);
  fireEvent.change(screen.getByLabelText("Latitude"), {target: {value: "10.7000"}});
  fireEvent.change(screen.getByLabelText("Longitude"), {target: {value: "122.5000"}});
  expect(screen.getByRole("button", {name: "Save changes"})).toHaveProperty("disabled", true);
});
