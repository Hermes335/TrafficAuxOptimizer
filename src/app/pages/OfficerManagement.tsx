import { useEffect, useMemo, useState } from "react";
import { Pencil, Search, Trash2, UserRound, UserPlus } from "lucide-react";
import { useOfficerManagement } from "../hooks/useOfficerManagement";
import { fetchDashboardOfficers, type DashboardOfficerRecord } from "../services/backend";

function formatStatusLabel(status: string): string {
  return status.replace("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function OfficerManagement() {
  const [officers, setOfficers] = useState<DashboardOfficerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "available" | "deployed" | "off_duty" | "unavailable">("all");
  const [shiftFilter, setShiftFilter] = useState<"all" | "morning" | "afternoon">("all");

  const reloadOfficers = async () => {
    const rows = await fetchDashboardOfficers();
    setOfficers(rows);
  };

  const officerMgmt = useOfficerManagement({ reloadOfficers });

  useEffect(() => {
    let active = true;

    fetchDashboardOfficers()
      .then((rows) => {
        if (!active) return;
        setOfficers(rows);
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        const message = loadError instanceof Error ? loadError.message : "Failed to load officers.";
        setError(message);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const filteredOfficers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return officers.filter((officer) => {
      const matchesSearch =
        term.length === 0 ||
        officer.name.toLowerCase().includes(term) ||
        officer.badge_number.toLowerCase().includes(term) ||
        (officer.skills ?? []).some((skill) => skill.toLowerCase().includes(term));

      const matchesStatus = statusFilter === "all" || officer.status === statusFilter;
      const matchesShift = shiftFilter === "all" || officer.shift === shiftFilter;
      return matchesSearch && matchesStatus && matchesShift;
    });
  }, [officers, search, statusFilter, shiftFilter]);

  const availableCount = officers.filter((officer) => officer.status === "available").length;
  const deployedCount = officers.filter((officer) => officer.status === "deployed").length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-yellow-600">Operations</p>
          <h1 className="text-xl font-bold tracking-tight text-gray-900">Roster</h1>
        </div>
        <button
          onClick={() => {
            officerMgmt.setAddingOfficer((current) => !current);
            officerMgmt.setEditingOfficerId(null);
            officerMgmt.resetOfficerForm();
            officerMgmt.setOfficerError(null);
            officerMgmt.setOfficerNotice(null);
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-yellow-300 bg-yellow-400 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-yellow-500"
        >
          <UserPlus className="h-4 w-4" />
          {officerMgmt.addingOfficer ? "Cancel" : "Add Officer"}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Total Officers</span>
            <UserRound className="h-4 w-4 text-yellow-500" />
          </div>
          <div className="mt-3 text-2xl font-bold text-gray-900">{officers.length}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Available</span>
            <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
          </div>
          <div className="mt-3 text-2xl font-bold text-green-600">{availableCount}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Deployed</span>
            <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
          </div>
          <div className="mt-3 text-2xl font-bold text-blue-600">{deployedCount}</div>
        </div>
      </div>

      {officerMgmt.officerError && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{officerMgmt.officerError}</p>}
      {officerMgmt.officerNotice && <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{officerMgmt.officerNotice}</p>}
      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {(officerMgmt.addingOfficer || officerMgmt.editingOfficerId !== null) && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold text-gray-900">{officerMgmt.editingOfficerId !== null ? "Edit Officer" : "Add New Officer"}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              value={officerMgmt.officerName}
              onChange={(event) => officerMgmt.setOfficerName(event.target.value)}
              placeholder="Officer name"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-yellow-400"
            />
            <input
              value={officerMgmt.officerBadge}
              onChange={(event) => officerMgmt.setOfficerBadge(event.target.value)}
              placeholder="Badge number"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-yellow-400"
            />
            <select
              value={officerMgmt.officerShift}
              onChange={(event) => officerMgmt.setOfficerShift(event.target.value as "morning" | "afternoon")}
              className="rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-yellow-400"
            >
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
            </select>
            <select
              value={officerMgmt.officerStatus}
              onChange={(event) => officerMgmt.setOfficerStatus(event.target.value as "available" | "deployed" | "off_duty" | "unavailable")}
              className="rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-yellow-400"
            >
              <option value="available">Available</option>
              <option value="deployed">Deployed</option>
              <option value="off_duty">Off Duty</option>
              <option value="unavailable">Unavailable</option>
            </select>
            <div className="md:col-span-2">
              <input
                value={officerMgmt.officerSkillsInput}
                onChange={(event) => officerMgmt.setOfficerSkillsInput(event.target.value)}
                placeholder="Skills (comma-separated)"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-yellow-400"
              />
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => {
                officerMgmt.setAddingOfficer(false);
                officerMgmt.setEditingOfficerId(null);
                officerMgmt.resetOfficerForm();
              }}
              className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={officerMgmt.editingOfficerId !== null ? officerMgmt.onUpdateOfficer : officerMgmt.onAddOfficer}
              disabled={officerMgmt.savingOfficer}
              className="rounded bg-yellow-400 px-3 py-2 text-sm font-semibold text-white hover:bg-yellow-500 disabled:cursor-not-allowed disabled:bg-yellow-300"
            >
              {officerMgmt.savingOfficer ? "Saving..." : officerMgmt.editingOfficerId !== null ? "Update Officer" : "Create Officer"}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex-1">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, badge, or skill"
                className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm text-gray-700 outline-none transition focus:border-yellow-400"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 md:justify-end">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-yellow-400"
            >
              <option value="all">All Status</option>
              <option value="available">Available</option>
              <option value="deployed">Deployed</option>
              <option value="off_duty">Off Duty</option>
              <option value="unavailable">Unavailable</option>
            </select>

            <select
              value={shiftFilter}
              onChange={(event) => setShiftFilter(event.target.value as typeof shiftFilter)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-yellow-400"
            >
              <option value="all">All Shifts</option>
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="p-4 text-sm text-gray-500">Loading officers...</div>
        ) : (
          <div>
            {filteredOfficers.length === 0 && <div className="p-6 text-sm text-gray-500">No officers match the current search or filter.</div>}

            {filteredOfficers.map((officer) => {
              const shiftDisplay = officer.shift === "morning" ? "Morning" : "Afternoon";
              const statusDisplay = formatStatusLabel(officer.status);
              const statusClasses =
                officer.status === "available"
                  ? "bg-gray-200 text-gray-700"
                  : officer.status === "deployed"
                    ? "bg-blue-100 text-blue-700"
                    : officer.status === "off_duty"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-red-100 text-red-700";

              return (
                <div key={officer.id} className="grid gap-4 border-b border-gray-200 px-5 py-5 last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_minmax(260px,420px)_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="text-lg font-bold uppercase tracking-tight text-gray-900">{officer.name}</div>
                    <div className="mt-1 text-sm text-gray-600">{officer.badge_number}</div>
                  </div>

                  <div className="flex items-center gap-3 md:justify-center">
                    <span className="inline-flex w-[170px] items-center justify-center rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700">
                      {shiftDisplay}
                    </span>
                    <span className={`inline-flex w-[170px] items-center justify-center rounded-md px-3 py-2 text-sm font-medium ${statusClasses}`}>
                      {statusDisplay}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 md:justify-end">
                    <button
                      onClick={() => officerMgmt.startEditingOfficer(officer)}
                      className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </button>
                    <button
                      onClick={() => officerMgmt.onDeleteOfficer(officer.id, officer.badge_number)}
                      disabled={officerMgmt.deletingOfficerId === officer.id}
                      className="inline-flex items-center gap-2 rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      {officerMgmt.deletingOfficerId === officer.id ? "Removing..." : "Remove"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
