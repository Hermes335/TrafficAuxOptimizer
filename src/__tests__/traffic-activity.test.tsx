import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTrafficActivity } from "../app/hooks/useTrafficActivity";
import { fetchWithTimeout } from "../app/services/backend";

vi.mock("../app/services/backend", () => ({
  getApiBaseUrl: () => "https://backend.example.com",
  fetchWithTimeout: vi.fn(),
}));

let visible = true;
beforeEach(() => {
  vi.useFakeTimers();
  visible = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible ? "visible" : "hidden");
  vi.mocked(fetchWithTimeout).mockReset().mockResolvedValue({ status: 204 } as Response);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("sends no activity for signed-out users", async () => {
  renderHook(() => useTrafficActivity(false));
  await act(() => vi.advanceTimersByTimeAsync(180000));
  expect(fetchWithTimeout).not.toHaveBeenCalled();
});

it("heartbeats a visible signed-in tab and stops when hidden, signed out, or unmounted", async () => {
  const { rerender, unmount } = renderHook(({ signedIn }) => useTrafficActivity(signedIn), { initialProps: { signedIn: true } });
  await act(async () => {});
  expect(fetchWithTimeout).toHaveBeenCalledWith("https://backend.example.com/api/traffic/activity/", { method: "POST", timeout: 10000 });
  await act(() => vi.advanceTimersByTimeAsync(60000));
  expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
  visible = false;
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await act(() => vi.advanceTimersByTimeAsync(240000));
  expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
  visible = true;
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(fetchWithTimeout).toHaveBeenCalledTimes(3);
  rerender({ signedIn: false });
  await act(() => vi.advanceTimersByTimeAsync(120000));
  expect(fetchWithTimeout).toHaveBeenCalledTimes(3);
  unmount();
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(fetchWithTimeout).toHaveBeenCalledTimes(3);
});

it("waits for a hidden tab to become visible and retries a failed heartbeat", async () => {
  visible = false;
  renderHook(() => useTrafficActivity(true));
  expect(fetchWithTimeout).not.toHaveBeenCalled();
  vi.mocked(fetchWithTimeout).mockRejectedValueOnce(new Error("offline"));
  visible = true;
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await act(() => vi.advanceTimersByTimeAsync(60000));
  expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
});
