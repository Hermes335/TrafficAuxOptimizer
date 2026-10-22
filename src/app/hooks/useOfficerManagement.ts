import { usePageState } from "../contexts/PageStateContext";
import { useLayoutEffect } from "react";
import { uniqueOfficerSkills } from "../services/officerSkills";
import {
  createDashboardOfficer,
  deleteDashboardOfficer,
  updateDashboardOfficer,
  type DashboardOfficerRecord,
} from "../services/backend";

interface UseOfficerManagementOptions {
  reloadOfficers: () => Promise<void>;
}

type LocationAction = "unchanged" | "confirm" | "clear";
function officerFormSnapshot(name: string, badge: string, shift: string, status: string, skills: string[],
  locationAction: LocationAction = "unchanged", latitude = "", longitude = ""): string {
  return JSON.stringify([name.trim(), badge.trim(), shift, status, uniqueOfficerSkills(skills).sort(),
    locationAction, ...(locationAction === "confirm" ? [latitude.trim(), longitude.trim()] : [])]);
}

const blankOfficerForm = officerFormSnapshot("", "", "afternoon", "available", []);

export function useOfficerManagement({ reloadOfficers }: UseOfficerManagementOptions) {
  const [officerName, setOfficerName] = usePageState("rosterForm.officerName", "");
  const [officerBadge, setOfficerBadge] = usePageState("rosterForm.officerBadge", "");
  const [officerShift, setOfficerShift] = usePageState<"morning" | "afternoon">("rosterForm.officerShift", "afternoon");
  const [officerStatus, setOfficerStatus] = usePageState<"available" | "deployed" | "off_duty" | "unavailable">("rosterForm.officerStatus", "available");
  const [officerSkills, setOfficerSkills] = usePageState<string[]>("rosterForm.officerSkills", []);
  const [locationAction, setLocationAction] = usePageState<LocationAction>("rosterForm.locationAction", "unchanged");
  const [officerLatitude, setOfficerLatitude] = usePageState("rosterForm.latitude", "");
  const [officerLongitude, setOfficerLongitude] = usePageState("rosterForm.longitude", "");
  const [locationRecordedAt, setLocationRecordedAt] = usePageState<string | null>("rosterForm.locationRecordedAt", null);
  const [addingOfficer, setAddingOfficer] = usePageState("rosterForm.addingOfficer", false);
  const [editingOfficerId, setEditingOfficerId] = usePageState<number | null>("rosterForm.editingOfficerId", null);
  const [savingOfficer, setSavingOfficer] = usePageState("rosterForm.savingOfficer", false);
  const [deletingOfficerId, setDeletingOfficerId] = usePageState<number | null>("rosterForm.deletingOfficerId", null);
  const [officerError, setOfficerError] = usePageState<string | null>("rosterForm.error", null);
  const [officerNotice, setOfficerNotice] = usePageState<string | null>("rosterForm.notice", null);
  const [addedOfficer, setAddedOfficer] = usePageState<{name: string; badge: string} | null>("rosterForm.addedOfficer", null);
  const [editBaseline, setEditBaseline] = usePageState("rosterForm.editBaseline", blankOfficerForm);
  const officerFormDirty = (addingOfficer || editingOfficerId !== null)
    && officerFormSnapshot(officerName, officerBadge, officerShift, officerStatus, officerSkills, locationAction, officerLatitude, officerLongitude) !== editBaseline;
  const officerFieldErrors: { name?: string; badge?: string; latitude?: string; longitude?: string } = {};
  if (!officerName.trim()) officerFieldErrors.name = "Enter the officer's name.";
  else if (officerName.trim().length > 255) officerFieldErrors.name = "Use 255 characters or fewer.";
  if (!officerBadge.trim()) officerFieldErrors.badge = "Enter a badge number.";
  else if (officerBadge.trim().length > 40) officerFieldErrors.badge = "Use 40 characters or fewer.";
  if (locationAction === "confirm") {
    if (!officerLatitude.trim() || !Number.isFinite(Number(officerLatitude)) || Math.abs(Number(officerLatitude)) > 90)
      officerFieldErrors.latitude = "Enter a latitude between -90 and 90.";
    if (!officerLongitude.trim() || !Number.isFinite(Number(officerLongitude)) || Math.abs(Number(officerLongitude)) > 180)
      officerFieldErrors.longitude = "Enter a longitude between -180 and 180.";
  }
  const locationPayload = locationAction === "confirm"
    ? {current_latitude: Number(officerLatitude), current_longitude: Number(officerLongitude)}
    : locationAction === "clear" ? {current_latitude: null, current_longitude: null} : {};
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
    setOfficerSkills([]);
    setLocationAction("unchanged");
    setOfficerLatitude("");
    setOfficerLongitude("");
    setLocationRecordedAt(null);
    setEditBaseline(blankOfficerForm);
  };

  const startAddingOfficer = () => {
    if (operation.pending || addingOfficer) return;
    resetOfficerForm();
    setEditingOfficerId(null);
    setAddingOfficer(true);
    setOfficerError(null);
    setOfficerNotice(null);
  };

  const closeOfficerEditor = () => {
    if (operation.pending) return;
    setAddingOfficer(false);
    setEditingOfficerId(null);
    resetOfficerForm();
    setOfficerError(null);
  };

  const onAddOfficer = async () => {
    if (operation.pending) return;
    if (Object.keys(officerFieldErrors).length) {
      setOfficerError("Check the highlighted officer details before saving.");
      return;
    }
    const skills = uniqueOfficerSkills(officerSkills);
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
        ...locationPayload,
      });
      setAddedOfficer({name: officerName.trim(), badge: officerBadge.trim()});
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
    if (operation.pending || editingOfficerId === officer.id) return;
    const skills = uniqueOfficerSkills(officer.skills ?? []);
    setEditingOfficerId(officer.id);
    setOfficerName(officer.name);
    setOfficerBadge(officer.badge_number);
    setOfficerShift(officer.shift);
    setOfficerStatus(officer.status);
    setOfficerSkills(skills);
    setLocationAction("unchanged");
    setOfficerLatitude(officer.current_latitude == null ? "" : String(officer.current_latitude));
    setOfficerLongitude(officer.current_longitude == null ? "" : String(officer.current_longitude));
    setLocationRecordedAt(officer.current_location_recorded_at ?? null);
    setEditBaseline(officerFormSnapshot(officer.name, officer.badge_number, officer.shift, officer.status, skills));
    setAddingOfficer(false);
    setOfficerError(null);
    setOfficerNotice(null);
  };

  const onUpdateOfficer = async () => {
    if (operation.pending) return;
    if (editingOfficerId === null || !officerFormDirty) return;
    if (Object.keys(officerFieldErrors).length) {
      setOfficerError("Check the highlighted officer details before saving.");
      return;
    }
    const skills = uniqueOfficerSkills(officerSkills);
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
        ...locationPayload,
      });
      // A later edit may change the saved badge used by the creation shortcut.
      setAddedOfficer(null);
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

  const onDeleteOfficer = async (officerId: number, badge: string): Promise<boolean> => {
    if (operation.pending) return false;
    operation.pending = true;
    setDeletingOfficerId(officerId);
    setOfficerError(null);
    setOfficerNotice(null);
    try {
      await deleteDashboardOfficer(officerId);
      if (addedOfficer?.badge === badge) setAddedOfficer(null);
      if (editingOfficerId === officerId) {
        setEditingOfficerId(null);
        resetOfficerForm();
      }
      setOfficerNotice(`Officer ${badge} removed.`);
      try { await operation.reload?.(); }
      catch { setOfficerError("Officer removed, but the roster could not be refreshed. Use Refresh to reload it."); }
      return true;
    } catch (actionError: unknown) {
      setOfficerError(actionError instanceof Error ? actionError.message : "Failed to remove officer.");
      return false;
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
    officerSkills, setOfficerSkills,
    locationAction, setLocationAction, officerLatitude, setOfficerLatitude, officerLongitude, setOfficerLongitude, locationRecordedAt,
    addingOfficer, setAddingOfficer: (...args: Parameters<typeof setAddingOfficer>) => { if (!operation.pending) setAddingOfficer(...args); },
    editingOfficerId, setEditingOfficerId: (...args: Parameters<typeof setEditingOfficerId>) => { if (!operation.pending) setEditingOfficerId(...args); },
    savingOfficer,
    deletingOfficerId,
    officerError, setOfficerError,
    officerNotice, setOfficerNotice,
    addedOfficer, setAddedOfficer,
    officerFormDirty,
    officerFieldErrors,
    startAddingOfficer,
    closeOfficerEditor,
    onAddOfficer,
    startEditingOfficer,
    onUpdateOfficer,
    onDeleteOfficer,
    resetOfficerForm: () => { if (!operation.pending) resetOfficerForm(); },
  };
}
