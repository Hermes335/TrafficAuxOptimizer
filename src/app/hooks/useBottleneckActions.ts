import { usePageState } from "../contexts/PageStateContext";
import { useLayoutEffect, useState } from "react";
import { staffingProfile } from "../components/StaffingProfileFields";
import {
  deleteDashboardBottleneck,
  updateDashboardBottleneck,
  type DashboardSnapshot,
  type StaffingProfile,
} from "../services/backend";

function editSignature(values: {
  name: string; district: string; type: string; weight: string;
  latitude: string; longitude: string; staffing: StaffingProfile;
}) {
  const numericValue = (value: string) => value.trim() && Number.isFinite(Number(value)) ? Number(value) : value.trim();
  return JSON.stringify({
    name: values.name.trim(), district: values.district.trim() || "Iloilo City", type: values.type,
    weight: numericValue(values.weight), latitude: numericValue(values.latitude), longitude: numericValue(values.longitude),
    staffing: {...values.staffing, area_name: values.staffing.area_name.trim(),
      staffing_periods: values.staffing.staffing_periods.map(period => ({...period,
        label: (period.label ?? "").trim(), days: [...(period.days ?? [0, 1, 2, 3, 4, 5, 6])].sort(),
      })),
    },
  });
}

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
  const [addMode, setAddMode] = usePageState<"bottleneck" | "poi" | null>("bottleneckForm.addMode", null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [pendingPoint, setPendingPoint] = usePageState<{ latitude: number; longitude: number } | null>("bottleneckForm.pendingPoint", null);
  const [editingBottleneckId, setEditingBottleneckId] = usePageState<string | null>("bottleneckForm.editingBottleneckId", null);
  const [editBottleneckName, setEditBottleneckName] = usePageState("bottleneckForm.editBottleneckName", "");
  const [editBottleneckDistrict, setEditBottleneckDistrict] = usePageState("bottleneckForm.editBottleneckDistrict", "Iloilo City");
  const [editBottleneckType, setEditBottleneckType] = usePageState("bottleneckForm.editBottleneckType", "intersection");
  const [editBottleneckWeight, setEditBottleneckWeight] = usePageState("bottleneckForm.editBottleneckWeight", "1.0");
  const [editLatitude, setEditLatitude] = usePageState("bottleneckForm.editLatitude", "");
  const [editLongitude, setEditLongitude] = usePageState("bottleneckForm.editLongitude", "");
  const [editStaffing, setEditStaffing] = usePageState("bottleneckForm.editStaffing", staffingProfile({}));
  const [editBaseline, setEditBaseline] = usePageState<string | null>("bottleneckForm.editBaseline", null);
  const [editPickFromMap, setEditPickFromMap] = useState(false);
  const [savingEditBottleneck, setSavingEditBottleneck] = usePageState("bottleneckForm.savingEditBottleneck", false);
  const [selectedBottleneckId, setSelectedBottleneckId] = usePageState<string | null>("bottleneckForm.selectedBottleneckId", null);
  const [operation] = usePageState("bottleneckForm.operation", () => ({
    pending: false, reload: null as (() => Promise<void>) | null,
  }));
  useLayoutEffect(() => {
    operation.reload = reloadDashboard;
    return () => { if (operation.reload === reloadDashboard) operation.reload = null; };
  }, [operation, reloadDashboard]);
  const editBottleneckDirty = editingBottleneckId !== null && editBaseline !== editSignature({
    name: editBottleneckName, district: editBottleneckDistrict, type: editBottleneckType,
    weight: editBottleneckWeight, latitude: editLatitude, longitude: editLongitude, staffing: editStaffing,
  });

  const getSelectedBottleneck = () => {
    return dashboardSnapshot.bottlenecks.find((b) => b.id === selectedBottleneckId) || null;
  };

  const onDeleteBottleneck = async (bottleneckId: string) => {
    if (operation.pending) return;
    operation.pending = true;
    setDeletingBottleneckId(bottleneckId);
    setBottleneckActionError(null);
    setBottleneckActionNotice(null);
    try {
      await deleteDashboardBottleneck(bottleneckId);
      setBottleneckActionNotice(`${bottleneckId} removed.`);
      setSelectedBottleneckId(current => current === bottleneckId ? null : current);
      try { await operation.reload?.(); }
      catch { setBottleneckActionError("Bottleneck removed, but the dashboard could not be refreshed. Use Refresh to reload it."); }
    } catch (actionError: unknown) {
      // The confirmation dialog owns failed deletions and keeps retry reachable.
      throw new Error(actionError instanceof Error ? actionError.message : "Failed to remove bottleneck.");
    } finally {
      operation.pending = false;
      setDeletingBottleneckId(null);
    }
  };

  const startEditingBottleneck = (bottleneckId: string) => {
    if (operation.pending || editingBottleneckId === bottleneckId) return;
    const target = dashboardSnapshot.bottlenecks.find((item) => item.id === bottleneckId);
    if (!target) return;
    setEditBaseline(editSignature({
      name: target.name, district: target.district ?? "", type: target.bottleneck_type ?? "other",
      weight: String(target.road_priority_weight ?? 1), latitude: target.latitude != null ? String(target.latitude) : "",
      longitude: target.longitude != null ? String(target.longitude) : "", staffing: staffingProfile(target),
    }));
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
    if (operation.pending) return;
    if (!editingBottleneckId || !editBottleneckDirty) return;
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
    operation.pending = true;
    setSavingEditBottleneck(true);
    setEditPickFromMap(false);
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
      setEditingBottleneckId(null);
      setEditBaseline(null);
      setEditPickFromMap(false);
      setBottleneckActionNotice("Bottleneck updated successfully.");
      try { await operation.reload?.(); }
      catch { setBottleneckActionError("Bottleneck updated, but the dashboard could not be refreshed. Use Refresh to reload it."); }
    } catch (actionError: unknown) {
      setBottleneckActionError(actionError instanceof Error ? actionError.message : "Failed to update bottleneck.");
    } finally {
      operation.pending = false;
      setSavingEditBottleneck(false);
    }
  };

  return {
    addMode, setAddMode: (...args: Parameters<typeof setAddMode>) => { if (!operation.pending) setAddMode(...args); },
    showAddMenu, setShowAddMenu,
    pendingPoint, setPendingPoint,
    editingBottleneckId, setEditingBottleneckId: (...args: Parameters<typeof setEditingBottleneckId>) => { if (!operation.pending) setEditingBottleneckId(...args); },
    editBottleneckDirty,
    editBottleneckName, setEditBottleneckName,
    editBottleneckDistrict, setEditBottleneckDistrict,
    editBottleneckType, setEditBottleneckType,
    editBottleneckWeight, setEditBottleneckWeight,
    editLatitude, setEditLatitude: (...args: Parameters<typeof setEditLatitude>) => { if (!operation.pending) setEditLatitude(...args); },
    editLongitude, setEditLongitude: (...args: Parameters<typeof setEditLongitude>) => { if (!operation.pending) setEditLongitude(...args); },
    editStaffing, setEditStaffing,
    editPickFromMap, setEditPickFromMap: (...args: Parameters<typeof setEditPickFromMap>) => { if (!operation.pending) setEditPickFromMap(...args); },
    savingEditBottleneck,
    selectedBottleneckId, setSelectedBottleneckId,
    onDeleteBottleneck,
    startEditingBottleneck,
    onSaveEditedBottleneck,
    getSelectedBottleneck,
  };
}
