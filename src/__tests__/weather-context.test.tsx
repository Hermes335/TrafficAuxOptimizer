import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WeatherProvider, useWeather } from "../app/contexts/WeatherContext";
import { useDashboardData } from "../app/hooks/useDashboardData";
import * as backend from "../app/services/backend";

vi.mock("../app/services/backend", async original => ({
  ...await original<typeof import("../app/services/backend")>(),
  fetchCurrentWeather: vi.fn(), fetchDashboardSnapshot: vi.fn(), fetchDashboardOfficers: vi.fn(),
  fetchDeploymentSchedule: vi.fn(), fetchPOIs: vi.fn(), fetchTrafficReadings: vi.fn(),
  subscribeToDashboardStream: vi.fn(() => () => {}),
}));

const current: backend.WeatherCurrentSnapshot = {
  timestamp: "2026-10-17T08:00:00Z", condition: "light_rain", temperature: 27, precipitation: 1.5,
  weather_impact_factor: 1.2, source: "openweathermap", data_status: "live", available: true,
  is_synthetic: false, is_stale: false, observed_at: "2026-10-17T08:00:00Z", fetched_at: "2026-10-17T08:01:00Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(backend.fetchCurrentWeather).mockResolvedValue(current);
  vi.mocked(backend.fetchDashboardSnapshot).mockResolvedValue(backend.getFallbackDashboardSnapshot());
  vi.mocked(backend.fetchDashboardOfficers).mockResolvedValue([]);
  vi.mocked(backend.fetchDeploymentSchedule).mockResolvedValue([]);
  vi.mocked(backend.fetchPOIs).mockResolvedValue([]);
  vi.mocked(backend.fetchTrafficReadings).mockResolvedValue([]);
  vi.mocked(backend.subscribeToDashboardStream).mockReturnValue(() => {});
});
afterEach(() => vi.useRealTimers());

it("shares weather with the dashboard before its slower collections finish", async () => {
  let resolveWeather!: (weather: backend.WeatherCurrentSnapshot) => void;
  let resolveDashboard!: (snapshot: backend.DashboardSnapshot) => void;
  vi.mocked(backend.fetchCurrentWeather).mockReturnValueOnce(new Promise(resolve => { resolveWeather = resolve; }));
  vi.mocked(backend.fetchDashboardSnapshot).mockReturnValueOnce(new Promise(resolve => { resolveDashboard = resolve; }));
  const { result } = renderHook(() => ({ header: useWeather(), dashboard: useDashboardData() }), { wrapper: WeatherProvider });
  expect(result.current.header.loading).toBe(true);
  expect(result.current.dashboard.weatherLoading).toBe(true);
  expect(backend.fetchCurrentWeather).toHaveBeenCalledTimes(1);

  await act(async () => resolveWeather(current));
  expect(result.current.header.weather).toBe(result.current.dashboard.weatherSnapshot);
  expect(result.current.dashboard.weatherSnapshot).toEqual(current);
  expect(result.current.dashboard.weatherLoading).toBe(false);
  expect(result.current.dashboard.lastRefresh).toBeNull();

  await act(async () => resolveDashboard(backend.getFallbackDashboardSnapshot()));
  expect(result.current.dashboard.lastRefresh).not.toBeNull();
});

it("deduplicates refreshes, marks a failed observation unavailable, and recovers on retry", async () => {
  const { result } = renderHook(useWeather, { wrapper: WeatherProvider });
  await waitFor(() => expect(result.current.weather).toEqual(current));
  let rejectRefresh!: (error: Error) => void;
  vi.mocked(backend.fetchCurrentWeather).mockReturnValueOnce(new Promise((_resolve, reject) => { rejectRefresh = reject; }));
  let refresh!: Promise<void>;
  act(() => {
    refresh = result.current.refreshWeather();
    expect(result.current.refreshWeather()).toBe(refresh);
  });
  expect(result.current.loading).toBe(true);
  expect(result.current.weather.available).toBe(true);
  const failedRefresh = expect(refresh).rejects.toThrow("Weather feed offline");
  await act(async () => {
    rejectRefresh(new Error("Weather feed offline"));
    await failedRefresh;
  });
  expect(result.current.weather).toEqual({ ...current, available: false, is_stale: true, data_status: "unavailable" });
  expect(result.current.error).toBe("Weather feed offline");
  expect(result.current.loading).toBe(false);
  expect(backend.fetchCurrentWeather).toHaveBeenCalledTimes(2);

  await act(async () => { await result.current.refreshWeather(); });
  expect(result.current.weather).toEqual(current);
  expect(result.current.error).toBeNull();
});

it("distinguishes an initial failure from loading without inventing a stale observation", async () => {
  vi.mocked(backend.fetchCurrentWeather).mockRejectedValueOnce(new Error("No connection"));
  const { result } = renderHook(useWeather, { wrapper: WeatherProvider });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe("No connection");
  expect(result.current.weather.available).toBe(false);
  expect(result.current.weather.is_stale).toBe(false);
  expect(result.current.weather.observed_at).toBeNull();
});

it("dashboard refresh reports weather failures while every consumer sees the same unavailable observation", async () => {
  const { result } = renderHook(() => ({ header: useWeather(), dashboard: useDashboardData() }), { wrapper: WeatherProvider });
  await waitFor(() => expect(result.current.dashboard.lastRefresh).not.toBeNull());
  vi.mocked(backend.fetchCurrentWeather).mockRejectedValueOnce(new Error("Offline"));
  await act(async () => { await expect(result.current.dashboard.reloadDashboard()).rejects.toThrow("Weather: Offline"); });
  expect(result.current.dashboard.loadError).toBe("Weather: Offline");
  expect(result.current.dashboard.weatherError).toBe("Offline");
  expect(result.current.header.weather).toBe(result.current.dashboard.weatherSnapshot);
  expect(result.current.header.weather.available).toBe(false);
});

it("ignores a response from the previous Strict Mode mount", async () => {
  let resolveOld!: (weather: backend.WeatherCurrentSnapshot) => void;
  vi.mocked(backend.fetchCurrentWeather).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
  const wrapper = ({ children }: { children: ReactNode }) => <StrictMode><WeatherProvider>{children}</WeatherProvider></StrictMode>;
  const { result } = renderHook(useWeather, { wrapper });
  await waitFor(() => expect(result.current.weather).toEqual(current));
  expect(backend.fetchCurrentWeather).toHaveBeenCalledTimes(2);
  await act(async () => resolveOld({ ...current, temperature: 99 }));
  expect(result.current.weather.temperature).toBe(27);
  expect(result.current.loading).toBe(false);
});

it("refreshes weather on other pages and cancels polling when the provider unmounts", async () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(useWeather, { wrapper: WeatherProvider });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(result.current.weather).toEqual(current);
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
  expect(backend.fetchCurrentWeather).toHaveBeenCalledTimes(2);
  unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
  expect(backend.fetchCurrentWeather).toHaveBeenCalledTimes(2);
});
