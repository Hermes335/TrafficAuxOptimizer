import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import { getRelativeCongestionSeverity, getSeverityColor, computeRelativeThresholds } from "../types/severity";
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

    // Compute relative thresholds from current dataset
    const thresholds = computeRelativeThresholds(filteredBottlenecks);

    // Render bottleneck markers
    for (const bottleneck of filteredBottlenecks) {
      const markerEl = document.createElement("div");
      const severity = getRelativeCongestionSeverity(bottleneck, thresholds);
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

    // ─── Incident Markers ─────────────────────────────────────────────────
    const incidentIcons: Record<string, string> = {
      collision: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
      road_closure: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
      construction: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M12 12h.01"/><path d="M17 12h.01"/><path d="M7 12h.01"/></svg>`,
      flooding: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`,
      other: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>`,
    };

    const severityColorMap: Record<string, { bg: string; ring: string; glow: string; label: string }> = {
      critical: { bg: "#dc2626", ring: "#fca5a5", glow: "0 0 12px 3px rgba(220,38,38,0.5)", label: "CRITICAL" },
      major:    { bg: "#ea580c", ring: "#fdba74", glow: "0 0 8px 2px rgba(234,88,12,0.4)", label: "MAJOR" },
      minor:    { bg: "#ca8a04", ring: "#fde047", glow: "0 0 6px 2px rgba(202,138,4,0.3)", label: "MINOR" },
    };

    const incidentTypeLabels: Record<string, string> = {
      collision: "Collision",
      road_closure: "Road Closure",
      construction: "Construction",
      flooding: "Flooding",
      other: "Incident",
    };

    for (const incident of incidents) {
      if (!incident.latitude || !incident.longitude) continue;

      const severity = severityColorMap[incident.type === "critical" ? "critical" : incident.type === "major" ? "major" : "minor"]
        || severityColorMap.minor;
      const iconSvg = incidentIcons[incident.type] || incidentIcons.other;
      const typeLabel = incidentTypeLabels[incident.type] || "Incident";
      const isCritical = incident.type === "critical";

      // ── Outer wrapper ──
      const markerEl = document.createElement("div");
      markerEl.style.position = "relative";
      markerEl.style.cursor = "pointer";
      markerEl.style.display = "flex";
      markerEl.style.flexDirection = "column";
      markerEl.style.alignItems = "center";

      // ── Pulsing ring (critical only) ──
      if (isCritical) {
        const ring = document.createElement("div");
        ring.style.position = "absolute";
        ring.style.top = "-6px";
        ring.style.left = "50%";
        ring.style.transform = "translateX(-50%)";
        ring.style.width = "44px";
        ring.style.height = "44px";
        ring.style.borderRadius = "50%";
        ring.style.border = `2px solid ${severity.ring}`;
        ring.style.opacity = "0.7";
        ring.style.animation = "beacon-pulse 1.5s infinite";
        ring.style.pointerEvents = "none";
        markerEl.appendChild(ring);
      }

      // ── Main icon container ──
      const iconBox = document.createElement("div");
      iconBox.style.width = "34px";
      iconBox.style.height = "34px";
      iconBox.style.borderRadius = "50%";
      iconBox.style.backgroundColor = severity.bg;
      iconBox.style.display = "flex";
      iconBox.style.alignItems = "center";
      iconBox.style.justifyContent = "center";
      iconBox.style.border = "3px solid white";
      iconBox.style.boxShadow = severity.glow;
      iconBox.innerHTML = iconSvg;
      markerEl.appendChild(iconBox);

      // ── Type label below ──
      const label = document.createElement("div");
      label.textContent = typeLabel;
      label.style.marginTop = "3px";
      label.style.fontSize = "9px";
      label.style.fontWeight = "700";
      label.style.fontFamily = "Inter, system-ui, sans-serif";
      label.style.textTransform = "uppercase";
      label.style.letterSpacing = "0.05em";
      label.style.color = severity.bg;
      label.style.backgroundColor = "rgba(255,255,255,0.92)";
      label.style.padding = "1px 5px";
      label.style.borderRadius = "3px";
      label.style.whiteSpace = "nowrap";
      label.style.boxShadow = "0 1px 3px rgba(0,0,0,0.12)";
      label.style.lineHeight = "1.4";
      label.style.pointerEvents = "none";
      markerEl.appendChild(label);

      // ── Popup ──
      const removeBtnId = `remove-incident-${incident.id}`;
      const popup = new maplibregl.Popup({ offset: 16, closeButton: true, maxWidth: "260px" }).setHTML(
        `<div style="font-family:Inter,system-ui,sans-serif;padding:2px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
            <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;background:${severity.bg};color:white">${severity.label}</span>
            <span style="font-size:11px;color:#6b7280;text-transform:capitalize">${typeLabel}</span>
          </div>
          <div style="font-size:14px;font-weight:600;color:#111827;margin-bottom:4px">${incident.text}</div>
          <div style="font-size:11px;color:#9ca3af;margin-bottom:10px">Incident ID: ${incident.id}</div>
          <button id="${removeBtnId}" style="width:100%;padding:6px 12px;background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:background 0.15s;font-family:Inter,system-ui,sans-serif">
            Remove Incident
          </button>
        </div>`,
      );

      popup.on("open", () => {
        const btn = document.getElementById(removeBtnId);
        if (btn && onIncidentRemove) {
          btn.addEventListener("click", () => {
            onIncidentRemove(incident.id);
            popup.remove();
          });
        }
      });

      const marker = new maplibregl.Marker({ element: markerEl, anchor: "center" })
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
