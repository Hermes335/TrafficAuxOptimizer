import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import { createPOI, type DashboardSnapshot, type POI } from "../services/backend";

interface UseMapClickHandlerOptions {
  mapRef: React.RefObject<maplibregl.Map | null>;
  addMode: "bottleneck" | "incident" | "poi" | null;
  setAddMode: (v: null) => void;
  setPendingPoint: (point: { latitude: number; longitude: number }) => void;
  editPickFromMap: boolean;
  setEditLatitude: (v: string) => void;
  setEditLongitude: (v: string) => void;
  setDashboardSnapshot: React.Dispatch<React.SetStateAction<DashboardSnapshot>>;
  setSelectedBottleneckId: (v: string) => void;
  setPois: React.Dispatch<React.SetStateAction<POI[]>>;
  setBottleneckActionError: (v: string | null) => void;
  setBottleneckActionNotice: (v: string | null) => void;
}

export function useMapClickHandler({
  mapRef,
  addMode,
  setAddMode,
  setPendingPoint,
  editPickFromMap,
  setEditLatitude,
  setEditLongitude,
  setDashboardSnapshot,
  setSelectedBottleneckId,
  setPois,
  setBottleneckActionError,
  setBottleneckActionNotice,
}: UseMapClickHandlerOptions) {
  useEffect(() => {
    if (!mapRef.current) return;

    const map = mapRef.current;
    const onMapClick = (event: maplibregl.MapMouseEvent) => {
      const latitude = Number(event.lngLat.lat.toFixed(6));
      const longitude = Number(event.lngLat.lng.toFixed(6));

      if (addMode) {
        if (addMode === "bottleneck") {
          // Store the clicked coordinates for the bottleneck creation form
          // Do NOT create a local bottleneck - let the user fill the form and submit via API
          setPendingPoint({ latitude, longitude });
          // Keep addMode as "bottleneck" so the form stays open
          // The form will use pendingPoint for latitude/longitude when submitted
        } else if (addMode === "incident") {
          const id = Math.floor(Math.random() * 10000);
          setDashboardSnapshot((prev) => ({
            ...prev,
            incidents: [...prev.incidents, { id, text: `New Incident ${id}`, type: "major" as const, latitude, longitude }],
          }));
          setAddMode(null);
        } else if (addMode === "poi") {
          // Persist POI to backend
          createPOI({ name: "New POI", category: "other", latitude, longitude, priority_boost: 1.0 })
            .then((poi) => {
              setPois((prev) => [...prev, poi]);
            })
            .catch(() => {
              // Fallback: add locally if API fails
              const id = `P-${Math.floor(Math.random() * 10000)}`;
              setPois((prev) => [...prev, { id: 0, poi_id: id, name: "New POI", category: "other", latitude, longitude, icon_url: "", is_active: true, priority_boost: 1.0, created_at: "", updated_at: "" }]);
            });
          setAddMode(null);
        }
      }

      if (editPickFromMap) {
        setEditLatitude(String(latitude));
        setEditLongitude(String(longitude));
      }
      setBottleneckActionError(null);
      setBottleneckActionNotice(null);
    };

    const enableClickCapture = Boolean(addMode) || editPickFromMap;
    map.getCanvas().style.cursor = enableClickCapture ? "crosshair" : "";

    if (enableClickCapture) {
      map.on("click", onMapClick);
    }

    return () => {
      map.getCanvas().style.cursor = "";
      map.off("click", onMapClick);
    };
  }, [addMode, editPickFromMap, mapRef, setAddMode, setPendingPoint, setDashboardSnapshot, setSelectedBottleneckId, setPois, setEditLatitude, setEditLongitude, setBottleneckActionError, setBottleneckActionNotice]);
}
