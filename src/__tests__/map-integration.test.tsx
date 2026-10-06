import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { createMapStyle, useMapIntegration } from "../app/hooks/useMapIntegration";

const stub = vi.hoisted(() => ({
  loaded: false,
  onLoad: undefined as (() => void) | undefined,
  paint: vi.fn(),
  refresh: vi.fn(),
  removeLayer: vi.fn(),
  removeSource: vi.fn(),
  sourceLoaded: true,
  listeners: new Map<string, (event?: any) => void>(),
}));
vi.mock("maplibre-gl", () => ({default: {Map: class {
  remove = vi.fn();
  getLayer() { return stub.loaded; }
  isStyleLoaded() { return stub.loaded; }
  setPaintProperty = stub.paint;
  addSource = stub.refresh;
  addLayer = vi.fn();
  removeSource = stub.removeSource;
  removeLayer = stub.removeLayer;
  getStyle() { return {layers: [{id: "tomtom-traffic-flow", type: "raster", source: "tomtomTraffic", paint: {"raster-opacity": 0.55}}]}; }
  isSourceLoaded() { return stub.sourceLoaded; }
  on(event: string, listener: (event?: any) => void) { stub.listeners.set(event, listener); }
  once(_event: string, listener: () => void) { stub.onLoad = listener; }
  off(event: string, listener: () => void) {
    if (stub.onLoad === listener) stub.onLoad = undefined;
    if (stub.listeners.get(event) === listener) stub.listeners.delete(event);
  }
}}}));

beforeEach(() => { stub.loaded = false; stub.sourceLoaded = true; stub.onLoad = undefined; stub.paint.mockClear(); stub.refresh.mockClear(); stub.removeLayer.mockClear(); stub.removeSource.mockClear(); stub.listeners.clear(); });
afterEach(() => vi.useRealTimers());

it("validates the complete map style and renders PNG traffic above the base map", () => {
  const style = createMapStyle("https://example.com/traffic/{z}/{x}/{y}.png?style=relative0");
  expect(validateStyleMin(style)).toEqual([]);
  expect(style.sources.tomtomTraffic).toMatchObject({type: "raster", tileSize: 256});
  const flow = style.layers.find(layer => layer.id === "tomtom-traffic-flow");
  expect(flow).toMatchObject({type: "raster", source: "tomtomTraffic"});
  expect(style.layers[0]).toMatchObject({type: "raster", source: "osm"});
  expect(Object.keys(style.sources)[0]).toBe("osm");
});

it("applies the latest view after asynchronous style loading, then updates traffic opacity", () => {
  const {result, rerender, unmount} = renderHook(({selectedView}) => {
    const hook = useMapIntegration({selectedView, tomTomTrafficTileUrl: "/traffic/{z}/{x}/{y}.png"});
    hook.mapContainerRef.current = document.createElement("div");
    return hook;
  }, {initialProps: {selectedView: "Congestion"}});
  rerender({selectedView: "Weather"});
  expect(result.current.mapInstance).toBeTruthy();
  expect(stub.paint).not.toHaveBeenCalled();
  stub.loaded = true;
  stub.onLoad?.();
  expect(stub.paint).toHaveBeenCalledWith("tomtom-traffic-flow", "raster-opacity", 0.55);
  rerender({selectedView: "Assignments"});
  expect(stub.paint).toHaveBeenCalledWith("tomtom-traffic-flow", "raster-opacity", 0.35);
  rerender({selectedView: "Congestion"});
  expect(stub.paint).toHaveBeenCalledWith("tomtom-traffic-flow", "raster-opacity", 0.95);
  unmount();
  expect(stub.onLoad).toBeUndefined();
});

it("keeps an unlocated tile failure visible when an unrelated traffic tile loads", () => {
  const {result, unmount} = renderHook(() => {
    const hook = useMapIntegration({selectedView: "Congestion", tomTomTrafficTileUrl: "/traffic/{z}/{x}/{y}.png"});
    hook.mapContainerRef.current = document.createElement("div");
    return hook;
  });
  act(() => stub.listeners.get("error")?.({sourceId: "osm"}));
  expect(result.current.trafficError).toBeNull();
  expect(result.current.trafficLoading).toBe(true);
  act(() => stub.listeners.get("error")?.({sourceId: "tomtomTraffic"}));
  expect(result.current.trafficError).toBe("Traffic layer unavailable");
  expect(result.current.trafficLoading).toBe(false);
  act(() => stub.listeners.get("sourcedata")?.({sourceId: "tomtomTraffic", sourceDataType: "metadata"}));
  expect(result.current.trafficError).toBe("Traffic layer unavailable");
  act(() => stub.listeners.get("sourcedata")?.({sourceId: "osm", tile: {state: "loaded"}}));
  expect(result.current.trafficError).toBe("Traffic layer unavailable");
  act(() => stub.listeners.get("sourcedata")?.({sourceId: "tomtomTraffic", tile: {state: "loaded"}}));
  expect(result.current.trafficError).toBe("Some traffic roads unavailable");
  act(() => result.current.retryTraffic());
  expect(result.current.trafficError).toBeNull();
  unmount();
  expect(stub.listeners.size).toBe(0);
});

it("preserves healthy tiles during an outage and reloads traffic only on an explicit retry", () => {
  vi.useFakeTimers();
  const {result, unmount} = renderHook(() => {
    const hook = useMapIntegration({selectedView: "Congestion", tomTomTrafficTileUrl: "/traffic/{z}/{x}/{y}.png"});
    hook.mapContainerRef.current = document.createElement("div");
    return hook;
  });
  const tile = {tileID: {canonical: {z: 14, x: 13770, y: 7701}}};
  const fail = () => stub.listeners.get("error")?.({sourceId: "tomtomTraffic", tile, error: {status: 504}});
  act(fail);
  act(() => stub.listeners.get("sourcedata")?.({sourceId: "tomtomTraffic", tile: {state: "loaded", tileID: {canonical: {z: 14, x: 13771, y: 7701}}}}));
  expect(result.current.trafficError).toBe("Some traffic roads unavailable");
  act(() => vi.advanceTimersByTime(120000));
  expect(stub.refresh).not.toHaveBeenCalled();
  expect(stub.removeSource).not.toHaveBeenCalled();
  act(() => result.current.retryTraffic());
  expect(stub.refresh).toHaveBeenCalledWith("tomtomTraffic", expect.objectContaining({type: "raster", tiles: ["/traffic/{z}/{x}/{y}.png"]}));
  expect(stub.removeSource).toHaveBeenCalledWith("tomtomTraffic");
  expect(stub.removeLayer).toHaveBeenCalledWith("tomtom-traffic-flow");
  expect(result.current.trafficLoading).toBe(true);
  expect(result.current.trafficError).toBeNull();
  // A success arriving before a failed neighbour used to reset the automatic
  // retry budget after each rebuild, allowing repeated whole-layer reloads.
  act(() => stub.listeners.get("sourcedata")?.({sourceId: "tomtomTraffic", tile: {state: "loaded", tileID: {canonical: {z: 14, x: 13771, y: 7701}}}}));
  act(fail);
  expect(result.current.trafficError).toBe("Some traffic roads unavailable");
  act(() => vi.advanceTimersByTime(120000));
  expect(stub.refresh).toHaveBeenCalledTimes(1);
  act(() => stub.listeners.get("sourcedata")?.({sourceId: "tomtomTraffic", tile: {...tile, state: "loaded"}}));
  expect(result.current.trafficError).toBeNull();
  act(() => vi.advanceTimersByTime(60000));
  expect(stub.refresh).toHaveBeenCalledTimes(1);
  act(fail);
  unmount();
  act(() => vi.advanceTimersByTime(60000));
  expect(stub.refresh).toHaveBeenCalledTimes(1);
});

it.each([401, 403, 429])("does not automatically retry access or quota errors (%s)", status => {
  vi.useFakeTimers();
  const {unmount} = renderHook(() => {
    const hook = useMapIntegration({selectedView: "Congestion", tomTomTrafficTileUrl: "/traffic/{z}/{x}/{y}.png"});
    hook.mapContainerRef.current = document.createElement("div");
    return hook;
  });
  act(() => stub.listeners.get("error")?.({sourceId: "tomtomTraffic", error: {status}}));
  act(() => vi.advanceTimersByTime(60000));
  expect(stub.refresh).not.toHaveBeenCalled();
  unmount();
});
