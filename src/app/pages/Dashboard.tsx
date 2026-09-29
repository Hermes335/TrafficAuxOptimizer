import { MarkerCreationForm } from "./Dashboard/components/MarkerCreationForm";
import { poiCategories, PoiSymbol } from "../services/poiMarker";
import { useAuth } from "../contexts/AuthContext";
import { operationalDate, operationalShift } from "../services/operationalTime";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronRight, Cloud, CloudRain, MapPin, Plus, Pencil, Trash2 } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import { getApiBaseUrl, resolveIncident } from "../services/backend";
import { useDashboardData } from "../hooks/useDashboardData";
import { useBottleneckActions } from "../hooks/useBottleneckActions";
import { useMapIntegration } from "../hooks/useMapIntegration";
import { useMapClickHandler } from "../hooks/useMapClickHandler";
import { useMapMarkers } from "../hooks/useMapMarkers";
import { useMapAssignmentLines } from "../hooks/useMapAssignmentLines";
import { getRelativeCongestionSeverity, congestionTone, computeRelativeThresholds } from "../types/severity";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  KPICards,
  BottleneckDetailPanel,
  IncidentTicker,
  QuickOptimizeCard,
  MapControls,
  WeatherOverlay,
  IncidentModal,
  EditBottleneckOverlay,
} from "./Dashboard/components";

export function Dashboard() {
  const {user} = useAuth();
  const canManage = user?.role === "supervisor" || user?.role === "administrator";
  const [selectedShift, setSelectedShift] = useState(operationalShift() === "morning" ? "Morning" : "Afternoon");
  // --- Data hook ---
  const data = useDashboardData(selectedShift.toLowerCase());
  const { dashboardSnapshot, weatherSnapshot, deployedOfficersCount, totalOfficersCount, deployments, reloadDashboard, pois, setPois } = data;

  // --- UI state ---
  const [selectedView, setSelectedView] = useState("Congestion");
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [showWeatherOverlay, setShowWeatherOverlay] = useState(false);
  const [filterTerm, setFilterTerm] = useState("");
  const [hiddenPoiCategories, setHiddenPoiCategories] = useState<string[]>([]);
  const visiblePois = useMemo(() => pois.filter(poi => !hiddenPoiCategories.includes(poi.category)), [pois, hiddenPoiCategories]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(null);

  // --- Bottleneck actions hook ---
  const ba = useBottleneckActions({
    dashboardSnapshot,
    reloadDashboard,
    setBottleneckActionError: data.setBottleneckActionError,
    setBottleneckActionNotice: data.setBottleneckActionNotice,
    setDeletingBottleneckId: data.setDeletingBottleneckId,
  });

  // --- Map integration ---
  const tomTomTrafficTileUrl = `${getApiBaseUrl()}/api/maps/tomtom-traffic/{z}/{x}/{y}.png?style=relative0`;
  const map = useMapIntegration({ selectedView, tomTomTrafficTileUrl });

  // --- Map click handler ---
  useMapClickHandler({
    map: map.mapInstance,
    addMode: ba.addMode,
    setPendingPoint: ba.setPendingPoint,
    editPickFromMap: ba.editPickFromMap,
    setEditLatitude: ba.setEditLatitude,
    setEditLongitude: ba.setEditLongitude,
    setBottleneckActionError: data.setBottleneckActionError,
    setBottleneckActionNotice: data.setBottleneckActionNotice,
  });

  // --- Derived values ---
  const bottlenecks = dashboardSnapshot.bottlenecks;
  const incidents = dashboardSnapshot.incidents;

  const filteredBottlenecks = useMemo(() => {
    const term = filterTerm.trim().toLowerCase();
    if (!term) return bottlenecks;
    return bottlenecks.filter((item) =>
      item.id.toLowerCase().includes(term) || item.name.toLowerCase().includes(term) || item.status.toLowerCase().includes(term),
    );
  }, [bottlenecks, filterTerm]);

  const severityThresholds = useMemo(() => computeRelativeThresholds(bottlenecks), [bottlenecks]);

  const criticalBottleneckCount = useMemo(
    () => bottlenecks.filter((item) => getRelativeCongestionSeverity(item, severityThresholds) === "critical").length,
    [bottlenecks, severityThresholds],
  );

  const hasIncidentForBottleneck = (bottleneckId: string, bottleneckName: string) => {
    const idTerm = bottleneckId.toLowerCase();
    const nameTerm = bottleneckName.toLowerCase();
    return incidents.some((incident) => {
      const label = incident.text.toLowerCase();
      return label.includes(idTerm) || label.includes(nameTerm);
    });
  };

  const selectedIncident = useMemo(() => {
    if (incidents.length === 0) return null;
    return incidents.find((item) => item.id === selectedIncidentId) ?? incidents[0];
  }, [incidents, selectedIncidentId]);

  // Auto-select first incident
  useEffect(() => {
    if (selectedIncidentId === null && incidents.length > 0) {
      setSelectedIncidentId(incidents[0].id);
    }
  }, [incidents, selectedIncidentId]);

  // Scroll selected bottleneck into view in the sidebar list
  useEffect(() => {
    if (!ba.selectedBottleneckId) return;
    const el = document.querySelector(`[data-selected="true"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [ba.selectedBottleneckId]);

  // --- Weather derived ---
  const weatherLabel = (weatherSnapshot.condition ?? "weather unavailable").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  const weatherImpactFactor = weatherSnapshot.weather_impact_factor;
  const weatherStatusTone = weatherImpactFactor == null ? "Unavailable" : weatherImpactFactor >= 1.7 ? "Severe" : weatherImpactFactor >= 1.3 ? "Moderate" : "Clear";
  const weatherStyle = weatherStatusTone === "Severe"
    ? { overlayClass: "bg-slate-700/18", blurClass: "backdrop-blur-[0.8px]", gradient: "radial-gradient(circle at 30% 35%, rgba(71, 85, 105, 0.40) 0%, transparent 52%), radial-gradient(circle at 70% 65%, rgba(30, 41, 59, 0.32) 0%, transparent 54%)", chipClass: "bg-rose-500 text-white", bannerClass: "bg-rose-500 text-white", iconClass: "text-rose-100", icon: CloudRain }
    : weatherStatusTone === "Moderate"
      ? { overlayClass: "bg-blue-500/14", blurClass: "backdrop-blur-[0.5px]", gradient: "radial-gradient(circle at 30% 40%, rgba(59, 130, 246, 0.28) 0%, transparent 50%), radial-gradient(circle at 70% 60%, rgba(29, 78, 216, 0.20) 0%, transparent 52%)", chipClass: "bg-yellow-400 text-gray-900", bannerClass: "bg-yellow-400 text-gray-900", iconClass: "text-yellow-100", icon: CloudRain }
      : { overlayClass: "bg-emerald-400/3", blurClass: "backdrop-blur-0", gradient: "radial-gradient(circle at 30% 35%, rgba(16, 185, 129, 0.08) 0%, transparent 50%), radial-gradient(circle at 75% 60%, rgba(52, 211, 153, 0.06) 0%, transparent 52%)", chipClass: "bg-emerald-500 text-white", bannerClass: "bg-emerald-500 text-white", iconClass: "text-emerald-100", icon: Cloud };
  const WeatherIndicatorIcon = weatherStyle.icon;

  const incidentHeadline = selectedIncident?.text ?? "No active incident";
  const incidentLocation = "Incident severity";

  // --- Map marker click handler ---
  const onMarkerClick = (bottleneck: { id: string }) => {
    ba.setSelectedBottleneckId(bottleneck.id);
  };

  // --- Incident remove handler ---
  const onRemoveIncident = async (id: number) => {
    try {
      await resolveIncident(id);
      await reloadDashboard();
    } catch (error) {
      data.setBottleneckActionError(error instanceof Error ? error.message : "Unable to resolve incident.");
      throw error;
    }
  };

  // --- Map markers hook ---
  const handlePoiUpdated = (updatedPoi: import("../services/backend").POI) => {
    if (!updatedPoi.is_active) {
      setPois((prev) => prev.filter((p) => p.poi_id !== updatedPoi.poi_id));
    } else {
      setPois((prev) => prev.map((p) => (p.poi_id === updatedPoi.poi_id ? updatedPoi : p)));
    }
  };

  useMapMarkers({
    mapRef: map.mapRef,
    markersRef: map.markersRef,
    hasFittedRef: map.hasFittedRef,
    filteredBottlenecks,
    incidents,
    pois: visiblePois,
    selectedBottleneckId: ba.selectedBottleneckId,
    onMarkerClick,
    onIncidentRemove: onRemoveIncident,
    onPoiUpdated: handlePoiUpdated,
  });

  // --- Assignment lines hook (shows officer->bottleneck lines when Assignments view active) ---
  useMapAssignmentLines({
    mapRef: map.mapRef,
    selectedView,
    bottlenecks: filteredBottlenecks,
    deployments: deployments.filter(row => row.shift === selectedShift.toLowerCase() && row.status === "assigned"),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b bg-white p-3 text-sm">
        <strong>{operationalDate()} · Asia/Manila</strong>
        <label>Operational shift <select value={selectedShift} onChange={e=>setSelectedShift(e.target.value)} className="rounded border p-1"><option>Morning</option><option>Afternoon</option></select></label>
        <span>Unfilled posts: {dashboardSnapshot.metrics.shortages ?? "—"}</span>
        <span>Active incidents: {dashboardSnapshot.incidents.length}</span>
        <span role="status">{data.connectionState} · Last refresh: {data.lastRefresh ? new Date(data.lastRefresh).toLocaleTimeString("en-PH", {timeZone:"Asia/Manila"}) : "Not loaded"}</span>
        {data.loadError && <span role="alert" className="text-red-700">{data.loadError}</span>}
        <button onClick={()=>{void reloadDashboard().catch(()=>{});}} className="rounded border px-2 py-1">Refresh</button>
      </div>
      {/* KPI Cards */}
      <KPICards
        metrics={dashboardSnapshot.metrics}
        weather={weatherSnapshot}
        deployedOfficersCount={deployedOfficersCount}
        totalOfficersCount={totalOfficersCount}
      />

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Bottlenecks List */}
        <div className="flex w-full flex-col border-r border-gray-200 bg-[#f8fafc] md:w-80">
          <div className="border-b border-gray-200 bg-white px-4 py-4">
            <div className="mb-3 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <h2 className="text-xl font-semibold tracking-tight text-gray-900">Bottlenecks</h2>
              <span className="ml-auto inline-flex items-center whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">{bottlenecks.length} TOTAL</span>
              <span className="inline-flex items-center whitespace-nowrap rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-600">{criticalBottleneckCount} CRITICAL</span>
            </div>
            <input type="text" aria-label="Filter bottlenecks by name or ID" placeholder="Filter by name or ID..." value={filterTerm} onChange={(e) => setFilterTerm(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400" />
            <div className="mt-4 border-t border-gray-100 pt-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Congestion severity (fixed thresholds)</div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-600">
                <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Free (&lt;{Math.round(severityThresholds.p25 * 100)}%)</div>
                <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />Moderate ({Math.round(severityThresholds.p25 * 100)}-{Math.round(severityThresholds.p50 * 100)}%)</div>
                <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" />Heavy ({Math.round(severityThresholds.p50 * 100)}-{Math.round(severityThresholds.p75 * 100)}%)</div>
                <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />Critical (&ge;{Math.round(severityThresholds.p75 * 100)}%)</div>
              </div>
            </div>
            {data.bottleneckActionError && <p className="mt-2 text-xs text-red-600">{data.bottleneckActionError}</p>}
            {data.bottleneckActionNotice && <p className="mt-2 text-xs text-green-700">{data.bottleneckActionNotice}</p>}
          </div>
          <div className="flex-1 overflow-y-auto bg-[#f8fafc]">
            {filteredBottlenecks.map((item) => {
              const tsiPercent = Math.round((Number(item.tsi) || 0) * 100);
              const severity = getRelativeCongestionSeverity(item, severityThresholds);
              const hasIncident = hasIncidentForBottleneck(item.id, item.name);
              const selected = ba.selectedBottleneckId === item.id;
              return (
                <div key={item.id} data-selected={selected ? "true" : undefined} className={`group flex items-center gap-3 border-b border-gray-100 px-3 py-2.5 transition-all cursor-pointer ${selected ? "bg-amber-50 border-l-4 border-l-amber-500" : "hover:bg-gray-50 border-l-4 border-l-transparent"}`} role="button" tabIndex={0} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); ba.setSelectedBottleneckId(item.id); } }} onClick={() => { ba.setSelectedBottleneckId(item.id); map.mapRef.current?.flyTo({ center: [item.longitude, item.latitude], zoom: 15, duration: 800 }); }}>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${congestionTone[severity].dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center gap-1.5">
                      <span className="font-mono text-[11px] font-medium text-gray-500">{item.id}</span>
                      {(hasIncident || item.badge) && <span className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">INCIDENT</span>}
                    </div>
                    <div className="truncate text-sm font-semibold text-gray-900">{item.name}</div>
                  </div>
                  <div className="ml-2 flex shrink-0 flex-col items-end gap-1">
                    <span className={`text-sm font-bold ${congestionTone[severity].text}`}>{tsiPercent}%</span>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <ConfirmDialog title="Remove Bottleneck" description={`Are you sure you want to remove ${item.id} (${item.name})?`} confirmText="Remove" isDangerous onConfirm={() => ba.onDeleteBottleneck(item.id)} trigger={<button aria-label="Remove bottleneck" disabled={!canManage || data.deletingBottleneckId === item.id} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50" onClick={(e) => e.stopPropagation()}><Trash2 className="h-3.5 w-3.5" /></button>} />
                      <button disabled={!canManage} aria-label="Edit bottleneck" onClick={(e) => { e.stopPropagation(); ba.startEditingBottleneck(item.id); }} className="rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-600"><Pencil className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Map Area */}
        <div className="relative flex-1 bg-gray-100">
          <div className="absolute left-4 top-4 z-20 flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-full bg-white p-1 shadow-md">
              <button onClick={() => { setSelectedView("Congestion"); setShowWeatherOverlay(false); }} className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${selectedView === "Congestion" ? "bg-yellow-400 text-gray-900" : "text-gray-600 hover:bg-gray-100"}`}>Congestion</button>
              <button onClick={() => { setSelectedView("Weather"); setShowWeatherOverlay(true); }} className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${selectedView === "Weather" ? "bg-yellow-400 text-gray-900" : "text-gray-600 hover:bg-gray-100"}`}>Weather</button>
              <button onClick={() => { setSelectedView("Assignments"); setShowWeatherOverlay(false); }} className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${selectedView === "Assignments" ? "bg-yellow-400 text-gray-900" : "text-gray-600 hover:bg-gray-100"}`}>Assignments</button>
            </div>
            <div className="flex items-center rounded-full bg-white px-4 py-1.5 text-sm font-medium shadow-md"><MapPin className="mr-1 h-4 w-4 text-pink-500" />{dashboardSnapshot.cityLabel}</div>
            <div className="relative">
              <button onClick={() => ba.setShowAddMenu(!ba.showAddMenu)} className="flex items-center gap-1 rounded-full bg-orange-500 px-4 py-1.5 text-sm font-medium text-white shadow-md hover:bg-orange-600"><Plus className="h-4 w-4" />Add Marker<ChevronRight className="h-4 w-4 rotate-90" /></button>
              {ba.showAddMenu && (
                <div className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-white p-2 shadow-xl">
                  <button disabled={!canManage} onClick={() => { ba.setPendingPoint(null); ba.setAddMode("bottleneck"); ba.setEditPickFromMap(false); ba.setShowAddMenu(false); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><div className="h-3 w-3 rounded-full bg-orange-400" />Bottleneck Node</button>
                  <button onClick={() => { ba.setPendingPoint(null); ba.setAddMode("incident"); ba.setEditPickFromMap(false); ba.setShowAddMenu(false); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><div className="h-3 w-3 rounded-full bg-red-500" />Incident Marker</button>
                  <button onClick={() => { ba.setPendingPoint(null); ba.setAddMode("poi"); ba.setEditPickFromMap(false); ba.setShowAddMenu(false); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><div className="h-3 w-3 rounded-full bg-blue-500" />Point of Interest</button>
                </div>
              )}
            </div>
          </div>

          {ba.addMode && <div className="absolute left-1/2 top-20 z-20 -translate-x-1/2 rounded-full bg-orange-500 px-6 py-2 text-sm font-bold text-white shadow-lg animate-pulse">Click map to place {ba.addMode} <button aria-label="Cancel marker placement" onClick={()=>{ba.setAddMode(null);ba.setPendingPoint(null);}}>×</button></div>}

          {ba.addMode && ba.pendingPoint && <MarkerCreationForm
            key={ba.addMode} kind={ba.addMode} point={ba.pendingPoint}
            onSaved={async () => { await reloadDashboard(); ba.setPendingPoint(null); ba.setAddMode(null); data.setBottleneckActionNotice("Marker saved."); }}
            onCancel={() => { ba.setPendingPoint(null); ba.setAddMode(null); }}
          />}


          <div className="relative h-full w-full overflow-hidden bg-gray-100">
            <div ref={map.mapContainerRef} className="h-full w-full" />
            {ba.editingBottleneckId && (
              <EditBottleneckOverlay
                editBottleneckName={ba.editBottleneckName} setEditBottleneckName={ba.setEditBottleneckName}
                editBottleneckDistrict={ba.editBottleneckDistrict} setEditBottleneckDistrict={ba.setEditBottleneckDistrict}
                editBottleneckType={ba.editBottleneckType} setEditBottleneckType={ba.setEditBottleneckType}
                editBottleneckWeight={ba.editBottleneckWeight} setEditBottleneckWeight={ba.setEditBottleneckWeight}
                editLatitude={ba.editLatitude} setEditLatitude={ba.setEditLatitude}
                editLongitude={ba.editLongitude} setEditLongitude={ba.setEditLongitude}
                editPickFromMap={ba.editPickFromMap} setEditPickFromMap={ba.setEditPickFromMap}
                onSave={ba.onSaveEditedBottleneck}
                onClose={() => { ba.setEditingBottleneckId(null); ba.setEditPickFromMap(false); }}
                savingEditBottleneck={ba.savingEditBottleneck}
              />
            )}
            <WeatherOverlay showWeatherOverlay={showWeatherOverlay} weatherStyle={weatherStyle} WeatherIndicatorIcon={WeatherIndicatorIcon} weatherLabel={weatherLabel} weatherStatusTone={weatherStatusTone} weatherImpactFactor={weatherImpactFactor} />
          </div>

          <IncidentModal showIncidentModal={showIncidentModal} onClose={() => setShowIncidentModal(false)} selectedIncident={selectedIncident} incidentHeadline={incidentHeadline} incidentLocation={incidentLocation} />
          <MapControls map={map.mapRef.current} />
          {pois.length > 0 && <div aria-label="Point of interest marker legend" className="absolute bottom-3 left-3 z-10 max-w-[calc(100%-5rem)] rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur-sm">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">Points of interest</div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {poiCategories.map(item => <button key={item.value} aria-pressed={!hiddenPoiCategories.includes(item.value)}
                aria-label={`Show ${item.label} markers`} onClick={() => setHiddenPoiCategories(previous => previous.includes(item.value) ? previous.filter(value => value !== item.value) : [...previous, item.value])}
                className={`flex items-center gap-1 rounded px-1 text-[11px] font-medium ${hiddenPoiCategories.includes(item.value) ? "text-slate-400" : "text-slate-800"}`}>
                <PoiSymbol category={item.value} className="h-5 w-4 shrink-0" />{item.label}</button>)}
            </div>
          </div>}
        </div>

        {/* Right Sidebar */}
        <div className="w-full space-y-4 overflow-y-auto bg-white p-4 md:sticky md:top-0 md:h-[calc(100vh-4rem)] md:w-96 md:self-start">
          {ba.selectedBottleneckId && ba.getSelectedBottleneck() && (
            <BottleneckDetailPanel
              bottleneck={ba.getSelectedBottleneck()!}
              onClose={() => ba.setSelectedBottleneckId(null)}
              onDelete={ba.onDeleteBottleneck}
              deletingId={data.deletingBottleneckId}
              canManage={canManage}
            />
          )}
          <IncidentTicker incidents={incidents} onRemoveIncident={onRemoveIncident} />
          {canManage && <QuickOptimizeCard
            selectedShift={selectedShift} setSelectedShift={setSelectedShift}
            WeatherIndicatorIcon={WeatherIndicatorIcon} weatherStyle={weatherStyle} weatherLabel={weatherLabel}
            selectedIncident={selectedIncident}
          />}

        </div>
      </div>
    </div>
  );
}
