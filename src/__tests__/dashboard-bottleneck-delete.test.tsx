import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { createRef } from "react";
import { Dashboard } from "../app/pages/Dashboard";
import { PageStateProvider } from "../app/contexts/PageStateContext";
import * as backend from "../app/services/backend";

const fixture = vi.hoisted(() => ({
  reload: vi.fn(), role: "supervisor", deleting: null as string | null,
  bottlenecks: [] as backend.Bottleneck[],
}));

vi.mock("../app/contexts/AuthContext", () => ({useAuth: () => ({user: {role: fixture.role}})}));
vi.mock("../app/contexts/WeatherContext", () => ({useWeather: () => ({weather: {source: "unavailable"}, loading: false, error: null, refreshWeather: vi.fn()})}));
vi.mock("../app/services/backend", async original => ({
  ...await original<typeof import("../app/services/backend")>(), deleteDashboardBottleneck: vi.fn(),
}));
vi.mock("../app/hooks/useDashboardData", async () => {
  const {useState} = await import("react");
  const {getFallbackDashboardSnapshot} = await import("../app/services/backend");
  return {useDashboardData: () => {
    const [dashboardSnapshot, setDashboardSnapshot] = useState(() => ({
      ...getFallbackDashboardSnapshot(), bottlenecks: fixture.bottlenecks, incidents: [],
    }));
    const [bottleneckActionError, setBottleneckActionError] = useState<string | null>(null);
    const [bottleneckActionNotice, setBottleneckActionNotice] = useState<string | null>(null);
    const [deletingBottleneckId, setDeletingBottleneckId] = useState(fixture.deleting);
    return {
      dashboardSnapshot, weatherSnapshot: {source: "unavailable"},
      deployedOfficersCount: 0, totalOfficersCount: 0, activeDeployments: [],
      reloadDashboard: async () => {
        await fixture.reload();
        setDashboardSnapshot(previous => ({...previous, bottlenecks: fixture.bottlenecks}));
      },
      pois: [], setPois: vi.fn(), trafficReadings: [],
      bottleneckActionError, setBottleneckActionError, bottleneckActionNotice, setBottleneckActionNotice,
      deletingBottleneckId, setDeletingBottleneckId,
      lastRefresh: new Date().toISOString(), connectionState: "live", weatherLoading: false,
    };
  }};
});
vi.mock("../app/hooks/useMapIntegration", () => ({useMapIntegration: () => ({
  mapRef: {current: null}, mapContainerRef: createRef(), markersRef: {current: []}, hasFittedRef: {current: false}, mapInstance: null,
})}));
vi.mock("../app/hooks/useMapClickHandler", () => ({useMapClickHandler: () => {}}));
vi.mock("../app/hooks/useMapMarkers", () => ({useMapMarkers: () => {}}));
vi.mock("../app/hooks/useMapAssignmentLines", () => ({useMapAssignmentLines: () => {}}));
vi.mock("../app/hooks/useIncidentMapPreview", () => ({useIncidentMapPreview: () => ({
  report: null, loading: false, error: null, retry: vi.fn(), focusLocation: vi.fn(),
})}));

beforeEach(() => {
  vi.resetAllMocks();
  fixture.role = "supervisor";
  fixture.deleting = null;
  fixture.bottlenecks = [
    {id: "B-ONE", name: "Pilot junction", status: "normal", latitude: 10.7, longitude: 122.5},
    {id: "B-TWO", name: "Other junction", status: "normal", latitude: 10.8, longitude: 122.6},
  ];
  fixture.reload.mockResolvedValue(undefined);
  vi.mocked(backend.deleteDashboardBottleneck).mockResolvedValue(undefined);
});

function setup() {
  return render(<PageStateProvider><MemoryRouter><Dashboard /></MemoryRouter></PageStateProvider>);
}
function leftPanel() { return within(document.getElementById("dashboard-bottlenecks")!); }
function row(name = "Pilot junction") { return leftPanel().getByText(name).closest('[role="button"]') as HTMLElement; }
function trash(name = "Pilot junction") { return within(row(name)).getByRole("button", {name: /^Remove bottleneck/, hidden: true}); }

it("the left delete control opens confirmation without selecting the row, and cancellation preserves it", async () => {
  setup();
  fireEvent.click(trash());
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(screen.queryByText("Bottleneck Details")).toBeNull();
  expect(row().getAttribute("data-selected")).toBeNull();
  fireEvent.click(screen.getByRole("button", {name: "Cancel"}));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(backend.deleteDashboardBottleneck).not.toHaveBeenCalled();
  expect(fixture.reload).not.toHaveBeenCalled();
  expect(row().getAttribute("data-selected")).toBeNull();
});

it("confirmation deletes the selected left bottleneck once, reloads the list, and clears its details", async () => {
  let finish!: () => void;
  vi.mocked(backend.deleteDashboardBottleneck).mockReturnValueOnce(new Promise(resolve => {finish = resolve;}));
  setup();
  fireEvent.click(row());
  const details = within(document.getElementById("dashboard-details")!);
  expect(details.getByText("Bottleneck Details")).toBeTruthy();
  expect(details.queryByRole("button", {name: /Remove Bottleneck/i})).toBeNull();
  fireEvent.click(trash());
  fixture.bottlenecks = fixture.bottlenecks.filter(node => node.id !== "B-ONE");
  fireEvent.click(screen.getByRole("button", {name: "Remove"}));
  expect(backend.deleteDashboardBottleneck).toHaveBeenCalledExactlyOnceWith("B-ONE");
  expect(trash("Other junction")).toHaveProperty("disabled", true);
  await act(async () => finish());
  await waitFor(() => expect(leftPanel().queryByText("Pilot junction")).toBeNull());
  expect(fixture.reload).toHaveBeenCalledTimes(1);
  expect(details.queryByText("Bottleneck Details")).toBeNull();
  expect(screen.getByText("B-ONE removed.")).toBeTruthy();
  expect(trash("Other junction")).toHaveProperty("disabled", false);
});

it("failed deletion displays the API error and keeps the bottleneck and selected details", async () => {
  vi.mocked(backend.deleteDashboardBottleneck).mockRejectedValueOnce(new Error("Cannot remove bottleneck with active incidents or deployments."));
  setup();
  fireEvent.click(row());
  fireEvent.click(trash());
  fireEvent.click(screen.getByRole("button", {name: "Remove"}));
  expect((await screen.findByRole("alert")).textContent).toContain("Cannot remove bottleneck with active incidents or deployments.");
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(within(screen.getByRole("alertdialog")).getByRole("button", {name: "Remove"})).toHaveProperty("disabled", false);
  expect(row().getAttribute("data-selected")).toBe("true");
  expect(within(document.getElementById("dashboard-details")!).getByText("Bottleneck Details")).toBeTruthy();
  expect(backend.deleteDashboardBottleneck).toHaveBeenCalledExactlyOnceWith("B-ONE");
  expect(fixture.reload).not.toHaveBeenCalled();
  expect(trash()).toHaveProperty("disabled", false);
  vi.mocked(backend.deleteDashboardBottleneck).mockResolvedValueOnce(undefined);
  fixture.bottlenecks = fixture.bottlenecks.filter(node => node.id !== "B-ONE");
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", {name:"Remove"}));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(backend.deleteDashboardBottleneck).toHaveBeenCalledTimes(2);
  expect(fixture.reload).toHaveBeenCalledTimes(1);
});

it.each([
  {role: "dispatcher", deleting: null},
  {role: "supervisor", deleting: "B-TWO"},
])("blocks left delete confirmation for role $role with pending deletion $deleting", ({role, deleting}) => {
  fixture.role = role;
  fixture.deleting = deleting;
  setup();
  const button = trash();
  expect(button).toHaveProperty("disabled", true);
  fireEvent.click(button);
  // A click on the control's surrounding hit area must obey the same guard.
  fireEvent.click(button.parentElement!);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(backend.deleteDashboardBottleneck).not.toHaveBeenCalled();
  expect(row().getAttribute("data-selected")).toBeNull();
});
