import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import { getCongestionSeverity, getSeverityColor } from "../types/severity";
import type { Bottleneck } from "../services/backend";

interface UseMapMarkersOptions {
  mapRef: React.RefObject<maplibregl.Map | null>;
  markersRef: React.RefObject<maplibregl.Marker[]>;
  hasFittedRef: React.MutableRefObject<boolean>;
  filteredBottlenecks: Bottleneck[];
  onMarkerClick: (bottleneck: Bottleneck) => void;
}

export function useMapMarkers({
  mapRef,
  markersRef,
  hasFittedRef,
  filteredBottlenecks,
  onMarkerClick,
}: UseMapMarkersOptions) {
  useEffect(() => {
    if (!mapRef.current) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    for (const bottleneck of filteredBottlenecks) {
      const markerEl = document.createElement("div");
      const severity = getCongestionSeverity(bottleneck);
      const color = getSeverityColor(severity);
      const isCritical = severity === "critical";

      markerEl.className = "flex items-center justify-center";
      markerEl.style.width = "24px";
      markerEl.style.height = "24px";

      const innerCircle = document.createElement("div");
      innerCircle.style.width = "16px";
      innerCircle.style.height = "16px";
      innerCircle.style.backgroundColor = color;
      innerCircle.style.borderRadius = "50%";
      innerCircle.style.border = "2px solid white";
      innerCircle.style.boxShadow = "0 2px 6px rgba(0,0,0,0.25)";
      innerCircle.style.position = "relative";

      if (isCritical) {
        innerCircle.className = "map-marker-pulse";
        innerCircle.style.animation = "beacon-pulse 2s infinite";
      }

      markerEl.appendChild(innerCircle);
      markerEl.style.cursor = "pointer";
      markerEl.addEventListener("click", () => onMarkerClick(bottleneck));

      const tsiPercent = Math.round((Number(bottleneck.tsi) || 0) * 100);
      const popup = new maplibregl.Popup({ offset: 10 }).setHTML(
        `<div><div style="font-weight:600">${bottleneck.id}</div><div>${bottleneck.name}</div><div style="font-size:12px;margin-top:4px">TSI: ${tsiPercent}%</div><div style="text-transform:uppercase;font-size:11px;color:#6b7280">${bottleneck.status}</div></div>`,
      );

      const marker = new maplibregl.Marker({ element: markerEl })
        .setLngLat([bottleneck.longitude, bottleneck.latitude])
        .setPopup(popup)
        .addTo(mapRef.current);

      markersRef.current.push(marker);
    }

    if (!hasFittedRef.current && filteredBottlenecks.length > 1 && mapRef.current) {
      const bounds = new maplibregl.LngLatBounds(
        [filteredBottlenecks[0].longitude, filteredBottlenecks[0].latitude],
        [filteredBottlenecks[0].longitude, filteredBottlenecks[0].latitude],
      );
      for (const point of filteredBottlenecks) {
        bounds.extend([point.longitude, point.latitude]);
      }
      mapRef.current.fitBounds(bounds, { padding: 80, duration: 600, maxZoom: 14 });
      hasFittedRef.current = true;
    }
  }, [filteredBottlenecks, mapRef, markersRef, hasFittedRef, onMarkerClick]);
}
