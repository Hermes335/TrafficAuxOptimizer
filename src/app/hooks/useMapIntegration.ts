import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

const mapCenter: [number, number] = [122.5621, 10.7202];
type TileCoordinates = { z: number; x: number; y: number };
type TrafficTile = { tileID?: { canonical?: TileCoordinates } };
const tileKey = (tile?: TrafficTile) => {
  const id = tile?.tileID?.canonical;
  return id ? `${id.z}/${id.x}/${id.y}` : "unknown";
};

interface UseMapIntegrationOptions {
  selectedView: string;
  tomTomTrafficTileUrl: string;
}

export function createMapStyle(tomTomTrafficTileUrl: string): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      // Both raster sources share MapLibre's image queue. Load the base first
      // so slow traffic proxy requests do not delay the initial street map.
      osm: {
        type: "raster",
        tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
      tomtomTraffic: {
        type: "raster",
        tiles: [tomTomTrafficTileUrl],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 22,
        attribution: "© TomTom",
      },
    },
    layers: [
      { id: "osm-base", type: "raster", source: "osm" },
      {
        id: "tomtom-traffic-flow", type: "raster", source: "tomtomTraffic",
        paint: {
          "raster-opacity": 0.95,
          "raster-fade-duration": 150,
        },
      },
    ],
  };
}

export function useMapIntegration({ selectedView, tomTomTrafficTileUrl }: UseMapIntegrationOptions) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [trafficError, setTrafficError] = useState<string | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(true);
  const retryTrafficRef = useRef<() => void>(() => {});
  const retryTraffic = useCallback(() => retryTrafficRef.current(), []);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const hasFittedRef = useRef(false);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      center: mapCenter,
      zoom: 12.6,
      attributionControl: false,
      style: createMapStyle(tomTomTrafficTileUrl),
    });
    const failedTiles = new Set<string>();
    let hasLoadedTraffic = false;
    const reloadTrafficSource = () => {
      const layer = map.getStyle().layers.find(item => item.id === "tomtom-traffic-flow");
      if (!layer) return;
      // Recreate only the traffic overlay. In MapLibre 5.22, refreshTiles marks
      // failed raster tiles renderable before they have a texture and can crash.
      failedTiles.clear();
      hasLoadedTraffic = false;
      setTrafficError(null);
      setTrafficLoading(true);
      map.removeLayer(layer.id);
      map.removeSource("tomtomTraffic");
      map.addSource("tomtomTraffic", createMapStyle(tomTomTrafficTileUrl).sources.tomtomTraffic);
      map.addLayer(layer);
    };
    const onError = (event: maplibregl.ErrorEvent & { sourceId?: string; tile?: TrafficTile }) => {
      if (event.sourceId !== "tomtomTraffic") return;
      setTrafficLoading(false);
      failedTiles.add(tileKey(event.tile));
      const status = (event.error as Error & { status?: number } | undefined)?.status;
      const accessDenied = status === 401 || status === 403;
      setTrafficError(accessDenied ? "Traffic access denied — check the provider key" : status === 429 ? "Traffic request limit reached — try again shortly" : hasLoadedTraffic ? "Some traffic roads unavailable" : "Traffic layer unavailable");
      // The proxy already retries transient failures. Rebuilding this source
      // automatically reloads healthy tiles too, amplifying a provider outage.
    };
    const onSourceData = (event: maplibregl.MapSourceDataEvent) => {
      if (event.sourceId !== "tomtomTraffic" || event.tile?.state !== "loaded") return;
      setTrafficLoading(false);
      hasLoadedTraffic = true;
      const loadedKey = tileKey(event.tile);
      if (loadedKey !== "unknown") failedTiles.delete(loadedKey);
      // An error without tile coordinates cannot be matched to this success.
      // Keep the partial-coverage notice until the user reloads the source.
      // A healthy neighbouring tile must not hide a failed tile elsewhere.
      if (failedTiles.size === 0 && map.isSourceLoaded("tomtomTraffic")) {
        setTrafficError(null);
      } else if (failedTiles.size > 0) {
        setTrafficError(previous => previous === "Traffic layer unavailable" ? "Some traffic roads unavailable" : previous);
      }
    };
    retryTrafficRef.current = reloadTrafficSource;
    setTrafficError(null);
    setTrafficLoading(true);
    map.on("error", onError);
    map.on("sourcedata", onSourceData);

    mapRef.current = map;
    setMapInstance(map);

    return () => {
      retryTrafficRef.current = () => {};
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      hasFittedRef.current = false;
      map.off("error", onError);
      map.off("sourcedata", onSourceData);
      map.remove();
      mapRef.current = null;
      setMapInstance(null);
    };
  }, [tomTomTrafficTileUrl]);

  useEffect(() => {
    if (!mapInstance) return;
    const applyOpacity = () => {
      const opacity = selectedView === "Congestion" ? 0.95 : selectedView === "Weather" ? 0.55 : 0.35;
      if (mapInstance.getLayer("tomtom-traffic-flow")) mapInstance.setPaintProperty("tomtom-traffic-flow", "raster-opacity", opacity);
    };
    if (mapInstance.isStyleLoaded()) applyOpacity();
    else mapInstance.once("load", applyOpacity);
    return () => { mapInstance.off("load", applyOpacity); };
  }, [mapInstance, selectedView]);

  return { mapContainerRef, mapRef, mapInstance, markersRef, hasFittedRef, trafficError, trafficLoading, retryTraffic };
}
