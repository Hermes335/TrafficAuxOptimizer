import { useState } from "react";
import { staffingProfile } from "../components/StaffingProfileFields";
import {
  deleteDashboardBottleneck,
  updateDashboardBottleneck,
  type DashboardSnapshot,
} from "../services/backend";

interface UseBottleneckActionsOptions {
  dashboardSnapshot: DashboardSnapshot;
  reloadDashboard: () => Promise<void>;
  setBottleneckActionError: (v: string | null) => void;
  setBottleneckActionNotice: (v: string | null) => void;
  setDeletingBottleneckId: (v: string | null) => void;
}

export function useBottleneckActions({
  dashboardSnapshot,
  reloadDashboard,
  setBottleneckActionError,
  setBottleneckActionNotice,
  setDeletingBottleneckId,
}: UseBottleneckActionsOptions) {
  const [addMode, setAddMode] = useState<"bottleneck" | "incident" | "poi" | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [pendingPoint, setPendingPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [editingBottleneckId, setEditingBottleneckId] = useState<string | null>(null);
  const [editBottleneckName, setEditBottleneckName] = useState("");
  const [editBottleneckDistrict, setEditBottleneckDistrict] = useState("Iloilo City");
  const [editBottleneckType, setEditBottleneckType] = useState("intersection");
  const [editBottleneckWeight, setEditBottleneckWeight] = useState("1.0");
  const [editLatitude, setEditLatitude] = useState("");
  const [editLongitude, setEditLongitude] = useState("");
  const [editStaffing, setEditStaffing] = useState(staffingProfile({}));
  const [editPickFromMap, setEditPickFromMap] = useState(false);
  const [savingEditBottleneck, setSavingEditBottleneck] = useState(false);
  const [selectedBottleneckId, setSelectedBottleneckId] = useState<string | null>(null);

  const getSelectedBottleneck = () => {
    return dashboardSnapshot.bottlenecks.find((b) => b.id === selectedBottleneckId) || null;
  };

  const onDeleteBottleneck = async (bottleneckId: string) => {
    setDeletingBottleneckId(bottleneckId);
    setBottleneckActionError(null);
    setBottleneckActionNotice(null);
    try {
      await deleteDashboardBottleneck(bottleneckId);
      await reloadDashboard();
      setBottleneckActionNotice(`${bottleneckId} removed.`);
      setSelectedBottleneckId(null);
    } catch (actionError: unknown) {
      setBottleneckActionError(actionError instanceof Error ? actionError.message : "Failed to remove bottleneck.");
    } finally {
      setDeletingBottleneckId(null);
    }
  };

  const startEditingBottleneck = (bottleneckId: string) => {
    const target = dashboardSnapshot.bottlenecks.find((item) => item.id === bottleneckId);
    if (!target) return;
    setEditingBottleneckId(target.id);
    setEditBottleneckName(target.name);
    setEditBottleneckDistrict(target.district ?? "");
    setEditBottleneckType(target.bottleneck_type ?? "other");
    setEditBottleneckWeight(String(target.road_priority_weight ?? 1));
    setEditStaffing(staffingProfile(target));
    setEditLatitude(target.latitude != null ? String(target.latitude) : "");
    setEditLongitude(target.longitude != null ? String(target.longitude) : "");
    setEditPickFromMap(false);
    setAddMode(null);
    setBottleneckActionError(null);
    setBottleneckActionNotice(null);
  };

  const onSaveEditedBottleneck = async () => {
    if (!editingBottleneckId) return;
    if (!editBottleneckName.trim()) {
      setBottleneckActionError("Bottleneck name is required.");
      return;
    }
    const latVal = editLatitude.trim() ? Number(editLatitude) : NaN;
    const lonVal = editLongitude.trim() ? Number(editLongitude) : NaN;
    const weight = Number(editBottleneckWeight);
    if (!Number.isFinite(latVal) || !Number.isFinite(lonVal)) {
      setBottleneckActionError("Valid latitude and longitude are required.");
      return;
    }
    if (!Number.isFinite(weight) || weight < 0) {
      setBottleneckActionError("Priority weight must be zero or greater.");
      return;
    }
    setSavingEditBottleneck(true);
    setBottleneckActionError(null);
    setBottleneckActionNotice(null);
    try {
      await updateDashboardBottleneck(editingBottleneckId, {
        name: editBottleneckName.trim(),
        district: editBottleneckDistrict.trim() || "Iloilo City",
        bottleneck_type: editBottleneckType as "intersection" | "bridge" | "school_zone" | "market" | "terminal" | "other",
        road_priority_weight: weight,
        latitude: latVal,
        longitude: lonVal,
        ...editStaffing,
      });
      await reloadDashboard();
      setEditingBottleneckId(null);
      setEditPickFromMap(false);
      setBottleneckActionNotice("Bottleneck updated successfully.");
    } catch (actionError: unknown) {
      setBottleneckActionError(actionError instanceof Error ? actionError.message : "Failed to update bottleneck.");
    } finally {
      setSavingEditBottleneck(false);
    }
  };

  return {
    addMode, setAddMode,
    showAddMenu, setShowAddMenu,
    pendingPoint, setPendingPoint,
    editingBottleneckId, setEditingBottleneckId,
    editBottleneckName, setEditBottleneckName,
    editBottleneckDistrict, setEditBottleneckDistrict,
    editBottleneckType, setEditBottleneckType,
    editBottleneckWeight, setEditBottleneckWeight,
    editLatitude, setEditLatitude,
    editLongitude, setEditLongitude,
    editStaffing, setEditStaffing,
    editPickFromMap, setEditPickFromMap,
    savingEditBottleneck,
    selectedBottleneckId, setSelectedBottleneckId,
    onDeleteBottleneck,
    startEditingBottleneck,
    onSaveEditedBottleneck,
    getSelectedBottleneck,
  };
}
