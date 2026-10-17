import { usePageState } from "../contexts/PageStateContext";
import { useLayoutEffect } from "react";
import {
  createDashboardOfficer,
  deleteDashboardOfficer,
  updateDashboardOfficer,
  type DashboardOfficerRecord,
} from "../services/backend";

interface UseOfficerManagementOptions {
  reloadOfficers: () => Promise<void>;
}

export function useOfficerManagement({ reloadOfficers }: UseOfficerManagementOptions) {
  const [officerName, setOfficerName] = usePageState("rosterForm.officerName", "");
  const [officerBadge, setOfficerBadge] = usePageState("rosterForm.officerBadge", "");
  const [officerShift, setOfficerShift] = usePageState<"morning" | "afternoon">("rosterForm.officerShift", "afternoon");
  const [officerStatus, setOfficerStatus] = usePageState<"available" | "deployed" | "off_duty" | "unavailable">("rosterForm.officerStatus", "available");
  const [officerSkillsInput, setOfficerSkillsInput] = usePageState("rosterForm.officerSkillsInput", "");
  const [addingOfficer, setAddingOfficer] = usePageState("rosterForm.addingOfficer", false);
  const [editingOfficerId, setEditingOfficerId] = usePageState<number | null>("rosterForm.editingOfficerId", null);
  const [savingOfficer, setSavingOfficer] = usePageState("rosterForm.savingOfficer", false);
  const [deletingOfficerId, setDeletingOfficerId] = usePageState<number | null>("rosterForm.deletingOfficerId", null);
  const [officerError, setOfficerError] = usePageState<string | null>("rosterForm.error", null);
  const [officerNotice, setOfficerNotice] = usePageState<string | null>("rosterForm.notice", null);
  // The lock outlives the page and also blocks two submissions in the same render.
  const [operation] = usePageState("rosterForm.operation", () => ({
    pending: false, reload: null as (() => Promise<void>) | null,
  }));
  useLayoutEffect(() => {
    operation.reload = reloadOfficers;
    return () => { if (operation.reload === reloadOfficers) operation.reload = null; };
  }, [operation, reloadOfficers]);

  const resetOfficerForm = () => {
    setOfficerName("");
    setOfficerBadge("");
    setOfficerShift("afternoon");
    setOfficerStatus("available");
    setOfficerSkillsInput("");
  };

  const onAddOfficer = async () => {
    if (operation.pending) return;
    if (!officerName.trim() || !officerBadge.trim()) {
      setOfficerError("Officer name and badge number are required.");
      return;
    }
    const skills = officerSkillsInput.split(",").map((item) => item.trim()).filter(Boolean);
    operation.pending = true;
    setSavingOfficer(true);
    setOfficerError(null);
    setOfficerNotice(null);
    try {
      await createDashboardOfficer({
        name: officerName.trim(),
        badge_number: officerBadge.trim(),
        shift: officerShift,
        status: officerStatus,
        skills,
      });
      resetOfficerForm();
      setAddingOfficer(false);
      setOfficerNotice("Officer added successfully.");
      try { await operation.reload?.(); }
      catch { setOfficerError("Officer added, but the roster could not be refreshed. Use Refresh to reload it."); }
    } catch (actionError: unknown) {
      setOfficerError(actionError instanceof Error ? actionError.message : "Failed to add officer.");
    } finally {
      operation.pending = false;
      setSavingOfficer(false);
    }
  };

  const startEditingOfficer = (officer: DashboardOfficerRecord) => {
    if (operation.pending) return;
    setEditingOfficerId(officer.id);
    setOfficerName(officer.name);
    setOfficerBadge(officer.badge_number);
    setOfficerShift(officer.shift);
    setOfficerStatus(officer.status);
    setOfficerSkillsInput((officer.skills ?? []).join(", "));
    setAddingOfficer(false);
    setOfficerError(null);
    setOfficerNotice(null);
  };

  const onUpdateOfficer = async () => {
    if (operation.pending) return;
    if (!editingOfficerId) return;
    if (!officerName.trim() || !officerBadge.trim()) {
      setOfficerError("Officer name and badge number are required.");
      return;
    }
    const skills = officerSkillsInput.split(",").map((item) => item.trim()).filter(Boolean);
    operation.pending = true;
    setSavingOfficer(true);
    setOfficerError(null);
    setOfficerNotice(null);
    try {
      await updateDashboardOfficer(editingOfficerId, {
        name: officerName.trim(),
        badge_number: officerBadge.trim(),
        shift: officerShift,
        status: officerStatus,
        skills,
      });
      setEditingOfficerId(null);
      resetOfficerForm();
      setOfficerNotice("Officer updated successfully.");
      try { await operation.reload?.(); }
      catch { setOfficerError("Officer updated, but the roster could not be refreshed. Use Refresh to reload it."); }
    } catch (actionError: unknown) {
      setOfficerError(actionError instanceof Error ? actionError.message : "Failed to update officer.");
    } finally {
      operation.pending = false;
      setSavingOfficer(false);
    }
  };

  const onDeleteOfficer = async (officerId: number, badge: string) => {
    if (operation.pending) return;
    operation.pending = true;
    setDeletingOfficerId(officerId);
    setOfficerError(null);
    setOfficerNotice(null);
    try {
      await deleteDashboardOfficer(officerId);
      if (editingOfficerId === officerId) {
        setEditingOfficerId(null);
        resetOfficerForm();
      }
      setOfficerNotice(`Officer ${badge} removed.`);
      try { await operation.reload?.(); }
      catch { setOfficerError("Officer removed, but the roster could not be refreshed. Use Refresh to reload it."); }
    } catch (actionError: unknown) {
      setOfficerError(actionError instanceof Error ? actionError.message : "Failed to remove officer.");
    } finally {
      operation.pending = false;
      setDeletingOfficerId(null);
    }
  };

  return {
    officerName, setOfficerName,
    officerBadge, setOfficerBadge,
    officerShift, setOfficerShift,
    officerStatus, setOfficerStatus,
    officerSkillsInput, setOfficerSkillsInput,
    addingOfficer, setAddingOfficer: (...args: Parameters<typeof setAddingOfficer>) => { if (!operation.pending) setAddingOfficer(...args); },
    editingOfficerId, setEditingOfficerId: (...args: Parameters<typeof setEditingOfficerId>) => { if (!operation.pending) setEditingOfficerId(...args); },
    savingOfficer,
    deletingOfficerId,
    officerError, setOfficerError,
    officerNotice, setOfficerNotice,
    onAddOfficer,
    startEditingOfficer,
    onUpdateOfficer,
    onDeleteOfficer,
    resetOfficerForm: () => { if (!operation.pending) resetOfficerForm(); },
  };
}
