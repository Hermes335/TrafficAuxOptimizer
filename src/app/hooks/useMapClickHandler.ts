import {useEffect} from "react";
import type maplibregl from "maplibre-gl";

interface Options {
  map: maplibregl.Map | null;
  addMode: "bottleneck" | "incident" | "poi" | null;
  setPendingPoint: (point: {latitude:number; longitude:number}) => void;
  editPickFromMap: boolean;
  setEditLatitude: (value:string) => void;
  setEditLongitude: (value:string) => void;
  setBottleneckActionError: (value:string | null) => void;
  setBottleneckActionNotice: (value:string | null) => void;
}
export function useMapClickHandler({map, addMode, setPendingPoint, editPickFromMap, setEditLatitude, setEditLongitude, setBottleneckActionError, setBottleneckActionNotice}: Options) {
  useEffect(() => {
    if (!map || (!addMode && !editPickFromMap)) return;
    const onClick = (event: maplibregl.MapMouseEvent) => {
      const latitude = Number(event.lngLat.lat.toFixed(6));
      const longitude = Number(event.lngLat.lng.toFixed(6));
      if (addMode) setPendingPoint({latitude, longitude});
      if (editPickFromMap) { setEditLatitude(String(latitude)); setEditLongitude(String(longitude)); }
      setBottleneckActionError(null); setBottleneckActionNotice(null);
    };
    map.getCanvas().style.cursor = "crosshair";
    map.on("click", onClick);
    return () => { map.off("click", onClick); map.getCanvas().style.cursor = ""; };
  }, [map, addMode, editPickFromMap, setPendingPoint, setEditLatitude, setEditLongitude, setBottleneckActionError, setBottleneckActionNotice]);
}
