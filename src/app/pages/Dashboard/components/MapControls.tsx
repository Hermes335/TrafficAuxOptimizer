import { Maximize2, Navigation } from "lucide-react";
import type maplibregl from "maplibre-gl";

interface MapControlsProps {
  map: maplibregl.Map | null;
}

export function MapControls({ map }: MapControlsProps) {
  return (
    <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-2">
      <button onClick={() => map?.flyTo({ center: [122.5626, 10.707], zoom: 13 })} className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm hover:bg-gray-50" title="Center map">
        <Navigation className="h-4 w-4 text-gray-600" />
      </button>
      <button onClick={() => map?.zoomIn()} className="rounded-lg border border-gray-200 bg-white px-3 py-1 shadow-sm hover:bg-gray-50">
        <span className="text-sm font-bold text-gray-600">+</span>
      </button>
      <button onClick={() => map?.zoomOut()} className="rounded-lg border border-gray-200 bg-white px-3 py-1 shadow-sm hover:bg-gray-50">
        <span className="text-sm font-bold text-gray-600">-</span>
      </button>
      <button onClick={() => map?.flyTo({ pitch: 0, bearing: 0 })} className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm hover:bg-gray-50" title="Reset view">
        <Maximize2 className="h-4 w-4 text-gray-600" />
      </button>
    </div>
  );
}
