import { AlertCircle, Plus, Trash2, Pencil, ChevronRight } from "lucide-react";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { EmptyState } from "../../../components/LoadingState";
import type { Bottleneck } from "../../../services/backend";

interface BottleneckListProps {
  bottlenecks: Bottleneck[];
  filterTerm: string;
  onFilterChange: (term: string) => void;
  isAddMode: boolean;
  onToggleAddMode: () => void;
  onDelete: (id: string) => Promise<void>;
  onEdit: (id: string) => void;
  deletingId: string | null;
  onCancelAdd: () => void;
  error: string | null;
  notice: string | null;
}

export function BottleneckList({
  bottlenecks,
  filterTerm,
  onFilterChange,
  isAddMode,
  onToggleAddMode,
  onDelete,
  onEdit,
  deletingId,
  onCancelAdd,
  error,
  notice,
}: BottleneckListProps) {
  const filteredBottlenecks = bottlenecks.filter(
    (item) =>
      item.id.toLowerCase().includes(filterTerm.toLowerCase()) ||
      item.name.toLowerCase().includes(filterTerm.toLowerCase()) ||
      item.status.toLowerCase().includes(filterTerm.toLowerCase())
  );

  return (
    <div className="w-full border-r bg-white md:w-80">
      <div className="border-b p-4">
        <div className="mb-4 flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-yellow-500" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Bottlenecks</h2>
          <span className="ml-auto rounded-full bg-gray-100 px-3 py-1 text-sm">
            {filteredBottlenecks.length} UNITS
          </span>
        </div>
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={() => {
              onToggleAddMode();
              if (!isAddMode) {
                onCancelAdd();
              }
            }}
            className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium ${
              isAddMode ? "bg-yellow-400 text-white" : "border text-gray-700 hover:bg-gray-50"
            }`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {isAddMode ? "Cancel Add Mode" : "Add from Map"}
          </button>
        </div>
        <input
          type="text"
          placeholder="Filter stations..."
          value={filterTerm}
          onChange={(event) => onFilterChange(event.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          aria-label="Filter bottlenecks"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        {notice && <p className="mt-2 text-xs text-green-700">{notice}</p>}
      </div>

      <div className="overflow-y-auto" style={{ height: "calc(100% - 120px)" }}>
        {filteredBottlenecks.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={AlertCircle}
              title="No Bottlenecks"
              description={filterTerm ? "No bottlenecks match your filter." : "Add bottlenecks from the map."}
            />
          </div>
        ) : (
          filteredBottlenecks.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 border-b px-4 py-3 hover:bg-gray-50"
            >
              {item.status === "critical" && (
                <div className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{item.id}</span>
                  {item.badge && (
                    <span className="rounded bg-red-500 px-2 py-0.5 text-xs text-white">
                      {item.badge}
                    </span>
                  )}
                </div>
                <div className="font-medium">{item.name}</div>
              </div>
              <ConfirmDialog
                title="Remove Bottleneck"
                description={`Are you sure you want to remove ${item.id} (${item.name}) from active bottlenecks? This action cannot be undone.`}
                confirmText="Remove"
                isDangerous
                onConfirm={() => onDelete(item.id)}
                trigger={
                  <button
                    disabled={deletingId === item.id}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={`Remove bottleneck ${item.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                }
              />
              <button
                onClick={() => onEdit(item.id)}
                className="rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-600"
                aria-label={`Edit bottleneck ${item.id}`}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
            </div>
          ))
        )}
      </div>
    </div>
  );
}