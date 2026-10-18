import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useIncidentMapPreview } from "../app/hooks/useIncidentMapPreview";
import * as reporting from "../app/services/incidentReporting";

interface PreviewPopup {
  content?: HTMLElement;
  open: boolean;
  remove: ReturnType<typeof vi.fn>;
}
interface PreviewMarker {
  element: HTMLElement;
  coordinates?: number[];
  popup?: PreviewPopup;
  remove: ReturnType<typeof vi.fn>;
}
const stubs = vi.hoisted(() => ({markers: [] as PreviewMarker[], popups: [] as PreviewPopup[]}));

vi.mock("../app/services/incidentReporting", () => ({fetchReportIncident: vi.fn()}));
vi.mock("maplibre-gl", () => ({default: {
  Marker: class {
    element: HTMLElement;
    coordinates?: number[];
    popup?: PreviewPopup;
    remove = vi.fn();
    constructor({element}: {element: HTMLElement}) {this.element = element; stubs.markers.push(this);}
    setLngLat(coordinates: number[]) {this.coordinates = coordinates; return this;}
    setPopup(popup: PreviewPopup) {this.popup = popup; return this;}
    addTo() {return this;}
    getElement() {return this.element;}
    getPopup() {return this.popup;}
    togglePopup() {if (this.popup) this.popup.open = !this.popup.open; return this;}
  },
  Popup: class {
    content?: HTMLElement;
    open = false;
    remove = vi.fn();
    constructor() {stubs.popups.push(this);}
    setDOMContent(content: HTMLElement) {this.content = content; return this;}
    isOpen() {return this.open;}
  },
}}));

const report: reporting.ReportIncident = {
  id: 51, reference: "REPORT-51", source: "public", status: "pending", incident_type: "collision", severity: "major",
  description: "Collision blocking one lane", latitude: 10.72, longitude: 122.56, bottleneck: null,
};
function mapFixture() {
  const listeners = new Map<string, Set<() => void>>();
  const instance = {
    flyTo: vi.fn(),
    isStyleLoaded: vi.fn(() => false),
    on: vi.fn((event: string, listener: () => void) => {
      const set = listeners.get(event) ?? new Set(); set.add(listener); listeners.set(event, set); return instance;
    }),
    off: vi.fn((event: string, listener: () => void) => {listeners.get(event)?.delete(listener); return instance;}),
  };
  return {...instance, map: instance as unknown as MapLibreMap,
    emit: (event: string) => listeners.get(event)?.forEach(listener => listener())};
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => {resolve = yes;});
  return {promise, resolve};
}
beforeEach(() => {
  vi.clearAllMocks();
  stubs.markers.length = 0; stubs.popups.length = 0;
  vi.mocked(reporting.fetchReportIncident).mockResolvedValue({...report});
});

it("loads a separate pending preview when the map becomes available, even before tiles load", async () => {
  const fixture = mapFixture();
  const hasFittedRef = {current: false};
  const initialProps: {reportId: string | null; map: MapLibreMap | null; hasFittedRef: typeof hasFittedRef}
    = {reportId: null, map: null, hasFittedRef};
  const {result, rerender, unmount} = renderHook(props => useIncidentMapPreview(props), {initialProps});
  expect(reporting.fetchReportIncident).not.toHaveBeenCalled();
  rerender({...initialProps, reportId: "51"});
  await waitFor(() => expect(result.current.report?.id).toBe(51));
  expect(stubs.markers).toHaveLength(0);
  rerender({...initialProps, reportId: "51", map: fixture.map});
  await waitFor(() => expect(stubs.markers).toHaveLength(1));
  expect(stubs.markers[0].coordinates).toEqual([report.longitude, report.latitude]);
  expect(stubs.markers[0].element.getAttribute("aria-label")).toBe("Pending report REPORT-51");
  expect(fixture.flyTo).toHaveBeenCalledWith(expect.objectContaining({center: [122.56, 10.72], zoom: 17}));
  expect(hasFittedRef.current).toBe(true);
  expect(stubs.popups[0].content?.querySelectorAll("button")).toHaveLength(0);
  expect(result.current.report?.status).toBe("pending");
  expect(reporting.fetchReportIncident).toHaveBeenCalledExactlyOnceWith(51);
  const initialFocuses = fixture.flyTo.mock.calls.length;
  rerender({...initialProps, reportId: "51", map: fixture.map});
  expect(fixture.flyTo).toHaveBeenCalledTimes(initialFocuses);
  act(() => result.current.focusLocation());
  expect(fixture.flyTo).toHaveBeenCalledTimes(initialFocuses + 1);
  unmount();
  expect(stubs.markers[0].remove).toHaveBeenCalled();
  expect(stubs.popups[0].remove).toHaveBeenCalled();
});

it("keeps untrusted report text as text inside the preview popup", async () => {
  const hostileDescription = '<img src=x onerror="alert(1)"><script>unsafe()</script>';
  vi.mocked(reporting.fetchReportIncident).mockResolvedValue({...report, description: hostileDescription});
  const fixture = mapFixture();
  renderHook(() => useIncidentMapPreview({reportId: "51", map: fixture.map, hasFittedRef: {current: false}}));
  await waitFor(() => expect(stubs.popups).toHaveLength(1));
  expect(stubs.popups[0].content?.textContent).toContain(hostileDescription);
  expect(stubs.popups[0].content?.querySelector("img, script")).toBeNull();
});

it.each(["oops", "0", "1.5"])("rejects invalid report ID %s before making a request", async reportId => {
  const fixture = mapFixture();
  const {result} = renderHook(() => useIncidentMapPreview({reportId, map: fixture.map, hasFittedRef: {current: false}}));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.loading).toBe(false);
  expect(reporting.fetchReportIncident).not.toHaveBeenCalled();
  expect(stubs.markers).toHaveLength(0);
  expect(fixture.flyTo).not.toHaveBeenCalled();
});

it.each([
  {latitude: null, longitude: 122.56},
  {latitude: 91, longitude: 122.56},
  {latitude: 10.72, longitude: 181},
])("does not invent a location for invalid coordinates %j", async coordinates => {
  vi.mocked(reporting.fetchReportIncident).mockResolvedValue({...report, ...coordinates});
  const fixture = mapFixture();
  const {result} = renderHook(() => useIncidentMapPreview({reportId: "51", map: fixture.map, hasFittedRef: {current: false}}));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.report).toBeNull();
  expect(stubs.markers).toHaveLength(0);
  expect(fixture.flyTo).not.toHaveBeenCalled();
});

it.each(["rejected", "resolved"])("does not display a %s report as a pending preview", async status => {
  vi.mocked(reporting.fetchReportIncident).mockResolvedValue({...report, status});
  const fixture = mapFixture();
  const {result} = renderHook(() => useIncidentMapPreview({reportId: "51", map: fixture.map, hasFittedRef: {current: false}}));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.report).toBeNull();
  expect(stubs.markers).toHaveLength(0);
});

it("offers a retry after a failed fetch without leaving an old preview marker", async () => {
  vi.mocked(reporting.fetchReportIncident).mockRejectedValueOnce(new Error("Review connection unavailable"));
  const fixture = mapFixture();
  const {result} = renderHook(() => useIncidentMapPreview({reportId: "51", map: fixture.map, hasFittedRef: {current: false}}));
  await waitFor(() => expect(result.current.error).toContain("Review connection unavailable"));
  expect(stubs.markers).toHaveLength(0);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.report?.id).toBe(51));
  expect(result.current.error).toBeNull();
  expect(stubs.markers).toHaveLength(1);
  expect(reporting.fetchReportIncident).toHaveBeenCalledTimes(2);
});

it("ignores a slow response for an earlier report and removes the pin when preview closes", async () => {
  const old = deferred<reporting.ReportIncident>(), latest = deferred<reporting.ReportIncident>();
  vi.mocked(reporting.fetchReportIncident).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  const fixture = mapFixture();
  const props = {reportId: "51" as string | null, map: fixture.map, hasFittedRef: {current: false}};
  const {result, rerender} = renderHook(options => useIncidentMapPreview(options), {initialProps: props});
  rerender({...props, reportId: "52"});
  await act(async () => latest.resolve({...report, id: 52, reference: "REPORT-52", longitude: 122.57}));
  expect(result.current.report?.id).toBe(52);
  expect(stubs.markers).toHaveLength(1);
  await act(async () => old.resolve(report));
  expect(result.current.report?.id).toBe(52);
  expect(stubs.markers).toHaveLength(1);
  expect(stubs.markers[0].coordinates).toEqual([122.57, 10.72]);
  rerender({...props, reportId: null});
  expect(result.current.report).toBeNull();
  expect(stubs.markers[0].remove).toHaveBeenCalled();
});

it("does not install a pin after unmount or refocus a removed map", async () => {
  const pending = deferred<reporting.ReportIncident>();
  vi.mocked(reporting.fetchReportIncident).mockReturnValueOnce(pending.promise);
  const fixture = mapFixture();
  const first = renderHook(() => useIncidentMapPreview({reportId: "51", map: fixture.map, hasFittedRef: {current: false}}));
  first.unmount();
  await act(async () => pending.resolve(report));
  expect(stubs.markers).toHaveLength(0);

  const hasFittedRef = {current: false};
  const next = renderHook(() => useIncidentMapPreview({reportId: "51", map: fixture.map, hasFittedRef}));
  await waitFor(() => expect(stubs.markers).toHaveLength(1));
  const focusCount = fixture.flyTo.mock.calls.length;
  act(() => fixture.emit("remove"));
  act(() => next.result.current.focusLocation());
  expect(fixture.flyTo).toHaveBeenCalledTimes(focusCount);
  next.unmount();
  expect(fixture.off).toHaveBeenCalledWith("remove", expect.any(Function));
});
