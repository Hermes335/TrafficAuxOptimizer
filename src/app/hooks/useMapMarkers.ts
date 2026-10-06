import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { getCongestionSeverity, getSeverityColor } from "../types/severity";
import type { Bottleneck, Incident, POI } from "../services/backend";
import { updatePOI, deletePOI } from "../services/backend";
import { popupCard, poiPopup } from "../services/mapPopup";
import { createPoiMarkerElement, updatePoiMarkerElement } from "../services/poiMarker";

interface UseMapMarkersOptions {
  mapRef: React.RefObject<maplibregl.Map | null>;
  markersRef: React.MutableRefObject<maplibregl.Marker[]>;
  hasFittedRef: React.MutableRefObject<boolean>;
  filteredBottlenecks: Bottleneck[];
  incidents: Incident[];
  pois?: POI[];
  selectedBottleneckId?: string | null;
  onMarkerClick: (bottleneck: Bottleneck) => void;
  onIncidentRemove?: (id: number) => Promise<void>;
  onPoiUpdated?: (poi: POI) => void;
  onIncidentUpdated?: (id: number) => void;
}
export function useMapMarkers(options: UseMapMarkersOptions) {
  const callbacks = useRef(options);
  callbacks.current = options;
  const entries = useRef(new Map<string, {marker: maplibregl.Marker; signature: string}>());
  const {mapRef, markersRef, hasFittedRef, filteredBottlenecks, incidents, pois = [], selectedBottleneckId} = options;
  const map = mapRef.current;

  useEffect(() => {
    if (!map) return;
    const render = () => {
      const keep = new Set<string>();
      const upsert = (key: string, row: {latitude?: number; longitude?: number}, signature: string, color: string, title: string, content: () => HTMLElement, onClick?: () => void, poiCategory?: string) => {
        if (row.latitude == null || row.longitude == null || !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) return;
        keep.add(key);
        let entry = entries.current.get(key);
        if (!entry) {
          const element = poiCategory !== undefined ? createPoiMarkerElement(poiCategory, title) : document.createElement("button");
          if (poiCategory === undefined) {
            element.type = "button"; element.setAttribute("aria-label", title);
            element.className = "rounded-full border-2 border-white shadow-md";
            element.style.width = element.style.height = "24px";
            element.style.backgroundColor = color;
          }
          if (onClick) element.addEventListener("click", onClick);
          const marker = new maplibregl.Marker({element, offset: poiCategory === undefined ? [0, 0] : [0, -17]}).setLngLat([row.longitude, row.latitude]).addTo(map);
          entry = {marker, signature: ""};
          entries.current.set(key, entry);
        }
        const element = entry.marker.getElement();
        if (poiCategory !== undefined) updatePoiMarkerElement(element as HTMLButtonElement, poiCategory, title);
        else { element.setAttribute("aria-label", title); element.style.backgroundColor = color; }
        const selectedArea=filteredBottlenecks.find(b=>b.id===selectedBottleneckId)?.area_name;
        const grouped=!!selectedArea&&filteredBottlenecks.some(b=>key==="b:"+b.id&&b.area_name===selectedArea);
        element.style.outline = key === "b:" + selectedBottleneckId ? "3px solid #2563eb" : grouped?"3px solid #a855f7":"";
        if (entry.signature !== signature) {
          const wasOpen = entry.marker.getPopup()?.isOpen();
          entry.marker.setLngLat([row.longitude, row.latitude]);
          const popup = new maplibregl.Popup({offset: 12, maxWidth: "260px"}).setDOMContent(content());
          entry.marker.setPopup(popup);
          if (wasOpen) entry.marker.togglePopup();
          entry.signature = signature;
        }
      };
      for (const b of filteredBottlenecks) {
        upsert("b:" + b.id, b, JSON.stringify(b), getSeverityColor(getCongestionSeverity(b)), b.name,
          () => popupCard(b.name, [b.id, `Area: ${b.area_name||"Ungrouped"}`, `Congestion: ${Math.round((b.tsi ?? 0) * 100)}%`, `Now: ${b.current_assigned??"—"} assigned / ${b.current_required??"—"} required`, ...(b.current_required===0?["No officers required now"]:[])]),
          () => { const current = callbacks.current.filteredBottlenecks.find(item => item.id === b.id); if(current) callbacks.current.onMarkerClick(current); });
      }
      for (const incident of incidents) {
        upsert("i:" + incident.id, incident, JSON.stringify(incident), "#dc2626", incident.text, () => {
          const content = popupCard(incident.text, [`Incident severity: ${incident.type}`]);
          const edit = document.createElement("a");
          edit.href = "/incident-report/" + encodeURIComponent(incident.id); edit.textContent = "Edit incident"; content.append(edit);
          if (callbacks.current.onIncidentRemove) {
            const button = document.createElement("button");
            button.textContent = "Resolve"; button.className = "ml-2 rounded border p-1";
            const error = document.createElement("p"); error.setAttribute("role", "alert");
            button.addEventListener("click", async () => {
              button.disabled = true;
              try { await callbacks.current.onIncidentRemove?.(incident.id); }
              catch (err) { error.textContent = err instanceof Error ? err.message : "Unable to resolve incident."; }
              finally { button.disabled = false; }
            });
            content.append(button, error);
          }
          return content;
        });
      }
      for (const poi of pois) {
        upsert("poi:" + poi.poi_id, poi, JSON.stringify(poi), "#2563eb", poi.name, () => poiPopup(poi,
          async data => { callbacks.current.onPoiUpdated?.(await updatePOI(poi.poi_id, data)); },
          async () => { await deletePOI(poi.poi_id); callbacks.current.onPoiUpdated?.({...poi, is_active:false}); }), undefined, poi.category);
      }
      for (const [key, entry] of entries.current) {
        if (!keep.has(key)) { entry.marker.remove(); entries.current.delete(key); }
      }
      markersRef.current = Array.from(entries.current.values(), entry => entry.marker);
      if (!hasFittedRef.current && filteredBottlenecks.length > 1) {
        const first = filteredBottlenecks[0];
        const bounds = new maplibregl.LngLatBounds([first.longitude, first.latitude], [first.longitude, first.latitude]);
        filteredBottlenecks.forEach(b => bounds.extend([b.longitude, b.latitude]));
        map.fitBounds(bounds, {padding:80, maxZoom:14}); hasFittedRef.current = true;
      }
    };
    // Markers attach to the map container and do not need raster tiles to load.
    render();
  }, [map, filteredBottlenecks, incidents, pois, selectedBottleneckId, markersRef, hasFittedRef]);

  useEffect(() => () => {
    entries.current.forEach(entry => entry.marker.remove()); entries.current.clear();
  }, [map]);
}
