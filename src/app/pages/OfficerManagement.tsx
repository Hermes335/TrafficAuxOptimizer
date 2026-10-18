import { usePageState } from "../contexts/PageStateContext";
import { useCallback, useEffect, useRef, useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { CheckCircle2, ChevronLeft, ChevronRight, Pencil, Search, Trash2, UserRound, UserPlus, RefreshCw, X } from "lucide-react";
import { useOfficerManagement } from "../hooks/useOfficerManagement";
import { fetchOfficersPage, type DashboardOfficerRecord } from "../services/backend";
import { OfficerEditor } from "./OfficerManagement/OfficerEditor";

const PAGE_SIZE = 25;
const statusLabels = { available: "Available", deployed: "Deployed", off_duty: "Off duty", unavailable: "Unavailable" };
const statusTones = { available: "bg-emerald-50 text-emerald-800", deployed: "bg-blue-50 text-blue-800", off_duty: "bg-slate-100 text-slate-600", unavailable: "bg-rose-50 text-rose-800" };
const secondaryButton = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 disabled:cursor-not-allowed disabled:opacity-50";
const paginationArrowButton = "inline-flex h-9 w-7 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 disabled:cursor-not-allowed disabled:opacity-50 min-[360px]:w-8 sm:w-auto sm:px-3";
const primaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 disabled:cursor-not-allowed disabled:opacity-50";
const confirmationClass = "fixed left-1/2 top-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl";

export function OfficerManagement() {
  const [officers, setOfficers] = useState<DashboardOfficerRecord[]>([]);
  const [page, setPage] = usePageState("roster.page", 1);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = usePageState("roster.search", "");
  const [statusFilter, setStatusFilter] = usePageState<"all" | "available" | "deployed" | "off_duty" | "unavailable">("roster.statusFilter", "all");
  const [shiftFilter, setShiftFilter] = usePageState<"all" | "morning" | "afternoon">("roster.shiftFilter", "all");
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const requestId = useRef(0);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const editorReturnFocus = useRef<HTMLElement | null>(null);
  const confirmationReturnFocus = useRef<HTMLElement | null>(null);
  const editorWasOpen = useRef(false);
  const restoreEditorFocus = useRef(false);
  const [discardAction, setDiscardAction] = useState<{ run: () => void } | null>(null);
  const [removeTarget, setRemoveTarget] = usePageState<DashboardOfficerRecord | null>("roster.removeTarget", null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadOfficers = useCallback(async (recoverPage = false) => {
    const request = ++requestId.current;
    setLoading(true); setError(null);
    try {
      let resolvedPage = page;
      const fetchAt = (number: number) => fetchOfficersPage(number, debouncedSearch.trim(), statusFilter, shiftFilter);
      const recover = async () => {
        const firstPage = await fetchAt(1);
        resolvedPage = Math.min(page, Math.max(1, Math.ceil(firstPage.count / PAGE_SIZE)));
        return resolvedPage === 1 ? firstPage : fetchAt(resolvedPage);
      };
      let result;
      if (recoverPage && page > 1) result = await recover();
      else {
        try { result = await fetchAt(page); }
        catch (loadError) {
          if (page <= 1 || !(loadError instanceof Error) || !/invalid page/i.test(loadError.message)) throw loadError;
          result = await recover();
        }
      }
      if (request !== requestId.current) return;
      setOfficers(result.results); setCount(result.count);
      if (resolvedPage !== page) setPage(resolvedPage);
    } catch (loadError) {
      if (request !== requestId.current) return;
      setError(loadError instanceof Error ? loadError.message : "Failed to load officers.");
      throw loadError;
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [page, debouncedSearch, statusFilter, shiftFilter, setPage]);

  useEffect(() => {
    if (search === debouncedSearch) void loadOfficers().catch(() => {});
    return () => { requestId.current += 1; };
  }, [loadOfficers, search, debouncedSearch]);

  const management = useOfficerManagement({ reloadOfficers: () => loadOfficers(true) });
  const { officerNotice, setOfficerNotice } = management;
  useEffect(() => {
    if (!officerNotice) return;
    const timer = window.setTimeout(() => setOfficerNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [officerNotice, setOfficerNotice]);

  const editorOpen = management.addingOfficer || management.editingOfficerId !== null;
  const busy = management.savingOfficer || management.deletingOfficerId !== null;
  const refreshing = loading || search !== debouncedSearch;
  const hasFilters = !!search || statusFilter !== "all" || shiftFilter !== "all";
  useEffect(() => {
    if (editorWasOpen.current && !editorOpen) restoreEditorFocus.current = true;
    editorWasOpen.current = editorOpen;
    if (editorOpen) restoreEditorFocus.current = false;
    if (restoreEditorFocus.current && !editorOpen && !busy && !refreshing && !discardAction && !removeTarget) {
      restoreEditorFocus.current = false;
      const opener = editorReturnFocus.current;
      (opener?.isConnected && !opener.matches(":disabled") ? opener : addButtonRef.current)?.focus();
    }
  }, [editorOpen, busy, refreshing, discardAction, removeTarget]);
  const availableCount = officers.filter(officer => officer.status === "available").length;
  const deployedCount = officers.filter(officer => officer.status === "deployed").length;
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const pageItems: (number | "start-gap" | "end-gap")[] = pageCount <= 7
    ? Array.from({ length: pageCount }, (_, index) => index + 1)
    : page <= 4
      ? [1, 2, 3, 4, 5, "end-gap", pageCount]
      : page >= pageCount - 3
        ? [1, "start-gap", pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount]
        : [1, "start-gap", page - 1, page, page + 1, "end-gap", pageCount];
  const clearFilters = () => { setSearch(""); setStatusFilter("all"); setShiftFilter("all"); setPage(1); };
  const rememberFocus = () => document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const withDiscard = (run: () => void) => {
    if (busy) return;
    if (!editorOpen || !management.officerFormDirty) { run(); return; }
    confirmationReturnFocus.current = rememberFocus();
    setDiscardAction({ run });
  };
  const startAdding = () => {
    if (management.addingOfficer) return;
    withDiscard(() => { editorReturnFocus.current = addButtonRef.current; management.startAddingOfficer(); });
  };
  const startEditing = (officer: DashboardOfficerRecord) => {
    if (management.editingOfficerId === officer.id) return;
    const opener = rememberFocus();
    withDiscard(() => { editorReturnFocus.current = opener ?? addButtonRef.current; management.startEditingOfficer(officer); });
  };
  const requestRemoval = (officer: DashboardOfficerRecord) => {
    const opener = rememberFocus();
    withDiscard(() => {
      management.closeOfficerEditor(); management.setOfficerError(null);
      confirmationReturnFocus.current = opener;
      setRemoveTarget(officer);
    });
  };
  const restoreConfirmationFocus = () => {
    const editorField = document.querySelector<HTMLElement>("[data-officer-editor-body] input");
    const previous = confirmationReturnFocus.current;
    (previous?.isConnected && !previous.closest('[aria-hidden="true"]') ? previous : editorField ?? addButtonRef.current)?.focus();
  };

  return (
    <div className="min-w-0 space-y-5 bg-slate-50 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-950">Officer Management</h1>
          <p className="mt-1 text-sm text-slate-600">Manage officer records, shifts and availability.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Refresh officers" disabled={refreshing || busy} onClick={() => { management.setOfficerError(null); void loadOfficers(true).catch(() => {}); }} className={secondaryButton}><RefreshCw className="h-4 w-4" /><span className="hidden sm:inline">Refresh</span></button>
          <button ref={addButtonRef} type="button" disabled={busy} onClick={startAdding} className={primaryButton}><UserPlus className="h-4 w-4" />Add Officer</button>
        </div>
      </header>

      <div aria-label="Roster summary" className="grid grid-cols-3 gap-2 sm:gap-3">
        {[{label: "Matching officers", value: count, tone: "text-slate-950"}, {label: "Available on this page", value: availableCount, tone: "text-emerald-700"}, {label: "Deployed on this page", value: deployedCount, tone: "text-blue-700"}].map(item => <div key={item.label} className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 sm:px-4">
          <p className="text-xs text-slate-600">{item.label}</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${item.tone}`}>{refreshing ? "—" : item.value}</p>
        </div>)}
      </div>

      {!editorOpen && !removeTarget && (management.officerError || error) && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{management.officerError || error}</p>}

      <section aria-label="Officer roster" aria-busy={refreshing} className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="space-y-3 border-b border-slate-200 p-3 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="officer-search" className="mb-1 block text-xs font-medium text-slate-700">Search officers</label>
              <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input id="officer-search" type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Search name or badge" className="h-10 w-full min-w-0 rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:w-80">
              <div>
                <label htmlFor="officer-status-filter" className="mb-1 block text-xs font-medium text-slate-700">Status filter</label>
                <select id="officer-status-filter" value={statusFilter} onChange={event => { setStatusFilter(event.target.value as typeof statusFilter); setPage(1); }} className="h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-sm">
                  <option value="all">All statuses</option><option value="available">Available</option><option value="deployed">Deployed</option><option value="off_duty">Off duty</option><option value="unavailable">Unavailable</option>
                </select>
              </div>
              <div>
                <label htmlFor="officer-shift-filter" className="mb-1 block text-xs font-medium text-slate-700">Shift filter</label>
                <select id="officer-shift-filter" value={shiftFilter} onChange={event => { setShiftFilter(event.target.value as typeof shiftFilter); setPage(1); }} className="h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-sm">
                  <option value="all">All shifts</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option>
                </select>
              </div>
            </div>
          </div>
          {hasFilters && <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 underline underline-offset-2"><X aria-hidden="true" className="h-3 w-3" />Clear filters</button>}
        </div>

        {refreshing && <p aria-live="polite" className="px-4 py-3 text-sm text-slate-500">{officers.length ? "Updating officers…" : "Loading officers…"}</p>}
        {!refreshing && !officers.length && <div className="space-y-2 px-4 py-10 text-center">
          <UserRound aria-hidden="true" className="mx-auto h-7 w-7 text-slate-400" />
          <p className="text-sm font-medium text-slate-800">{error ? "Unable to load officers" : hasFilters ? "No matching officers" : "No officers added yet"}</p>
          <p className="text-xs text-slate-500">{error ? "Use Refresh to try again." : hasFilters ? "Try another name or badge, or clear the filters." : "Add an officer to start building the roster."}</p>
        </div>}

        {officers.length > 0 && <table className={`block w-full table-fixed text-left lg:table ${refreshing ? "opacity-60" : ""}`}>
          <caption className="sr-only">Officer roster with shift, status, skills and actions</caption>
          <thead className="hidden bg-slate-50 text-xs font-medium text-slate-500 lg:table-header-group">
            <tr><th scope="col" className="w-[28%] px-4 py-3">Officer</th><th scope="col" className="w-[15%] px-3 py-3">Shift</th><th scope="col" className="w-[14%] px-3 py-3">Status</th><th scope="col" className="px-3 py-3">Skills</th><th scope="col" className="w-56 px-4 py-3 text-right">Actions</th></tr>
          </thead>
          <tbody className="block divide-y divide-slate-100 lg:table-row-group">
            {officers.map(officer => {
              const skills = Array.isArray(officer.skills) ? officer.skills.filter((skill): skill is string => typeof skill === "string") : [];
              return <tr key={officer.id} data-officer-id={officer.id} className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 p-4 hover:bg-slate-50/70 lg:table-row lg:p-0">
                <th scope="row" className="col-span-2 block min-w-0 font-normal lg:table-cell lg:px-4 lg:py-3">
                  <span className="block break-words text-sm font-semibold text-slate-900">{officer.name}</span>
                  <span className="mt-0.5 block break-all text-xs text-slate-500">{officer.badge_number}</span>
                </th>
                <td className="block min-w-0 lg:table-cell lg:px-3 lg:py-3"><span className="mb-1 block text-xs text-slate-500 lg:hidden">Shift</span><span className="text-sm text-slate-700">{officer.shift === "morning" ? "Morning" : "Afternoon"}</span><span className="block text-xs text-slate-500">{officer.shift === "morning" ? "6 AM–2 PM" : "2 PM–10 PM"}</span></td>
                <td className="block min-w-0 lg:table-cell lg:px-3 lg:py-3"><span className="mb-1 block text-xs text-slate-500 lg:hidden">Status</span><span className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${statusTones[officer.status]}`}><span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />{statusLabels[officer.status]}</span></td>
                <td className="col-span-2 block min-w-0 lg:table-cell lg:px-3 lg:py-3"><span className="mb-1 block text-xs text-slate-500 lg:hidden">Skills</span>
                  {skills.length ? <div className="flex flex-wrap gap-1">{skills.slice(0, 2).map((skill, index) => <span key={index} className="max-w-full break-words rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{skill}</span>)}{skills.length > 2 && <details className="max-w-full text-xs text-slate-600"><summary className="cursor-pointer rounded px-1 py-0.5 font-medium">+{skills.length - 2} more</summary><div className="mt-1 flex flex-wrap gap-1">{skills.slice(2).map((skill, index) => <span key={index} className="max-w-full break-words rounded bg-slate-100 px-2 py-0.5">{skill}</span>)}</div></details>}</div> : <span className="text-xs text-slate-400">Not specified</span>}
                </td>
                <td className="col-span-2 block lg:table-cell lg:px-4 lg:py-3"><div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:justify-end">
                  <button type="button" aria-label={`Edit ${officer.name}`} disabled={busy || refreshing} onClick={() => startEditing(officer)} className={secondaryButton}><Pencil aria-hidden="true" className="h-3.5 w-3.5" />Edit</button>
                  <button type="button" aria-label={`Remove ${officer.name}`} disabled={busy || refreshing} onClick={() => requestRemoval(officer)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-rose-600 disabled:cursor-not-allowed disabled:opacity-50"><Trash2 aria-hidden="true" className="h-3.5 w-3.5" />{management.deletingOfficerId === officer.id ? "Removing..." : "Remove"}</button>
                </div></td>
              </tr>;
            })}
          </tbody>
        </table>}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-2 py-3 min-[360px]:px-4">
          <p className="text-xs tabular-nums text-slate-600">{refreshing ? "Updating results…" : count && officers.length ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min((page - 1) * PAGE_SIZE + officers.length, count)} of ${count} officers` : "0 officers"}</p>
          <nav aria-label="Officer pagination" className="flex max-w-full items-center gap-0 sm:gap-1">
            <button type="button" aria-label="Previous page" disabled={page <= 1 || refreshing || busy} onClick={() => setPage(current => current - 1)} className={paginationArrowButton}><ChevronLeft aria-hidden="true" className="h-4 w-4" /><span className="hidden sm:inline">Previous</span></button>
            {pageItems.map(item => typeof item === "number"
              ? <button key={item} type="button" aria-label={`Go to page ${item}`} aria-current={item === page ? "page" : undefined} disabled={refreshing || busy} onClick={() => setPage(item)} className={`inline-flex h-9 w-7 shrink-0 items-center justify-center rounded-lg text-sm tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 disabled:cursor-not-allowed disabled:opacity-50 min-[360px]:w-8 sm:w-9 ${item === page ? "bg-amber-400 font-semibold text-slate-950 shadow-sm" : "font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}>{item}</button>
              : <span key={item} aria-hidden="true" className="inline-flex h-9 w-7 shrink-0 items-center justify-center text-sm text-slate-400 min-[360px]:w-8 sm:w-9">…</span>)}
            <button type="button" aria-label="Next page" disabled={page >= pageCount || refreshing || busy} onClick={() => setPage(current => current + 1)} className={paginationArrowButton}><span className="hidden sm:inline">Next</span><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
          </nav>
        </footer>
      </section>

      {editorOpen && <OfficerEditor key={management.editingOfficerId ?? "new"} management={management} onClose={() => withDiscard(management.closeOfficerEditor)} returnFocusRef={editorReturnFocus} />}

      <AlertDialog.Root open={discardAction !== null} onOpenChange={open => { if (!open) setDiscardAction(null); }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/40" />
          <AlertDialog.Content className={confirmationClass} onCloseAutoFocus={event => { event.preventDefault(); restoreConfirmationFocus(); }}>
            <AlertDialog.Title className="text-lg font-semibold text-slate-950">Discard unsaved changes?</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-slate-600">Your officer edits have not been saved. Discard them to continue.</AlertDialog.Description>
            <div className="flex flex-wrap justify-end gap-2"><AlertDialog.Cancel className={secondaryButton}>Keep editing</AlertDialog.Cancel><AlertDialog.Action className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700" onClick={() => { if (!busy) { discardAction?.run(); setDiscardAction(null); } }}>Discard changes</AlertDialog.Action></div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <AlertDialog.Root open={removeTarget !== null} onOpenChange={open => { if (!open && !busy) { setRemoveTarget(null); management.setOfficerError(null); } }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/40" />
          <AlertDialog.Content className={confirmationClass} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onCloseAutoFocus={event => { event.preventDefault(); restoreConfirmationFocus(); }}>
            <AlertDialog.Title className="text-lg font-semibold text-slate-950">Remove officer?</AlertDialog.Title>
            <AlertDialog.Description className="break-words text-sm text-slate-600">Remove <strong>{removeTarget?.name}</strong> ({removeTarget?.badge_number}) from the roster? Officers with active deployments cannot be removed.</AlertDialog.Description>
            {management.officerError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{management.officerError}</p>}
            <div className="flex justify-end gap-2"><AlertDialog.Cancel disabled={busy} className={secondaryButton}>Cancel</AlertDialog.Cancel><button type="button" disabled={busy || !removeTarget} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50" onClick={async () => {
              if (busy || !removeTarget) return;
              if (await management.onDeleteOfficer(removeTarget.id, removeTarget.badge_number)) setRemoveTarget(null);
            }}>{management.deletingOfficerId !== null ? "Removing..." : "Remove officer"}</button></div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      {officerNotice && <div role="status" aria-atomic="true" className="fixed bottom-4 left-1/2 z-[80] flex w-fit max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-900 shadow-lg">
        <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-emerald-600" /><span className="min-w-0 break-words">{officerNotice}</span><button type="button" aria-label="Dismiss success notification" onClick={() => setOfficerNotice(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-emerald-50"><X className="h-4 w-4" /></button>
      </div>}
    </div>
  );
}
