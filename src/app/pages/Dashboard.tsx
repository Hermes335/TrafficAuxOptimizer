import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronRight, Cloud, CloudRain, MapPin, Plus, Pencil, Trash2 } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import { getApiBaseUrl, fetchDeploymentSchedule, type DeploymentScheduleItem } from "../services/backend";
import { useDashboardData } from "../hooks/useDashboardData";
import { useBottleneckActions } from "../hooks/useBottleneckActions";
import { useMapIntegration } from "../hooks/useMapIntegration";
import { useMapClickHandler } from "../hooks/useMapClickHandler";
import { useMapMarkers } from "../hooks/useMapMarkers";
import { useMapAssignmentLines } from "../hooks/useMapAssignmentLines";
import { getCongestionSeverity, congestionTone } from "../types/severity";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  KPICards,
  BottleneckDetailPanel,
  IncidentTicker,
  QuickOptimizeCard,
  SystemStats,
  MapControls,
  WeatherOverlay,
  IncidentModal,
  EditBottleneckOverlay,
} from "./Dashboard/components";

export function Dashboard() {
  // --- Data hook ---
  const data = useDashboardData();
  const { dashboardSnapshot, setDashboardSnapshot, weatherSnapshot, deployedOfficersCount, totalOfficersCount, reloadDashboard } = data;

  // --- UI state ---
  const [selectedView, setSelectedView] = useState("Congestion");
  const [showIncidentModal, setShowIncidentModal] = useState(true);
  const [showWeatherOverlay, setShowWeatherOverlay] = useState(false);
  const [selectedShift, setSelectedShift] = useState("Afternoon");
  const [filterTerm, setFilterTerm] = useState("");
  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(null);
  const [pois, setPois] = useState<Array<{ id: string; name: string; category: string; latitude: number; longitude: number }>>([]);
  const [deployments, setDeployments] = useState<DeploymentScheduleItem[]>([]);

  // Fetch deployments on mount
  useEffect(() => {
    fetchDeploymentSchedule()
      .then(setDeployments)
      .catch(() => setDeployments([]));
  }, []);

  // --- Bottleneck actions hook ---
  const ba = useBottleneckActions({
    dashboardSnapshot,
    setDashboardSnapshot,
    reloadDashboard,
    setBottleneckActionError: data.setBottleneckActionError,
    setBottleneckActionNotice: data.setBottleneckActionNotice,
    setSavingBottleneck: data.setSavingBottleneck,
    setDeletingBottleneckId: data.setDeletingBottleneckId,
  });

  // --- Map integration ---
  const tomTomTrafficTileUrl = `${getApiBaseUrl()}/api/maps/tomtom-traffic/{z}/{x}/{y}.png?style=relative0`;
  const map = useMapIntegration({ selectedView, tomTomTrafficTileUrl });

  // --- Map click handler ---
  useMapClickHandler({
    mapRef: map.mapRef,
    addMode: ba.addMode,
    setAddMode: ba.setAddMode,
    editPickFromMap: ba.editPickFromMap,
    setEditLatitude: ba.setEditLatitude,
    setEditLongitude: ba.setEditLongitude,
    setDashboardSnapshot,
    setSelectedBottleneckId: ba.setSelectedBottleneckId,
    setPois,
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

  const criticalBottleneckCount = useMemo(
    () => bottlenecks.filter((item) => item.status === "critical" || Math.round((Number(item.tsi) || 0) * 100) >= 80).length,
    [bottlenecks],
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
  useMemo(() => {
    if (selectedIncidentId === null && incidents.length > 0) {
      setSelectedIncidentId(incidents[0].id);
    }
  }, [incidents, selectedIncidentId]);

  // --- Weather derived ---
  const weatherLabel = weatherSnapshot.condition.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  const weatherStatusTone = weatherSnapshot.weather_impact_factor >= 1.7 ? "Severe" : weatherSnapshot.weather_impact_factor >= 1.3 ? "Moderate" : "Clear";
  const weatherStyle = weatherStatusTone === "Severe"
    ? { overlayClass: "bg-slate-700/18", blurClass: "backdrop-blur-[0.8px]", gradient: "radial-gradient(circle at 30% 35%, rgba(71, 85, 105, 0.40) 0%, transparent 52%), radial-gradient(circle at 70% 65%, rgba(30, 41, 59, 0.32) 0%, transparent 54%)", chipClass: "bg-rose-500 text-white", bannerClass: "bg-rose-500 text-white", iconClass: "text-rose-100", icon: CloudRain }
    : weatherStatusTone === "Moderate"
      ? { overlayClass: "bg-blue-500/14", blurClass: "backdrop-blur-[0.5px]", gradient: "radial-gradient(circle at 30% 40%, rgba(59, 130, 246, 0.28) 0%, transparent 50%), radial-gradient(circle at 70% 60%, rgba(29, 78, 216, 0.20) 0%, transparent 52%)", chipClass: "bg-yellow-400 text-white", bannerClass: "bg-yellow-400 text-white", iconClass: "text-yellow-100", icon: CloudRain }
      : { overlayClass: "bg-emerald-400/3", blurClass: "backdrop-blur-0", gradient: "radial-gradient(circle at 30% 35%, rgba(16, 185, 129, 0.08) 0%, transparent 50%), radial-gradient(circle at 75% 60%, rgba(52, 211, 153, 0.06) 0%, transparent 52%)", chipClass: "bg-emerald-500 text-white", bannerClass: "bg-emerald-500 text-white", iconClass: "text-emerald-100", icon: Cloud };
  const WeatherIndicatorIcon = weatherStyle.icon;

  // --- Metrics ---
  const coverageEfficiency = Math.max(0, Math.min(100, dashboardSnapshot.metrics.coverageEfficiency));
  const avgResponseTimeMinutes = dashboardSnapshot.metrics.avgResponseTimeMinutes;
  const resourceUtilization = Math.max(0, Math.min(100, dashboardSnapshot.metrics.resourceUtilization));
  const weatherCorrelation = dashboardSnapshot.metrics.weatherCorrelation;
  const coverageCircumference = 2 * Math.PI * 16;
  const responseDeltaMinutes = Number((15 - avgResponseTimeMinutes).toFixed(1));
  const weatherImpactText = weatherCorrelation >= 1.7 ? "Severe impact today" : weatherCorrelation >= 1.3 ? "Moderate impact today" : "Low impact today";

  // --- Quick optimize derived ---
  const selectedShiftKey = selectedShift.toLowerCase();
  const shiftPressure = selectedShiftKey === "morning" ? 0.92 : 1.08;
  const incidentImpact = selectedIncident?.type === "critical" ? 1.4 : selectedIncident?.type === "major" ? 1.15 : 1.0;
  const impactRadiusKm = Number((Math.max(0.8, Math.min(4.2, selectedIncident ? incidentImpact * shiftPressure * 1.4 : 1.2))).toFixed(1));
  const estimatedClearMinutes = Math.max(15, Math.round(avgResponseTimeMinutes * impactRadiusKm * weatherCorrelation * 0.6));
  const networkHealthLabel = coverageEfficiency >= 80 && resourceUtilization < 85 ? "HEALTHY" : coverageEfficiency >= 65 ? "MARGINAL" : "CRITICAL";
  const networkHealthClass = networkHealthLabel === "HEALTHY" ? "text-green-600" : networkHealthLabel === "MARGINAL" ? "text-orange-600" : "text-red-600";
  const cityFlowValue = Math.max(0, Math.min(100, Math.round(coverageEfficiency - (selectedShiftKey === "afternoon" ? 6 : 2))));
  const cityFlowDelta = Math.round(cityFlowValue - coverageEfficiency);
  const delayDeltaMinutes = Math.round(avgResponseTimeMinutes - 15);
  const incidentHeadline = selectedIncident?.text?.split(" - ")[0] ?? "No active incident";
  const incidentLocation = selectedIncident?.text?.split(" - ")[1] ?? "Monitor dashboard telemetry for updates";

  // --- Map marker click handler ---
  const onMarkerClick = (bottleneck: { id: string }) => {
    ba.setSelectedBottleneckId(bottleneck.id);
  };

  // --- Map markers hook ---
  useMapMarkers({
    mapRef: map.mapRef,
    markersRef: map.markersRef,
    hasFittedRef: map.hasFittedRef,
    filteredBottlenecks,
    onMarkerClick,
  });

  // --- Assignment lines hook (shows officer->bottleneck lines when Assignments view active) ---
  useMapAssignmentLines({
    mapRef: map.mapRef,
    selectedView,
    bottlenecks: filteredBottlenecks,
    deployments,
  });

  return (
    <div className="flex h-full flex-col">
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
            <input type="text" placeholder="Filter by name or ID..." value={filterTerm} onChange={(e) => setFilterTerm(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400" />
            <div className="mt-4 border-t border-gray-100 pt-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Congestion Layer Key</div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-600">
                <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Free</div>
                <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />Moderate</div>
                <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" />Heavy</div>
                <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />Critical</div>
              </div>
            </div>
            {data.bottleneckActionError && <p className="mt-2 text-xs text-red-600">{data.bottleneckActionError}</p>}
            {data.bottleneckActionNotice && <p className="mt-2 text-xs text-green-700">{data.bottleneckActionNotice}</p>}
          </div>
          <div className="flex-1 overflow-y-auto bg-[#f8fafc]">
            {filteredBottlenecks.map((item) => {
              const tsiPercent = Math.round((Number(item.tsi) || 0) * 100);
              const severity = getCongestionSeverity(item);
              const hasIncident = hasIncidentForBottleneck(item.id, item.name);
              const selected = ba.selectedBottleneckId === item.id;
              return (
                <div key={item.id} className={`group flex items-center gap-3 border-b border-gray-100 px-3 py-2.5 transition-all cursor-pointer ${selected ? "bg-amber-50 border-l-4 border-l-amber-500" : "hover:bg-gray-50 border-l-4 border-l-transparent"}`} onClick={() => { ba.setSelectedBottleneckId(item.id); }}>
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
                      <ConfirmDialog title="Remove Bottleneck" description={`Are you sure you want to remove ${item.id} (${item.name})?`} confirmText="Remove" isDangerous onConfirm={() => ba.onDeleteBottleneck(item.id)} trigger={<button disabled={data.deletingBottleneckId === item.id} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50" onClick={(e) => e.stopPropagation()}><Trash2 className="h-3.5 w-3.5" /></button>} />
                      <button onClick={(e) => { e.stopPropagation(); ba.startEditingBottleneck(item.id); }} className="rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-600"><Pencil className="h-3.5 w-3.5" /></button>
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
              <button onClick={() => { setSelectedView("Congestion"); setShowWeatherOverlay(false); }} className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${selectedView === "Congestion" ? "bg-yellow-400 text-white" : "text-gray-600 hover:bg-gray-100"}`}>Congestion</button>
              <button onClick={() => { setSelectedView("Weather"); setShowWeatherOverlay(true); }} className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${selectedView === "Weather" ? "bg-yellow-400 text-white" : "text-gray-600 hover:bg-gray-100"}`}>Weather</button>
              <button onClick={() => { setSelectedView("Assignments"); setShowWeatherOverlay(false); }} className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${selectedView === "Assignments" ? "bg-yellow-400 text-white" : "text-gray-600 hover:bg-gray-100"}`}>Assignments</button>
            </div>
            <div className="flex items-center rounded-full bg-white px-4 py-1.5 text-sm font-medium shadow-md"><MapPin className="mr-1 h-4 w-4 text-pink-500" />{dashboardSnapshot.cityLabel}</div>
            <button className="flex items-center gap-1 rounded-full bg-white px-4 py-1.5 text-sm font-medium text-gray-700 shadow-md hover:bg-gray-50"><AlertCircle className="h-4 w-4 text-orange-400" />Guide</button>
            <div className="relative">
              <button onClick={() => ba.setShowAddMenu(!ba.showAddMenu)} className="flex items-center gap-1 rounded-full bg-orange-500 px-4 py-1.5 text-sm font-medium text-white shadow-md hover:bg-orange-600"><Plus className="h-4 w-4" />Add Marker<ChevronRight className="h-4 w-4 rotate-90" /></button>
              {ba.showAddMenu && (
                <div className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-white p-2 shadow-xl">
                  <button onClick={() => { ba.setAddMode("bottleneck"); ba.setShowAddMenu(false); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><div className="h-3 w-3 rounded-full bg-orange-400" />Bottleneck Node</button>
                  <button onClick={() => { ba.setAddMode("incident"); ba.setShowAddMenu(false); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><div className="h-3 w-3 rounded-full bg-red-500" />Incident Marker</button>
                  <button onClick={() => { ba.setAddMode("poi"); ba.setShowAddMenu(false); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><div className="h-3 w-3 rounded-full bg-blue-500" />Point of Interest</button>
                </div>
              )}
            </div>
          </div>

          {ba.addMode && <div className="absolute left-1/2 top-20 z-20 -translate-x-1/2 rounded-full bg-orange-500 px-6 py-2 text-sm font-bold text-white shadow-lg animate-pulse">Click map to place {ba.addMode}</div>}

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
            <WeatherOverlay showWeatherOverlay={showWeatherOverlay} weatherStyle={weatherStyle} WeatherIndicatorIcon={WeatherIndicatorIcon} weatherLabel={weatherLabel} weatherStatusTone={weatherStatusTone} weatherImpactFactor={weatherSnapshot.weather_impact_factor} />
            <div className="pointer-events-none absolute bottom-4 left-4 z-20 rounded-lg border border-gray-200 bg-white/95 px-3 py-2 shadow-sm">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Severity</div>
              <div className="flex flex-wrap gap-3 text-xs">
                <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /><span className="text-gray-600">Free (&lt;40%)</span></div>
                <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-yellow-500" /><span className="text-gray-600">Moderate (40-59%)</span></div>
                <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" /><span className="text-gray-600">Heavy (60-79%)</span></div>
                <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /><span className="text-gray-600">Critical (&ge;80%)</span></div>
              </div>
            </div>
          </div>

          <IncidentModal showIncidentModal={showIncidentModal} onClose={() => setShowIncidentModal(false)} selectedIncident={selectedIncident} incidentHeadline={incidentHeadline} incidentLocation={incidentLocation} />
          <MapControls map={map.mapRef.current} />
        </div>

        {/* Right Sidebar */}
        <div className="w-full space-y-4 overflow-y-auto bg-white p-4 md:w-96">
          {ba.selectedBottleneckId && ba.getSelectedBottleneck() && (
            <BottleneckDetailPanel
              bottleneck={ba.getSelectedBottleneck()!}
              onClose={() => ba.setSelectedBottleneckId(null)}
              onDelete={ba.onDeleteBottleneck}
              deletingId={data.deletingBottleneckId}
            />
          )}
          <IncidentTicker incidents={incidents} />
          <QuickOptimizeCard
            selectedShift={selectedShift} setSelectedShift={setSelectedShift}
            WeatherIndicatorIcon={WeatherIndicatorIcon} weatherStyle={weatherStyle} weatherLabel={weatherLabel}
            impactRadiusKm={impactRadiusKm} estimatedClearMinutes={estimatedClearMinutes}
            networkHealthLabel={networkHealthLabel} networkHealthClass={networkHealthClass}
            selectedIncident={selectedIncident}
          />
          <SystemStats cityFlowValue={cityFlowValue} cityFlowDelta={cityFlowDelta} avgResponseTimeMinutes={avgResponseTimeMinutes} delayDeltaMinutes={delayDeltaMinutes} />
        </div>
      </div>
    </div>
  );
}
