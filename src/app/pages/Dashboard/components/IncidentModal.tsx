import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../../../components/ui/dialog";
import { MapPin, Pencil } from "lucide-react";
import { Link } from "react-router";
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
    <Dialog open={showIncidentModal} onOpenChange={open => {if (!open) onClose();}}><DialogContent>
      <div className="mb-2 inline-block rounded bg-red-500 px-2 py-1 text-xs font-medium text-white">
        {selectedIncident ? selectedIncident.type.toUpperCase() : "NO ACTIVE INCIDENT"}
      </div>
      <DialogTitle>{incidentHeadline}</DialogTitle><DialogDescription>Saved incident details</DialogDescription>
      <p className="mb-3 text-sm text-gray-600">
        <MapPin className="mr-1 inline h-3 w-3" />
        {incidentLocation}
      </p>
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100 text-yellow-700">
          <MapPin className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="font-medium">Incident reported</div>
          <div className="text-xs text-gray-500">{selectedIncident ? `Type: ${selectedIncident.type}` : "Awaiting incident selection"}</div>
        </div>
        <div className="text-sm text-gray-600">{selectedIncident ? `ID: ${selectedIncident.id}` : "ID: --"}</div>
      </div>
      <div className="flex gap-2">
        {selectedIncident && (
          <Link
            to={`/incident-report/${selectedIncident.id}`}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-yellow-400 py-2 text-sm font-medium text-gray-900 hover:bg-yellow-500"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Link>
        )}
        <button
          onClick={onClose}
          className="flex-1 rounded-lg border-2 border-gray-300 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Close
        </button>
      </div>
    </DialogContent></Dialog>
  );
}
