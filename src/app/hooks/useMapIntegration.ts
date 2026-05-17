import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

const mapCenter: [number, number] = [122.5621, 10.7202];

interface UseMapIntegrationOptions {
  selectedView: string;
  tomTomTrafficTileUrl: string;
}

export function useMapIntegration({ selectedView, tomTomTrafficTileUrl }: UseMapIntegrationOptions) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const hasFittedRef = useRef(false);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      center: mapCenter,
      zoom: 12.6,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
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
            attribution: "© TomTom",
          },
        },
        layers: [
          { id: "osm-base", type: "raster", source: "osm" },
          {
            id: "tomtom-traffic-flow",
            type: "raster",
            source: "tomtomTraffic",
            paint: { "raster-opacity": 0.95, "raster-fade-duration": 350 },
          },
        ],
      },
    });

    mapRef.current = map;

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      hasFittedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [tomTomTrafficTileUrl]);

  useEffect(() => {
    if (!mapRef.current || !mapRef.current.getLayer("tomtom-traffic-flow")) return;

    const opacity =
      selectedView === "Congestion" ? 0.95 : selectedView === "Weather" ? 0.55 : 0.35;

    mapRef.current.setPaintProperty("tomtom-traffic-flow", "raster-opacity", opacity);
  }, [selectedView]);

  return { mapContainerRef, mapRef, markersRef, hasFittedRef };
}
