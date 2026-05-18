import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import { getCongestionSeverity, getSeverityColor } from "../types/severity";
import type { Bottleneck, Incident } from "../services/backend";

interface UseMapMarkersOptions {
  mapRef: React.RefObject<maplibregl.Map | null>;
  markersRef: React.RefObject<maplibregl.Marker[]>;
  hasFittedRef: React.MutableRefObject<boolean>;
  filteredBottlenecks: Bottleneck[];
  incidents: Incident[];
  onMarkerClick: (bottleneck: Bottleneck) => void;
  onIncidentRemove?: (id: number) => void;
}

export function useMapMarkers({
  mapRef,
  markersRef,
  hasFittedRef,
  filteredBottlenecks,
  incidents,
  onMarkerClick,
  onIncidentRemove,
}: UseMapMarkersOptions) {
  useEffect(() => {
    if (!mapRef.current) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    // Render bottleneck markers
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

    // Render incident markers (red diamonds)
    for (const incident of incidents) {
      if (!incident.latitude || !incident.longitude) continue;

      const markerEl = document.createElement("div");
      markerEl.style.width = "28px";
      markerEl.style.height = "28px";
      markerEl.style.cursor = "pointer";
      markerEl.style.transform = "rotate(45deg)";

      const innerDiamond = document.createElement("div");
      innerDiamond.style.width = "20px";
      innerDiamond.style.height = "20px";
      innerDiamond.style.backgroundColor = incident.type === "critical" ? "#dc2626" : incident.type === "major" ? "#ea580c" : "#ca8a04";
      innerDiamond.style.border = "2px solid white";
      innerDiamond.style.boxShadow = "0 2px 6px rgba(0,0,0,0.25)";
      innerDiamond.style.borderRadius = "3px";
      innerDiamond.style.animation = "beacon-pulse 2s infinite";

      markerEl.appendChild(innerDiamond);

      // Popup with incident info and remove button
      const removeBtnId = `remove-incident-${incident.id}`;
      const popup = new maplibregl.Popup({ offset: 12 }).setHTML(
        `<div style="min-width:140px">
          <div style="font-weight:600;color:#dc2626;margin-bottom:4px">INCIDENT</div>
          <div style="font-size:13px;margin-bottom:4px">${incident.text}</div>
          <div style="font-size:11px;color:#6b7280;margin-bottom:8px">Type: ${incident.type}</div>
          <button id="${removeBtnId}" style="width:100%;padding:4px 8px;background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer">Remove Incident</button>
        </div>`,
      );

      // Add click handler for remove button after popup opens
      popup.on("open", () => {
        const btn = document.getElementById(removeBtnId);
        if (btn && onIncidentRemove) {
          btn.addEventListener("click", () => {
            onIncidentRemove(incident.id);
            popup.remove();
          });
        }
      });

      const marker = new maplibregl.Marker({ element: markerEl, rotation: 0 })
        .setLngLat([incident.longitude, incident.latitude])
        .setPopup(popup)
        .addTo(mapRef.current);

      markersRef.current.push(marker);
    }

    // Fit bounds on first load
    if (!hasFittedRef.current && filteredBottlenecks.length > 1 && mapRef.current) {
      const bounds = new maplibregl.LngLatBounds(
        [filteredBottlenecks[0].longitude, filteredBottlenecks[0].latitude],
        [filteredBottlenecks[0].longitude, filteredBottlenecks[0].latitude],
      );
      for (const point of filteredBottlenecks) {
        bounds.extend([point.longitude, point.latitude]);
      }
      // Include incident locations in bounds
      for (const inc of incidents) {
        if (inc.latitude && inc.longitude) {
          bounds.extend([inc.longitude, inc.latitude]);
        }
      }
      mapRef.current.fitBounds(bounds, { padding: 80, duration: 600, maxZoom: 14 });
      hasFittedRef.current = true;
    }
  }, [filteredBottlenecks, incidents, mapRef, markersRef, hasFittedRef, onMarkerClick, onIncidentRemove]);
}
