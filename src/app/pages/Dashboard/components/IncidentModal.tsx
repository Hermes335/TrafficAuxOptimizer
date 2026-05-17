import { Camera, MapPin, X } from "lucide-react";
import incidentImage from "../../../../assets/57fa97e8c83f22033790625605fab5b96dfc2d8b.png";
import type { Incident } from "../../../services/backend";

interface IncidentModalProps {
  showIncidentModal: boolean;
  onClose: () => void;
  selectedIncident: Incident | null;
  incidentHeadline: string;
  incidentLocation: string;
}

export function IncidentModal({ showIncidentModal, onClose, selectedIncident, incidentHeadline, incidentLocation }: IncidentModalProps) {
  if (!showIncidentModal) return null;

  return (
    <div className="absolute bottom-8 left-1/2 z-30 w-96 -translate-x-1/2 rounded-xl bg-white p-4 shadow-2xl">
      <button onClick={onClose} className="absolute right-2 top-2 text-gray-400 hover:text-gray-600">
        <X className="h-4 w-4" />
      </button>
      <div className="mb-2 inline-block rounded bg-red-500 px-2 py-1 text-xs font-medium text-white">
        {selectedIncident ? selectedIncident.type.toUpperCase() : "NO ACTIVE INCIDENT"}
      </div>
      <h3 className="mb-1 text-xl font-bold">{incidentHeadline}</h3>
      <p className="mb-3 text-sm text-gray-600">
        <MapPin className="mr-1 inline h-3 w-3" />
        {incidentLocation}
      </p>
      <div className="relative mb-4 overflow-hidden rounded-lg">
        <img src={incidentImage} alt="Incident" className="h-48 w-full object-cover" />
        <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-xs text-white">
          <Camera className="h-3 w-3" />
          Live Feed
        </div>
      </div>
      <div className="mb-4 flex items-center gap-3">
        <img src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=50&h=50&fit=crop" alt="Officer" className="h-10 w-10 rounded-full" />
        <div className="flex-1">
          <div className="font-medium">Live dashboard feed</div>
          <div className="text-xs text-gray-500">{selectedIncident ? `Reported via ${selectedIncident.type} channel` : "Awaiting incident selection"}</div>
        </div>
        <div className="text-sm text-gray-600">{selectedIncident ? `ID: ${selectedIncident.id}` : "ID: --"}</div>
      </div>
      <div className="flex gap-2">
        <button className="flex-1 rounded-lg border-2 border-red-500 py-2 text-sm font-medium text-red-500 hover:bg-red-50">Clear Incident</button>
        <button className="flex-1 rounded-lg bg-yellow-400 py-2 text-sm font-medium text-white hover:bg-yellow-500">Dispatch Support</button>
      </div>
    </div>
  );
}
