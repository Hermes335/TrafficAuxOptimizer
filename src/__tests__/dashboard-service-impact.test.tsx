import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { DashboardServiceImpact } from "../app/pages/Dashboard/components/DashboardServiceImpact";
import type { TrafficReading, WeatherCurrentSnapshot } from "../app/services/backend";

const weather: WeatherCurrentSnapshot = {timestamp: "2026-10-21T10:00:00Z", condition: "clear", temperature: 28,
  precipitation: 0, weather_impact_factor: 1, source: "weather-provider", data_status: "live", available: true,
  is_synthetic: false, is_stale: false, observed_at: "2026-10-21T10:00:00Z", fetched_at: "2026-10-21T10:00:00Z"};
const reading: TrafficReading = {bottleneck: "B-ONE", timestamp: "2026-10-21T10:00:00Z", traffic_severity_index: 0.3,
  source: "traffic-provider", data_status: "live", available: true, is_synthetic: false, is_stale: false,
  observed_at: "2026-10-21T10:00:00Z", fetched_at: "2026-10-21T10:00:00Z"};
const defaults = {weather, weatherLoading: false, trafficReadings: [reading], lastRefresh: "2026-10-21T10:00:00Z", selectedShift: "Afternoon", canOptimize: true};
function setup(props: Partial<Parameters<typeof DashboardServiceImpact>[0]> = {}) {
  return render(<MemoryRouter><DashboardServiceImpact {...defaults} {...props} /></MemoryRouter>);
}
function expand() {fireEvent.click(screen.getByText(/Service impact ·/));}

it("keeps healthy services quiet and avoids treating initial loading as an outage", () => {
  const {unmount} = setup();
  expect(screen.queryByText(/Service impact/)).toBeNull(); unmount();
  setup({lastRefresh: null, weatherLoading: true, trafficReadings: [], weather: {...weather, available: false}});
  expect(screen.queryByText(/Service impact/)).toBeNull();
});

it("separates a failed road overlay from optimization inputs and keeps readiness available", () => {
  setup({trafficTileError: "Traffic layer unavailable"}); expand();
  expect(screen.getByText(/does not determine whether saved traffic readings can be used for optimization/)).toBeTruthy();
  expect(screen.queryByText("Traffic readings")).toBeNull();
  expect(screen.getByRole("link", {name: "Check optimization readiness"})).toHaveProperty("href", expect.stringContaining("/optimization?shift=afternoon"));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("explains separate failed traffic, weather and schedule refreshes without exposing raw transport errors", () => {
  setup({loadError: "Traffic readings: request 503 · Weather: secret transport details · Schedule: request 503",
    weatherError: "Weather request failed", weather: {...weather, available: false}, trafficReadings: []}); expand();
  expect(screen.getByText("Service impact · 3 notices")).toBeTruthy();
  expect(screen.getByText(/Traffic observations could not be refreshed/)).toBeTruthy();
  expect(screen.getByText(/Current weather could not be confirmed/)).toBeTruthy();
  expect(screen.getByText(/Assignment markers may show the last loaded schedule/)).toBeTruthy();
  expect(screen.queryByText(/secret transport/)).toBeNull();
  expect(screen.getByText(/Optimization readiness checks the selected run’s required inputs and freshness separately/)).toBeTruthy();
});

it("shows unavailable or stale observations while respecting the dispatcher navigation role", () => {
  setup({canOptimize: false, trafficReadings: [{...reading, is_stale: true}], weather: {...weather, is_stale: true}}); expand();
  expect(screen.getByText(/Some traffic observations are unavailable or marked stale/)).toBeTruthy();
  expect(screen.getByText(/weather observation is marked stale/)).toBeTruthy();
  expect(screen.getByRole("link", {name: "Open deployment schedule"})).toBeTruthy();
  expect(screen.queryByRole("link", {name: "Check optimization readiness"})).toBeNull();
});
