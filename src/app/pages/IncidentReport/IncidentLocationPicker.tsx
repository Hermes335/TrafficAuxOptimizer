import { Crosshair, MapPin } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { ReportLocation } from "../../services/incidentReporting";

export interface IncidentCoordinates { latitude: number; longitude: number; bottleneck?: string }

export function validCoordinates(point: IncidentCoordinates | null): point is IncidentCoordinates {
  return !!point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
}

export function IncidentLocationPicker({ value, onChange, locations, disabled = false }: {
  value: IncidentCoordinates | null;
  onChange: (point: IncidentCoordinates) => void;
  locations: ReportLocation[];
  disabled?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const changeRef = useRef(onChange);
  const disabledRef = useRef(disabled);
  const mounted = useRef(true);
  const locationRequest = useRef(0);
  const [mapFailed, setMapFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  changeRef.current = next => {
    locationRequest.current += 1;
    setLocating(false);
    setError(null);
    onChange(next);
  };
  disabledRef.current = disabled;

  useEffect(() => {
    mounted.current = true;
    if (!container.current) return;
    let instance: maplibregl.Map | null = null;
    try {
      instance = new maplibregl.Map({
        container: container.current, center: [122.5621, 10.7202], zoom: 12,
        style: {
          version: 8,
          sources: { streets: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>' } },
          layers: [{ id: "streets", type: "raster", source: "streets" }],
        },
      });
      map.current = instance;
      instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      instance.getCanvas().style.cursor = "crosshair";
      instance.on("click", event => {
        if (!disabledRef.current) {
          setError(null);
          changeRef.current({ latitude: event.lngLat.lat, longitude: event.lngLat.wrap().lng });
        }
      });
      instance.on("error", () => { if (mounted.current) setMapFailed(true); });
      instance.on("idle", () => { if (mounted.current && instance?.areTilesLoaded()) setMapFailed(false); });
    } catch { setMapFailed(true); }
    return () => {
      mounted.current = false;
      locationRequest.current += 1;
      marker.current?.remove(); marker.current = null;
      instance?.remove(); map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!value) { marker.current?.remove(); marker.current = null; setLatitude(""); setLongitude(""); return; }
    setLatitude(value.latitude.toFixed(6));
    setLongitude(value.longitude.toFixed(6));
    if (!map.current) return;
    if (!marker.current) {
      marker.current = new maplibregl.Marker({ color: "#d97706", draggable: !disabled })
        .setLngLat([value.longitude, value.latitude]).addTo(map.current);
      marker.current.getElement().setAttribute("aria-label", "Selected incident location. Drag to adjust, or use the coordinate fields below.");
      marker.current.on("dragend", () => {
        if (disabledRef.current) return;
        const point = marker.current?.getLngLat();
        if (point) changeRef.current({ latitude: point.lat, longitude: point.wrap().lng });
      });
    } else marker.current.setLngLat([value.longitude, value.latitude]);
    marker.current.setDraggable(!disabled);
    map.current.easeTo({ center: [value.longitude, value.latitude], duration: 300 });
  }, [value, disabled]);

  const useMyLocation = () => {
    if (!navigator.geolocation) { setError("Location is unavailable in this browser. Place a pin or enter coordinates instead."); return; }
    const request = ++locationRequest.current;
    setError(null); setLocating(true);
    navigator.geolocation.getCurrentPosition(position => {
      if (!mounted.current || request !== locationRequest.current) return;
      setLocating(false);
      if (!disabledRef.current) changeRef.current({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    }, failure => {
      if (!mounted.current || request !== locationRequest.current) return;
      setLocating(false);
      setError(failure.code === 1 ? "Location permission was denied. You can still place a pin on the map."
        : "We could not find your location. Place a pin or enter coordinates instead.");
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };

  return <div className="space-y-4">
    <p className="text-sm leading-relaxed text-slate-600">Tap the incident location on the map. Drag the pin to fine-tune its position.</p>
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
      <div ref={container} className="h-72 w-full sm:h-80 lg:h-[420px]" aria-label="Incident location map" />
      {!value && <div className="pointer-events-none absolute inset-x-3 top-3 mr-12 rounded-lg bg-white/95 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm">Tap the map to place your pin</div>}
    </div>
    {mapFailed && <p role="status" className="text-sm text-amber-800">The map could not load completely. You can choose a known location or enter coordinates below.</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" onClick={useMyLocation} disabled={disabled || locating} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">
        <Crosshair size={17} />{locating ? "Finding your location..." : "Use my location"}
      </button>
      <span className={`flex items-center gap-1.5 text-xs font-medium ${value ? "text-emerald-700" : "text-slate-500"}`}><MapPin size={15} />{value ? "Pin selected" : "No pin selected"}</span>
    </div>
    {value && <p className="font-mono text-xs text-slate-600" aria-live="polite">Selected: {value.latitude.toFixed(6)}, {value.longitude.toFixed(6)}</p>}
    <div>
      <label htmlFor="incident-known-location" className="mb-1.5 block text-sm font-medium text-slate-700">Or choose a known intersection</label>
      <select id="incident-known-location" value="" disabled={disabled || !locations.length}
        onChange={event => { const item = locations.find(row => row.id === event.target.value); if (item) changeRef.current({ latitude: Number(item.latitude), longitude: Number(item.longitude), bottleneck: item.id }); }}
        className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 disabled:bg-slate-50">
        <option value="">{locations.length ? "Choose an intersection" : "Place a pin or enter coordinates"}</option>
        {locations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </div>
    <details className="rounded-xl border border-slate-200 px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-slate-700">Enter coordinates manually</summary>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-sm text-slate-700">Latitude<input aria-label="Latitude" type="number" inputMode="decimal" min="-90" max="90" step="any" value={latitude} disabled={disabled} onChange={event => setLatitude(event.target.value)} placeholder="10.720200" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-2" /></label>
        <label className="text-sm text-slate-700">Longitude<input aria-label="Longitude" type="number" inputMode="decimal" min="-180" max="180" step="any" value={longitude} disabled={disabled} onChange={event => setLongitude(event.target.value)} placeholder="122.562100" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-2" /></label>
      </div>
      <button type="button" disabled={disabled} onClick={() => {
        const point = { latitude: Number(latitude), longitude: Number(longitude) };
        if (!latitude.trim() || !longitude.trim() || !validCoordinates(point)) { setError("Enter valid latitude (-90 to 90) and longitude (-180 to 180)."); return; }
        changeRef.current(point);
      }} className="mt-3 min-h-11 rounded-lg bg-slate-100 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-200">Use these coordinates</button>
    </details>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}
