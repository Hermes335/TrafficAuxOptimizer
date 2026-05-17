import { useState } from "react";
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
  const [officerName, setOfficerName] = useState("");
  const [officerBadge, setOfficerBadge] = useState("");
  const [officerShift, setOfficerShift] = useState<"morning" | "afternoon">("afternoon");
  const [officerStatus, setOfficerStatus] = useState<"available" | "deployed" | "off_duty" | "unavailable">("available");
  const [officerSkillsInput, setOfficerSkillsInput] = useState("");
  const [addingOfficer, setAddingOfficer] = useState(false);
  const [editingOfficerId, setEditingOfficerId] = useState<number | null>(null);
  const [savingOfficer, setSavingOfficer] = useState(false);
  const [deletingOfficerId, setDeletingOfficerId] = useState<number | null>(null);
  const [officerError, setOfficerError] = useState<string | null>(null);
  const [officerNotice, setOfficerNotice] = useState<string | null>(null);

  const resetOfficerForm = () => {
    setOfficerName("");
    setOfficerBadge("");
    setOfficerShift("afternoon");
    setOfficerStatus("available");
    setOfficerSkillsInput("");
  };

  const onAddOfficer = async () => {
    if (!officerName.trim() || !officerBadge.trim()) {
      setOfficerError("Officer name and badge number are required.");
      return;
    }
    const skills = officerSkillsInput.split(",").map((item) => item.trim()).filter(Boolean);
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
      await reloadOfficers();
      resetOfficerForm();
      setAddingOfficer(false);
      setOfficerNotice("Officer added successfully.");
    } catch (actionError: unknown) {
      setOfficerError(actionError instanceof Error ? actionError.message : "Failed to add officer.");
    } finally {
      setSavingOfficer(false);
    }
  };

  const startEditingOfficer = (officer: DashboardOfficerRecord) => {
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
    if (!editingOfficerId) return;
    if (!officerName.trim() || !officerBadge.trim()) {
      setOfficerError("Officer name and badge number are required.");
      return;
    }
    const skills = officerSkillsInput.split(",").map((item) => item.trim()).filter(Boolean);
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
      await reloadOfficers();
      setEditingOfficerId(null);
      resetOfficerForm();
      setOfficerNotice("Officer updated successfully.");
    } catch (actionError: unknown) {
      setOfficerError(actionError instanceof Error ? actionError.message : "Failed to update officer.");
    } finally {
      setSavingOfficer(false);
    }
  };

  const onDeleteOfficer = async (officerId: number, badge: string) => {
    setDeletingOfficerId(officerId);
    setOfficerError(null);
    setOfficerNotice(null);
    try {
      await deleteDashboardOfficer(officerId);
      await reloadOfficers();
      if (editingOfficerId === officerId) {
        setEditingOfficerId(null);
        resetOfficerForm();
      }
      setOfficerNotice(`Officer ${badge} removed.`);
    } catch (actionError: unknown) {
      setOfficerError(actionError instanceof Error ? actionError.message : "Failed to remove officer.");
    } finally {
      setDeletingOfficerId(null);
    }
  };

  return {
    officerName, setOfficerName,
    officerBadge, setOfficerBadge,
    officerShift, setOfficerShift,
    officerStatus, setOfficerStatus,
    officerSkillsInput, setOfficerSkillsInput,
    addingOfficer, setAddingOfficer,
    editingOfficerId, setEditingOfficerId,
    savingOfficer,
    deletingOfficerId,
    officerError, setOfficerError,
    officerNotice, setOfficerNotice,
    onAddOfficer,
    startEditingOfficer,
    onUpdateOfficer,
    onDeleteOfficer,
    resetOfficerForm,
  };
}
