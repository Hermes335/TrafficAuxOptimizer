import { useState } from "react";
import {
  createDashboardBottleneck,
  deleteDashboardBottleneck,
  updateDashboardBottleneck,
  type DashboardSnapshot,
} from "../services/backend";

interface UseBottleneckActionsOptions {
  dashboardSnapshot: DashboardSnapshot;
  setDashboardSnapshot: React.Dispatch<React.SetStateAction<DashboardSnapshot>>;
  reloadDashboard: () => Promise<void>;
  setBottleneckActionError: (v: string | null) => void;
  setBottleneckActionNotice: (v: string | null) => void;
  setSavingBottleneck: (v: boolean) => void;
  setDeletingBottleneckId: (v: string | null) => void;
}

export function useBottleneckActions({
  dashboardSnapshot,
  setDashboardSnapshot,
  reloadDashboard,
  setBottleneckActionError,
  setBottleneckActionNotice,
  setSavingBottleneck,
  setDeletingBottleneckId,
}: UseBottleneckActionsOptions) {
  const [addMode, setAddMode] = useState<"bottleneck" | "incident" | "poi" | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [pendingPoint, setPendingPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [newBottleneckId, setNewBottleneckId] = useState("");
  const [newBottleneckName, setNewBottleneckName] = useState("");
  const [newBottleneckDistrict, setNewBottleneckDistrict] = useState("Iloilo City");
  const [newBottleneckType, setNewBottleneckType] = useState("intersection");
  const [newBottleneckWeight, setNewBottleneckWeight] = useState("1.0");
  const [editingBottleneckId, setEditingBottleneckId] = useState<string | null>(null);
  const [editBottleneckName, setEditBottleneckName] = useState("");
  const [editBottleneckDistrict, setEditBottleneckDistrict] = useState("Iloilo City");
  const [editBottleneckType, setEditBottleneckType] = useState("intersection");
  const [editBottleneckWeight, setEditBottleneckWeight] = useState("1.0");
  const [editLatitude, setEditLatitude] = useState("");
  const [editLongitude, setEditLongitude] = useState("");
  const [editPickFromMap, setEditPickFromMap] = useState(false);
  const [savingEditBottleneck, setSavingEditBottleneck] = useState(false);
  const [selectedBottleneckId, setSelectedBottleneckId] = useState<string | null>(null);
  const [isEditingDetailPanel, setIsEditingDetailPanel] = useState(false);
  const [detailPanelName, setDetailPanelName] = useState("");
  const [detailPanelCongestion, setDetailPanelCongestion] = useState("");
  const [detailPanelWeather, setDetailPanelWeather] = useState("");
  const [detailPanelOfficersCurrent, setDetailPanelOfficersCurrent] = useState("");
  const [detailPanelOfficersNeeded, setDetailPanelOfficersNeeded] = useState("");
  const [detailPanelDistrict, setDetailPanelDistrict] = useState("Iloilo City");
  const [detailPanelType, setDetailPanelType] = useState("intersection");
  const [detailPanelWeight, setDetailPanelWeight] = useState("1.0");
  const [detailPanelLatitude, setDetailPanelLatitude] = useState("");
  const [detailPanelLongitude, setDetailPanelLongitude] = useState("");
  const [detailPanelTsi, setDetailPanelTsi] = useState("");

  const getSelectedBottleneck = () => {
    return dashboardSnapshot.bottlenecks.find((b) => b.id === selectedBottleneckId) || null;
  };

  const getIncidentsForBottleneck = (_bottleneckId: string) => {
    const selectedBottleneck = getSelectedBottleneck();
    if (!selectedBottleneck) return [];
    return dashboardSnapshot.incidents
      .filter((inc) => inc.type === "critical" || inc.type === "major")
      .slice(0, 3);
  };

  const onCreateBottleneck = async () => {
    if (!pendingPoint) {
      setBottleneckActionError("Click a point on the map first.");
      return;
    }
    if (!newBottleneckName.trim()) {
      setBottleneckActionError("Bottleneck name is required.");
      return;
    }
    setSavingBottleneck(true);
    setBottleneckActionError(null);
    setBottleneckActionNotice(null);
    try {
      await createDashboardBottleneck({
        id: newBottleneckId.trim() || undefined,
        name: newBottleneckName.trim(),
        latitude: pendingPoint.latitude,
        longitude: pendingPoint.longitude,
        district: newBottleneckDistrict.trim() || "Iloilo City",
        bottleneck_type: newBottleneckType as "intersection" | "bridge" | "school_zone" | "market" | "terminal" | "other",
        road_priority_weight: Number(newBottleneckWeight),
      });
      await reloadDashboard();
      setPendingPoint(null);
      setNewBottleneckId("");
      setNewBottleneckName("");
      setBottleneckActionNotice("Bottleneck added successfully.");
      setAddMode(null);
    } catch (actionError: unknown) {
      setBottleneckActionError(actionError instanceof Error ? actionError.message : "Failed to create bottleneck.");
    } finally {
      setSavingBottleneck(false);
    }
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

  const onSaveDetailPanel = async () => {
    if (!selectedBottleneckId) return;
    if (!detailPanelName.trim()) {
      setBottleneckActionError("Name is required.");
      return;
    }
    const currentBottleneck = dashboardSnapshot.bottlenecks.find((b) => b.id === selectedBottleneckId);
    const latitude = detailPanelLatitude?.trim() ? Number(detailPanelLatitude) : (currentBottleneck?.latitude ?? NaN);
    const longitude = detailPanelLongitude?.trim() ? Number(detailPanelLongitude) : (currentBottleneck?.longitude ?? NaN);
    const tsi = detailPanelCongestion?.trim() ? Number(detailPanelCongestion) / 100 : (currentBottleneck?.tsi ?? NaN);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setBottleneckActionError("Valid latitude and longitude are required.");
      return;
    }
    setSavingBottleneck(true);
    setBottleneckActionError(null);
    setBottleneckActionNotice(null);
    try {
      await updateDashboardBottleneck(selectedBottleneckId, {
        name: detailPanelName.trim(),
        latitude,
        longitude,
        tsi: Number.isFinite(tsi) ? tsi : undefined,
      });
      const tsiPercent = (Number.isFinite(tsi) ? tsi : 0) * 100;
      let newStatus: "normal" | "warning" | "critical" = "normal";
      if (tsiPercent >= 80) newStatus = "critical";
      else if (tsiPercent >= 40) newStatus = "warning";

      setDashboardSnapshot((prev) => ({
        ...prev,
        bottlenecks: prev.bottlenecks.map((b) =>
          b.id === selectedBottleneckId
            ? { ...b, name: detailPanelName.trim(), latitude, longitude, tsi: Number.isFinite(tsi) ? tsi : b.tsi, status: newStatus }
            : b,
        ),
      }));
      setBottleneckActionNotice("Bottleneck updated successfully.");
      setIsEditingDetailPanel(false);
    } catch (err: unknown) {
      setBottleneckActionError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingBottleneck(false);
    }
  };

  const onDeleteDetailBottleneck = async () => {
    if (!selectedBottleneckId) return;
    await onDeleteBottleneck(selectedBottleneckId);
  };

  const startEditingBottleneck = (bottleneckId: string) => {
    const target = dashboardSnapshot.bottlenecks.find((item) => item.id === bottleneckId);
    if (!target) return;
    setEditingBottleneckId(target.id);
    setEditBottleneckName(target.name);
    setEditBottleneckDistrict("Iloilo City");
    setEditBottleneckType("intersection");
    setEditBottleneckWeight("1.0");
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
    if (!Number.isFinite(weight) || weight <= 0) {
      setBottleneckActionError("Priority weight must be greater than 0.");
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
    newBottleneckId, setNewBottleneckId,
    newBottleneckName, setNewBottleneckName,
    newBottleneckDistrict, setNewBottleneckDistrict,
    newBottleneckType, setNewBottleneckType,
    newBottleneckWeight, setNewBottleneckWeight,
    editingBottleneckId, setEditingBottleneckId,
    editBottleneckName, setEditBottleneckName,
    editBottleneckDistrict, setEditBottleneckDistrict,
    editBottleneckType, setEditBottleneckType,
    editBottleneckWeight, setEditBottleneckWeight,
    editLatitude, setEditLatitude,
    editLongitude, setEditLongitude,
    editPickFromMap, setEditPickFromMap,
    savingEditBottleneck,
    selectedBottleneckId, setSelectedBottleneckId,
    isEditingDetailPanel, setIsEditingDetailPanel,
    detailPanelName, setDetailPanelName,
    detailPanelCongestion, setDetailPanelCongestion,
    detailPanelWeather, setDetailPanelWeather,
    detailPanelOfficersCurrent, setDetailPanelOfficersCurrent,
    detailPanelOfficersNeeded, setDetailPanelOfficersNeeded,
    detailPanelDistrict, setDetailPanelDistrict,
    detailPanelType, setDetailPanelType,
    detailPanelWeight, setDetailPanelWeight,
    detailPanelLatitude, setDetailPanelLatitude,
    detailPanelLongitude, setDetailPanelLongitude,
    detailPanelTsi, setDetailPanelTsi,
    onCreateBottleneck,
    onDeleteBottleneck,
    onSaveDetailPanel,
    onDeleteDetailBottleneck,
    startEditingBottleneck,
    onSaveEditedBottleneck,
    getSelectedBottleneck,
    getIncidentsForBottleneck,
  };
}
