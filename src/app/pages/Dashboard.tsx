import { RememberedDetails } from "../components/RememberedDetails";
import { usePageState, useResetPageState } from "../contexts/PageStateContext";
import { MarkerCreationForm } from "./Dashboard/components/MarkerCreationForm";
import { AreaFilter, inArea } from "../components/AreaFilter";
import { poiCategories, PoiSymbol } from "../services/poiMarker";
import { useAuth } from "../contexts/AuthContext";
import { operationalDate, operationalShift } from "../services/operationalTime";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronRight, Cloud, CloudRain, MapPin, Plus, Pencil, Trash2, RefreshCw, Map, List, PanelRight, Zap } from "lucide-react";
import { Link, useNavigate } from "react-router";
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
  const navigate = useNavigate();
  const {user} = useAuth();
  const canManage = user?.role === "supervisor" || user?.role === "administrator";
  const [selectedShift, setSelectedShift] = usePageState("dashboard.selectedShift", operationalShift() === "morning" ? "Morning" : "Afternoon");
  const [area,setArea]=usePageState("dashboard.area", "");
  // --- Data hook ---
  const data = useDashboardData(selectedShift.toLowerCase());
  const { dashboardSnapshot, weatherSnapshot, deployedOfficersCount, totalOfficersCount, activeDeployments, reloadDashboard, pois, setPois } = data;

  // --- UI state ---
  const [selectedView, setSelectedView] = usePageState("dashboard.selectedView", "Congestion");
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [showWeatherOverlay, setShowWeatherOverlay] = usePageState("dashboard.showWeatherOverlay", false);
  const [filterTerm, setFilterTerm] = usePageState("dashboard.filterTerm", "");
  const [hiddenPoiCategories, setHiddenPoiCategories] = usePageState<string[]>("dashboard.hiddenPoiCategories", []);
  const [showBottlenecks, setShowBottlenecks] = usePageState("dashboard.showBottlenecks", true);
  const [showDetails, setShowDetails] = usePageState("dashboard.showDetails", false);
  const [mobilePanel, setMobilePanel] = usePageState<"map" | "bottlenecks" | "details">("dashboard.mobilePanel", "map");
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null);
  const [detailsFocusRequest, setDetailsFocusRequest] = useState(0);
  const visiblePois = useMemo(() => pois.filter(poi => !hiddenPoiCategories.includes(poi.category)), [pois, hiddenPoiCategories]);
  const [selectedIncidentId, setSelectedIncidentId] = usePageState<number | null>("dashboard.selectedIncidentId", null);

  // --- Bottleneck actions hook ---
  const ba = useBottleneckActions({
    dashboardSnapshot,
    reloadDashboard,
    setBottleneckActionError: data.setBottleneckActionError,
    setBottleneckActionNotice: data.setBottleneckActionNotice,
    setDeletingBottleneckId: data.setDeletingBottleneckId,
  });
  const [markerSaving] = usePageState("marker.saving", false);
  const [poiPersisted] = usePageState("marker.poi.persisted", false);
  const [bottleneckPersisted] = usePageState("marker.bottleneck.persisted", false);
  const markerPersisted = ba.addMode === "poi" ? poiPersisted : ba.addMode === "bottleneck" && bottleneckPersisted;
  const resetMarkerDraft = useResetPageState(`marker.${ba.addMode}.`);
  const markerActionsBusy = markerSaving || ba.savingEditBottleneck || data.deletingBottleneckId !== null;
  const cancelMarkerPlacement = () => {
    if (markerActionsBusy) return;
    resetMarkerDraft();
    ba.setAddMode(null);
    ba.setPendingPoint(null);
  };
  const editBottleneck = (id: string) => {
    if (markerActionsBusy) return;
    // Leaving a completed placement must discard its refresh-only form state.
    if (markerPersisted) cancelMarkerPlacement();
    ba.startEditingBottleneck(id);
    setMobilePanel("map");
  };

  // --- Map integration ---
  const tomTomTrafficTileUrl = `${getApiBaseUrl()}/api/maps/tomtom-traffic/{z}/{x}/{y}.png?style=relative0`;
  const map = useMapIntegration({ selectedView, tomTomTrafficTileUrl });

  useEffect(() => {
    if (!map.mapInstance || !map.mapContainerRef.current || typeof ResizeObserver === "undefined") return;
    const instance = map.mapInstance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(map.mapContainerRef.current);
    return () => observer.disconnect();
  }, [map.mapInstance, map.mapContainerRef]);

  // --- Map click handler ---
  useMapClickHandler({
    map: map.mapInstance,
    addMode: markerActionsBusy || markerPersisted ? null : ba.addMode,
    setPendingPoint: ba.setPendingPoint,
    editPickFromMap: !markerActionsBusy && ba.editPickFromMap,
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
    return bottlenecks.filter((item) =>
      inArea(item,area)&&(!term||item.id.toLowerCase().includes(term) || item.name.toLowerCase().includes(term) || (item.area_name??"").toLowerCase().includes(term) || item.status.toLowerCase().includes(term)),
    );
  }, [bottlenecks, filterTerm, area]);

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
    if (window.innerWidth >= 1280) el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [ba.selectedBottleneckId]);

  useEffect(() => {
    if (detailsFocusRequest) detailsHeadingRef.current?.focus();
  }, [detailsFocusRequest]);

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
  const onMarkerClick = (bottleneck: { id: string }, moveFocus = false) => {
    ba.setSelectedBottleneckId(bottleneck.id);
    setShowDetails(true);
    setMobilePanel("details");
    if (moveFocus) setDetailsFocusRequest(request => request + 1);
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
    onMarkerClick: bottleneck => onMarkerClick(bottleneck, document.activeElement?.matches(".maplibregl-marker:focus-visible") ?? false),
    onIncidentRemove: onRemoveIncident,
    onIncidentEdit: id => navigate(`/incident-report/${id}`),
    onPoiUpdated: handlePoiUpdated,
  });

  // --- Assignment lines hook (shows officer->bottleneck lines when Assignments view active) ---
  useMapAssignmentLines({
    mapRef: map.mapRef,
    selectedView,
    bottlenecks: filteredBottlenecks,
    deployments: activeDeployments,
  });

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto bg-slate-50 xl:overflow-hidden">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-950">Live operations</h1>
            <p className="text-xs text-slate-600">{operationalDate()} · Asia/Manila</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { void reloadDashboard().catch(() => {}); }} aria-label="Refresh dashboard" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"><RefreshCw className="h-3.5 w-3.5" /><span className="hidden sm:inline">Refresh</span></button>
            {canManage && <Link to={`/optimization?shift=${selectedShift.toLowerCase()}`} className="inline-flex h-9 items-center gap-2 rounded-lg bg-amber-400 px-3 text-sm font-semibold text-slate-950 hover:bg-amber-300"><Zap className="h-4 w-4" />Optimize</Link>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">Shift<select aria-label="Operational shift" value={selectedShift} onChange={e => setSelectedShift(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900"><option>Morning</option><option>Afternoon</option></select></label>
          <AreaFilter nodes={bottlenecks} value={area} onChange={setArea}/>
          <div className="hidden items-center gap-3 text-xs text-slate-600 lg:flex">
            <span><strong className="font-semibold text-slate-900">{data.lastRefresh ? dashboardSnapshot.metrics.shortages ?? "—" : "—"}</strong> avg. unfilled posts</span>
            <span><strong className={incidents.length ? "font-semibold text-rose-700" : "font-semibold text-slate-900"}>{data.lastRefresh ? incidents.length : "—"}</strong> incidents</span>
          </div>
          <div className="ml-auto hidden items-center gap-2 xl:flex">
            <button aria-expanded={showBottlenecks} aria-controls="dashboard-bottlenecks" onClick={() => setShowBottlenecks(value => !value)} className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium ${showBottlenecks ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}><List className="h-4 w-4" />{showBottlenecks ? "Hide" : "Show"} bottlenecks</button>
            <button aria-expanded={showDetails} aria-controls="dashboard-details" onClick={() => setShowDetails(value => !value)} className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium ${showDetails ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}><PanelRight className="h-4 w-4" />{showDetails ? "Hide" : "Show"} details</button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span className="hidden lg:inline">Map: staffing now · Coverage: selected shift</span>
          <span role="status" className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${data.lastRefresh && data.connectionState === "live" ? "bg-emerald-500" : "bg-amber-500"}`} />{!data.lastRefresh ? "Loading operations…" : `${data.connectionState === "live" ? "Live" : data.connectionState} · Updated ${new Date(data.lastRefresh).toLocaleTimeString("en-PH", {timeZone:"Asia/Manila", hour:"2-digit", minute:"2-digit"})}`}</span>
        </div>
        {data.loadError && <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{data.loadError}</p>}
        {data.bottleneckActionError && !ba.editingBottleneckId && <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{data.bottleneckActionError}</p>}
        {data.bottleneckActionNotice && <p role="status" className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{data.bottleneckActionNotice}</p>}
      </div>
      <div role="group" aria-label="Dashboard view" className="grid shrink-0 grid-cols-3 gap-1 border-b border-slate-200 bg-white p-2 xl:hidden">
        {([{id:"map",label:"Map",icon:Map},{id:"bottlenecks",label:"Bottlenecks",icon:List},{id:"details",label:"Details",icon:PanelRight}] as const).map(item => <button key={item.id} aria-pressed={mobilePanel === item.id} aria-controls={item.id === "map" ? "dashboard-map" : `dashboard-${item.id}`} onClick={() => setMobilePanel(item.id)} className={`flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium ${mobilePanel === item.id ? "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200" : "text-slate-600 hover:bg-slate-100"}`}><item.icon className="h-4 w-4" />{item.label}</button>)}
      </div>
      {/* KPI Cards */}
      <KPICards
        metrics={dashboardSnapshot.metrics}
        weather={weatherSnapshot}
        weatherLoading={data.weatherLoading}
        deployedOfficersCount={deployedOfficersCount}
        totalOfficersCount={totalOfficersCount}
      />

      {/* Main Content Area */}
      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        {/* Left Sidebar - Bottlenecks List */}
        <div id="dashboard-bottlenecks" className={`${mobilePanel === "bottlenecks" ? "flex" : "hidden"} ${showBottlenecks ? "xl:flex" : "xl:hidden"} min-h-0 w-full shrink-0 flex-col border-r border-slate-200 bg-white xl:w-64 2xl:w-72`}>
          <div className="border-b border-slate-200 bg-white px-3 py-3">
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <h2 className="text-base font-semibold tracking-tight text-slate-900">Bottlenecks</h2>
              <span className="ml-auto inline-flex items-center whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">{data.lastRefresh ? bottlenecks.length : "—"} total</span>
              <span className="inline-flex items-center whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{criticalBottleneckCount} critical</span>
            </div>
            <input type="text" aria-label="Filter bottlenecks by name or ID" placeholder="Filter by name or ID..." value={filterTerm} onChange={(e) => setFilterTerm(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400" />
            <RememberedDetails stateKey="dashboard.filters" className="mt-3 border-t border-slate-100 pt-2">
              <summary className="cursor-pointer text-xs font-medium text-slate-600">Congestion legend</summary>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Free (&lt;{Math.round(severityThresholds.p25 * 100)}%)</div>
                <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />Moderate ({Math.round(severityThresholds.p25 * 100)}-{Math.round(severityThresholds.p50 * 100)}%)</div>
                <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" />Heavy ({Math.round(severityThresholds.p50 * 100)}-{Math.round(severityThresholds.p75 * 100)}%)</div>
                <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />Critical (&ge;{Math.round(severityThresholds.p75 * 100)}%)</div>
              </div>
            </RememberedDetails>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-white">
            {!data.lastRefresh && !data.loadError && <p role="status" className="p-4 text-sm text-slate-600">Loading bottlenecks…</p>}
            {data.lastRefresh && filteredBottlenecks.length === 0 && <p className="p-4 text-sm text-slate-600">No bottlenecks match this area or search.</p>}
            {filteredBottlenecks.map((item) => {
              const tsiPercent = typeof item.tsi === "number" && Number.isFinite(item.tsi) ? Math.round(item.tsi * 100) : null;
              const severity = getRelativeCongestionSeverity(item, severityThresholds);
              const hasIncident = hasIncidentForBottleneck(item.id, item.name);
              const selected = ba.selectedBottleneckId === item.id;
              return (
                <div key={item.id} data-selected={selected ? "true" : undefined} className={`group flex items-center gap-2 border-b border-slate-100 px-3 py-3 transition-all cursor-pointer ${selected ? "bg-amber-50 border-l-4 border-l-amber-500" : "hover:bg-gray-50 border-l-4 border-l-transparent"}`} role="button" tabIndex={0} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onMarkerClick(item, true); } }} onClick={() => { onMarkerClick(item); map.mapRef.current?.flyTo({ center: [item.longitude, item.latitude], zoom: 15, duration: 800 }); }}>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${congestionTone[severity].dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center gap-1.5">
                      <span className="font-mono text-xs font-medium text-slate-500">{item.id}</span>
                      {(hasIncident || item.badge) && <span className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">INCIDENT</span>}
                    </div>
                    <div className="truncate text-sm font-semibold text-gray-900">{item.name}</div>
                    <div className="text-xs text-slate-600">{item.area_name?item.area_name+" · ":""}Now: {item.current_assigned??"—"} scheduled / {item.current_required??"—"} required</div>
                  </div>
                  <div className="ml-2 flex shrink-0 flex-col items-end gap-1">
                    <span className={`text-sm font-bold ${tsiPercent == null ? "text-slate-500" : congestionTone[severity].text}`}>{tsiPercent == null ? "Unavailable" : `${tsiPercent}%`}</span>
                    <div className="flex items-center gap-1">
                      <ConfirmDialog title="Remove Bottleneck" description={`Are you sure you want to remove ${item.id} (${item.name})?`} confirmText="Remove" isDangerous onConfirm={() => markerActionsBusy ? Promise.resolve() : ba.onDeleteBottleneck(item.id)} trigger={<button aria-label="Remove bottleneck" disabled={!canManage || markerActionsBusy} className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50" onClick={(e) => e.stopPropagation()}><Trash2 className="h-3.5 w-3.5" /></button>} />
                      <button disabled={!canManage || markerActionsBusy} aria-label="Edit bottleneck" onClick={(e) => { e.stopPropagation(); editBottleneck(item.id); }} className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-blue-50 hover:text-blue-600"><Pencil className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Map Area */}
        <div id="dashboard-map" aria-label="Live traffic map" className={`${mobilePanel === "map" ? "block" : "hidden"} relative min-h-[28rem] min-w-0 flex-1 bg-slate-100 xl:block xl:min-h-0`}>
          <div className="absolute left-3 right-3 top-3 z-20 flex flex-wrap items-start justify-between gap-2">
            <div className="flex gap-0.5 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              <button onClick={() => { setSelectedView("Congestion"); setShowWeatherOverlay(false); }} className={`rounded-lg px-2.5 py-2 text-xs font-medium transition-colors sm:text-sm ${selectedView === "Congestion" ? "bg-amber-100 text-amber-900" : "text-slate-600 hover:bg-slate-100"}`}>Congestion</button>
              <button onClick={() => { setSelectedView("Weather"); setShowWeatherOverlay(true); }} className={`rounded-lg px-2.5 py-2 text-xs font-medium transition-colors sm:text-sm ${selectedView === "Weather" ? "bg-amber-100 text-amber-900" : "text-slate-600 hover:bg-slate-100"}`}>Weather</button>
              <button onClick={() => { setSelectedView("Assignments"); setShowWeatherOverlay(false); }} className={`rounded-lg px-2.5 py-2 text-xs font-medium transition-colors sm:text-sm ${selectedView === "Assignments" ? "bg-amber-100 text-amber-900" : "text-slate-600 hover:bg-slate-100"}`}>Assignments</button>
            </div>
            <div className="hidden items-center rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-600 2xl:flex"><MapPin className="mr-1 h-4 w-4 text-slate-500" />{dashboardSnapshot.cityLabel}</div>
            <div className="relative">
              <button aria-label="Add Marker" disabled={markerActionsBusy || markerPersisted} aria-expanded={ba.showAddMenu} onClick={() => ba.setShowAddMenu(!ba.showAddMenu)} className="flex h-11 w-11 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 sm:w-auto sm:px-3 disabled:opacity-50"><Plus className="h-4 w-4" /><span className="hidden sm:inline">Add Marker</span><ChevronRight className="hidden h-4 w-4 rotate-90 sm:block" /></button>
              {ba.showAddMenu && (
                <div className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-white p-2 shadow-xl">
                  <button disabled={!canManage || markerActionsBusy || markerPersisted} onClick={() => { ba.setPendingPoint(null); ba.setAddMode("bottleneck"); ba.setEditPickFromMap(false); ba.setShowAddMenu(false); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><div className="h-3 w-3 rounded-full bg-orange-400" />Bottleneck Node</button>
                  <button disabled={markerActionsBusy || markerPersisted} onClick={() => { ba.setPendingPoint(null); ba.setAddMode("poi"); ba.setEditPickFromMap(false); ba.setShowAddMenu(false); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><div className="h-3 w-3 rounded-full bg-blue-500" />Point of Interest</button>
                </div>
              )}
            </div>
            <div className="order-last w-full">
            {selectedView === "Congestion" && <div role="status" className={`inline-flex max-w-full items-center gap-2 rounded-lg bg-white/95 px-3 py-1.5 text-xs shadow-sm ${map.trafficError ? "text-red-700" : "text-slate-600"}`}>
              <span>{map.trafficError ?? (map.trafficLoading ? "Loading traffic roads…" : "Traffic roads · zoom in for local detail")}</span>
              {map.trafficError && <button onClick={map.retryTraffic} className="font-semibold underline" aria-label="Retry traffic layer">Retry</button>}
            </div>}
            </div>
          </div>

          {ba.addMode && <div className="absolute left-3 right-3 top-32 z-20 rounded-lg bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-950 shadow-lg">{markerSaving ? "Saving marker…" : markerPersisted ? "Marker saved. Retry refresh or cancel placement." : `Click map to place ${ba.addMode}`} <button aria-label="Cancel marker placement" disabled={markerActionsBusy} onClick={cancelMarkerPlacement}>×</button></div>}

          {ba.addMode && ba.pendingPoint && <MarkerCreationForm
            key={ba.addMode} kind={ba.addMode} point={ba.pendingPoint}
            disabled={markerActionsBusy}
            onSaved={async () => { await reloadDashboard(); ba.setPendingPoint(null); ba.setAddMode(null); data.setBottleneckActionNotice("Marker saved."); }}
            onCancel={cancelMarkerPlacement}
          />}


          <div className="relative h-full w-full overflow-hidden bg-gray-100">
            <div ref={map.mapContainerRef} className="h-full w-full" />
            {ba.editingBottleneckId && (
              <EditBottleneckOverlay
                error={data.bottleneckActionError}
                editStaffing={ba.editStaffing} setEditStaffing={ba.setEditStaffing}
                editBottleneckName={ba.editBottleneckName} setEditBottleneckName={ba.setEditBottleneckName}
                editBottleneckDistrict={ba.editBottleneckDistrict} setEditBottleneckDistrict={ba.setEditBottleneckDistrict}
                editBottleneckType={ba.editBottleneckType} setEditBottleneckType={ba.setEditBottleneckType}
                editBottleneckWeight={ba.editBottleneckWeight} setEditBottleneckWeight={ba.setEditBottleneckWeight}
                editLatitude={ba.editLatitude} setEditLatitude={ba.setEditLatitude}
                editLongitude={ba.editLongitude} setEditLongitude={ba.setEditLongitude}
                editPickFromMap={ba.editPickFromMap} setEditPickFromMap={ba.setEditPickFromMap}
                onSave={ba.onSaveEditedBottleneck}
                onClose={() => { if (ba.savingEditBottleneck) return; ba.setEditingBottleneckId(null); ba.setEditPickFromMap(false); }}
                savingEditBottleneck={ba.savingEditBottleneck}
              />
            )}
            <WeatherOverlay showWeatherOverlay={showWeatherOverlay} weatherStyle={weatherStyle} WeatherIndicatorIcon={WeatherIndicatorIcon} weatherLabel={weatherLabel} weatherStatusTone={weatherStatusTone} weatherImpactFactor={weatherImpactFactor} />
          </div>

          <IncidentModal showIncidentModal={showIncidentModal} onClose={() => setShowIncidentModal(false)} selectedIncident={selectedIncident} incidentHeadline={incidentHeadline} incidentLocation={incidentLocation} />
          <MapControls map={map.mapRef.current} />
          {pois.length > 0 && <RememberedDetails stateKey="dashboard.poiLegend" aria-label="Point of interest marker legend" className="absolute bottom-3 left-3 z-10 max-w-[calc(100%-5rem)] rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-sm">
            <summary className="cursor-pointer text-xs font-medium text-slate-700">Points of interest</summary>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {poiCategories.map(item => <button key={item.value} aria-pressed={!hiddenPoiCategories.includes(item.value)}
                aria-label={`Show ${item.label} markers`} onClick={() => setHiddenPoiCategories(previous => previous.includes(item.value) ? previous.filter(value => value !== item.value) : [...previous, item.value])}
                className={`flex items-center gap-1 rounded px-1 py-1 text-xs font-medium ${hiddenPoiCategories.includes(item.value) ? "text-slate-400" : "text-slate-800"}`}>
                <PoiSymbol category={item.value} className="h-5 w-4 shrink-0" />{item.label}</button>)}
            </div>
          </RememberedDetails>}
        </div>

        {/* Right Sidebar */}
        <aside id="dashboard-details" aria-label="Dashboard details and quick actions" className={`${mobilePanel === "details" ? "block" : "hidden"} ${showDetails ? "xl:block" : "xl:hidden"} min-h-0 w-full shrink-0 space-y-4 overflow-y-auto border-l border-slate-200 bg-slate-50 p-4 pb-8 xl:h-full xl:w-80 xl:overscroll-contain`}>
          <div className="flex items-center justify-between"><h2 ref={detailsHeadingRef} tabIndex={-1} className="text-sm font-semibold text-slate-900">Operations details</h2><button onClick={() => { setMobilePanel("map"); setShowDetails(false); }} className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200">Back to map</button></div>
          {ba.selectedBottleneckId && ba.getSelectedBottleneck() && (
            <BottleneckDetailPanel
              bottleneck={ba.getSelectedBottleneck()!}
              trafficReading={data.trafficReadings.find(reading => reading.bottleneck === ba.selectedBottleneckId)}
              onClose={() => ba.setSelectedBottleneckId(null)}
              onDelete={id => markerActionsBusy ? Promise.resolve() : ba.onDeleteBottleneck(id)}
              deletingId={data.deletingBottleneckId}
              canManage={canManage && !markerActionsBusy}
            />
          )}
          <IncidentTicker incidents={incidents} onRemoveIncident={onRemoveIncident} />
          {canManage && <QuickOptimizeCard
            selectedShift={selectedShift} setSelectedShift={setSelectedShift}
            selectedIncident={selectedIncident}
          />}

        </aside>
      </div>
    </div>
  );
}
