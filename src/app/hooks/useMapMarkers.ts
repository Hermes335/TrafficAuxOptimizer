import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import { getRelativeCongestionSeverity, getSeverityColor, computeRelativeThresholds } from "../types/severity";
import type { Bottleneck, Incident, POI } from "../services/backend";
import { updatePOI, updateIncident } from "../services/backend";

interface UseMapMarkersOptions {
  mapRef: React.RefObject<maplibregl.Map | null>;
  markersRef: React.MutableRefObject<maplibregl.Marker[]>;
  hasFittedRef: React.MutableRefObject<boolean>;
  filteredBottlenecks: Bottleneck[];
  incidents: Incident[];
  pois?: POI[];
  selectedBottleneckId?: string | null;
  onMarkerClick: (bottleneck: Bottleneck) => void;
  onIncidentRemove?: (id: number) => void;
  onPoiUpdated?: (poi: POI) => void;
  onIncidentUpdated?: (id: number) => void;
}

export function useMapMarkers({
  mapRef,
  markersRef,
  hasFittedRef,
  filteredBottlenecks,
  incidents,
  pois = [],
  selectedBottleneckId = null,
  onMarkerClick,
  onIncidentRemove,
  onPoiUpdated,
  onIncidentUpdated,
}: UseMapMarkersOptions) {
  // Track if the map style is ready (handles navigation back where map re-initializes)
  const mapReady = !!mapRef.current;

  useEffect(() => {
    if (!mapRef.current) return;

    // Wait for map style to be loaded before rendering markers
    const map = mapRef.current;
    const renderMarkers = () => {
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
      markerEl.style.width = "28px";
      markerEl.style.height = "28px";

      const innerCircle = document.createElement("div");
      innerCircle.style.width = "16px";
      innerCircle.style.height = "16px";
      innerCircle.style.backgroundColor = color;
      innerCircle.style.borderRadius = "50%";
      innerCircle.style.border = "2px solid white";
      innerCircle.style.boxShadow = "0 2px 6px rgba(0,0,0,0.25)";
      innerCircle.style.position = "relative";
      innerCircle.style.transition = "border 0.15s ease, box-shadow 0.15s ease";

      if (isCritical) {
        innerCircle.className = "map-marker-pulse";
        innerCircle.style.animation = "beacon-pulse 2s infinite";
      }

      markerEl.appendChild(innerCircle);
      markerEl.style.cursor = "pointer";
      markerEl.setAttribute("data-bottleneck-id", bottleneck.id);
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

      const severityLevel = incident.severity || incident.type;
      const severity = severityColorMap[severityLevel === "critical" ? "critical" : severityLevel === "major" ? "major" : "minor"]
        || severityColorMap.minor;
      const incidentKind = incident.incident_type || incident.type;
      const iconSvg = incidentIcons[incidentKind] || incidentIcons.other;
      const typeLabel = incidentTypeLabels[incidentKind] || "Incident";
      const isCritical = severityLevel === "critical";

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
        ring.style.top = "-4px";
        ring.style.left = "50%";
        ring.style.transform = "translateX(-50%)";
        ring.style.width = "32px";
        ring.style.height = "32px";
        ring.style.borderRadius = "50%";
        ring.style.border = `2px solid ${severity.ring}`;
        ring.style.opacity = "0.7";
        ring.style.animation = "beacon-pulse 1.5s infinite";
        ring.style.pointerEvents = "none";
        markerEl.appendChild(ring);
      }

      // ── Main icon container ──
      const iconBox = document.createElement("div");
      iconBox.style.width = "24px";
      iconBox.style.height = "24px";
      iconBox.style.borderRadius = "50%";
      iconBox.style.backgroundColor = severity.bg;
      iconBox.style.display = "flex";
      iconBox.style.alignItems = "center";
      iconBox.style.justifyContent = "center";
      iconBox.style.border = "2px solid white";
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
      const editBtnId = `edit-incident-${incident.id}`;
      const popup = new maplibregl.Popup({ offset: 10, closeButton: true, maxWidth: "240px" }).setHTML(
        `<div style="font-family:Inter,system-ui,sans-serif;padding:2px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:9px;font-weight:700;text-transform:uppercase;background:${severity.bg};color:white">${severity.label}</span>
            <span style="font-size:10px;color:#6b7280;text-transform:capitalize">${typeLabel}</span>
          </div>
          <div style="font-size:12px;font-weight:600;color:#111827;margin-bottom:4px">${incident.text}</div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <a href="/incident-report/${incident.id}" style="flex:1;text-align:center;padding:5px 8px;background:#fbbf24;color:white;border:1px solid #f59e0b;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;text-decoration:none;font-family:Inter,system-ui,sans-serif">
              Edit
            </a>
            ${onIncidentRemove ? `<button id="${removeBtnId}" style="flex:1;padding:5px 8px;background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;font-family:Inter,system-ui,sans-serif">
              Remove
            </button>` : ""}
          </div>
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

    // ─── POI Markers (subtle, secondary to bottleneck markers) ──────────
    const poiCategoryConfig: Record<string, { color: string; icon: string; label: string }> = {
      hospital:       { color: "#fca5a5", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#991b1b" stroke-width="3" stroke-linecap="round"><line x1="12" y1="4" x2="12" y2="20"/><line x1="4" y1="12" x2="20" y2="12"/></svg>`, label: "Hospital" },
      fire_station:   { color: "#fed7aa", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9a3412" stroke-width="2.5" stroke-linecap="round"><path d="M12 2c-3 3-5 7-5 11a5 5 0 0 0 10 0c0-4-2-8-5-11z"/></svg>`, label: "Fire Station" },
      police_station: { color: "#bfdbfe", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#1e3a5f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L3 7v3h18V7L12 2z"/><path d="M5 10v8h14v-8"/><path d="M9 18v3h6v-3"/></svg>`, label: "Police Station" },
      market:         { color: "#e9d5ff", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#581c87" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9"/><path d="M3 9h18v2a9 9 0 0 1-18 0V9z"/><path d="M6 13v4m4-4v4m4-4v4m4-4v4"/></svg>`, label: "Market" },
      other:          { color: "#e0e7ff", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#3730a3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`, label: "POI" },
    };

    for (const poi of pois) {
      const config = poiCategoryConfig[poi.category] || poiCategoryConfig.other;
      const markerEl = document.createElement("div");
      markerEl.style.cursor = "pointer";
      markerEl.style.display = "flex";
      markerEl.style.alignItems = "center";
      markerEl.style.justifyContent = "center";
      markerEl.style.width = "16px";
      markerEl.style.height = "16px";
      markerEl.style.borderRadius = "50%";
      markerEl.style.backgroundColor = config.color;
      markerEl.style.border = "1.5px solid white";
      markerEl.style.boxShadow = "0 1px 2px rgba(0,0,0,0.15)";
      markerEl.style.opacity = "0.85";
      markerEl.innerHTML = config.icon;

      const editFormId = `poi-edit-${poi.poi_id}`;
      const saveBtnId = `poi-save-${poi.poi_id}`;
      const deleteBtnId = `poi-del-${poi.poi_id}`;
      const boostLabel = poi.priority_boost > 1 ? ` (${poi.priority_boost}x priority)` : "";
      const categoryOptions = Object.entries(poiCategoryConfig).map(
        ([key, val]) => `<option value="${key}" ${key === poi.category ? "selected" : ""}>${val.label}</option>`,
      ).join("");

      const popup = new maplibregl.Popup({ offset: 8, closeButton: true, maxWidth: "220px" }).setHTML(
        `<div style="font-family:Inter,system-ui,sans-serif;padding:2px" id="${editFormId}">
          <div style="font-size:11px;font-weight:700;color:${config.color};margin-bottom:6px;text-transform:uppercase">${config.label}</div>
          <label style="font-size:10px;color:#6b7280;display:block;margin-bottom:2px">Name</label>
          <input id="${editFormId}-name" type="text" value="${poi.name}" style="width:100%;padding:3px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:11px;margin-bottom:6px;box-sizing:border-box" />
          <label style="font-size:10px;color:#6b7280;display:block;margin-bottom:2px">Category</label>
          <select id="${editFormId}-cat" style="width:100%;padding:3px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:11px;margin-bottom:6px;box-sizing:border-box">${categoryOptions}</select>
          <label style="font-size:10px;color:#6b7280;display:block;margin-bottom:2px">Priority Boost</label>
          <input id="${editFormId}-boost" type="number" value="${poi.priority_boost}" min="1" max="5" step="0.5" style="width:100%;padding:3px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:11px;margin-bottom:8px;box-sizing:border-box" />
          <div style="display:flex;gap:6px">
            <button id="${saveBtnId}" style="flex:1;padding:5px 8px;background:${config.color};color:white;border:none;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;font-family:Inter,system-ui,sans-serif">Save</button>
            <button id="${deleteBtnId}" style="flex:1;padding:5px 8px;background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;font-family:Inter,system-ui,sans-serif">Delete</button>
          </div>
        </div>`,
      );

      popup.on("open", () => {
        const saveBtn = document.getElementById(saveBtnId);
        if (saveBtn) {
          saveBtn.addEventListener("click", async () => {
            const nameEl = document.getElementById(`${editFormId}-name`) as HTMLInputElement;
            const catEl = document.getElementById(`${editFormId}-cat`) as HTMLSelectElement;
            const boostEl = document.getElementById(`${editFormId}-boost`) as HTMLInputElement;
            try {
              const updated = await updatePOI(poi.poi_id, {
                name: nameEl.value,
                category: catEl.value,
                priority_boost: Number(boostEl.value),
              });
              onPoiUpdated?.(updated);
              popup.remove();
            } catch {
              // silent
            }
          });
        }
        const delBtn = document.getElementById(deleteBtnId);
        if (delBtn) {
          delBtn.addEventListener("click", async () => {
            const { deletePOI } = await import("../services/backend");
            try {
              await deletePOI(poi.poi_id);
              onPoiUpdated?.({ ...poi, is_active: false });
              popup.remove();
            } catch {
              // silent
            }
          });
        }
      });

      const marker = new maplibregl.Marker({ element: markerEl })
        .setLngLat([poi.longitude, poi.latitude])
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
        // Include POI locations in bounds
        for (const p of pois) {
          bounds.extend([p.longitude, p.latitude]);
        }
        mapRef.current.fitBounds(bounds, { padding: 80, duration: 600, maxZoom: 14 });
        hasFittedRef.current = true;
      }
    };

    // If map style is already loaded, render immediately; otherwise wait for load event
    if (map.isStyleLoaded()) {
      renderMarkers();
    } else {
      map.once("load", renderMarkers);
      return () => { map.off("load", renderMarkers); };
    }
  }, [filteredBottlenecks, incidents, pois, mapRef, markersRef, hasFittedRef, onMarkerClick, onIncidentRemove, onPoiUpdated, onIncidentUpdated, mapReady]);

  // Update selected marker styling without full re-render
  useEffect(() => {
    const markers = markersRef.current;
    if (!markers) return;
    for (const marker of markers) {
      const el = marker.getElement();
      const id = el.getAttribute("data-bottleneck-id");
      if (!id) continue;
      const inner = el.firstChild as HTMLElement;
      if (!inner) continue;
      if (id === selectedBottleneckId) {
        inner.style.border = "3px solid #3b82f6";
        inner.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.4), 0 0 12px rgba(59,130,246,0.3)";
      } else {
        inner.style.border = "2px solid white";
        inner.style.boxShadow = "0 2px 6px rgba(0,0,0,0.25)";
      }
    }
  }, [selectedBottleneckId, markersRef]);
}
