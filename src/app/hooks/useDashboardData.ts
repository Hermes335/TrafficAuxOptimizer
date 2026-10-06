import { useCallback, useEffect, useRef, useState } from "react";
import { isDeploymentActive } from "../services/operationalTime";
import {
  fetchPOIs, type POI, fetchDashboardSnapshot, fetchDashboardOfficers, fetchDeploymentSchedule, fetchCurrentWeather,
  getFallbackDashboardSnapshot, subscribeToDashboardStream,
  type DashboardOfficerRecord, type DashboardSnapshot, type DeploymentScheduleItem,
  type WeatherCurrentSnapshot, type ConnectionState,
} from "../services/backend";

const missingWeather: WeatherCurrentSnapshot = {
  timestamp: null, condition: null, temperature: null, precipitation: null, weather_impact_factor: null,
  source: "unknown", data_status: "unavailable", available: false, is_synthetic: false,
  is_stale: false, observed_at: null, fetched_at: null,
};
export function dashboardEventNeedsRefresh(event: string) {
  return ["deployment_changed", "incident_reported", "incident_updated", "incident_resolved",
    "incidents_auto_resolved", "bottlenecks_updated", "tsi_threshold_exceeded", "weather_wif_shift",
    "officers_updated", "pois_updated"].includes(event);
}

export function useDashboardData(shift = "afternoon") {
  const [dashboardSnapshot, setDashboardSnapshot] = useState<DashboardSnapshot>(getFallbackDashboardSnapshot);
  const [weatherSnapshot, setWeatherSnapshot] = useState(missingWeather);
  const [pois, setPois] = useState<POI[]>([]);
  const [officers, setOfficers] = useState<DashboardOfficerRecord[]>([]);
  const [deployments, setDeployments] = useState<DeploymentScheduleItem[]>([]);
  const [now, setNow] = useState(Date.now);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bottleneckActionError, setBottleneckActionError] = useState<string | null>(null);
  const [bottleneckActionNotice, setBottleneckActionNotice] = useState<string | null>(null);
  const [deletingBottleneckId, setDeletingBottleneckId] = useState<string | null>(null);
  const generation = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const pendingRefresh = useRef(false);
  const mounted = useRef(false);

  const loadCollections = useCallback(async () => {
    const request = ++generation.current;
      const results = await Promise.allSettled([
        fetchDashboardSnapshot(shift), fetchDashboardOfficers(), fetchDeploymentSchedule(), fetchCurrentWeather(), fetchPOIs(),
      ]);
      if (!mounted.current || request !== generation.current) return;
      const [snapshot, roster, schedule, weather, poiRows] = results;
      if (snapshot.status === "fulfilled") { setDashboardSnapshot(snapshot.value); setLastRefresh(new Date().toISOString()); }
      if (roster.status === "fulfilled") setOfficers(roster.value);
      if (schedule.status === "fulfilled") setDeployments(schedule.value);
      if (weather.status === "fulfilled") setWeatherSnapshot(weather.value);
      if (poiRows.status === "fulfilled") setPois(poiRows.value);
      const failures = results.flatMap((result, i) => result.status === "rejected"
        ? [`${["Dashboard", "Officers", "Schedule", "Weather", "Points of interest"][i]}: ${result.reason instanceof Error ? result.reason.message : "Refresh failed"}`] : []);
      setLoadError(failures.join(" · ") || null);
      if (failures.length) throw new Error(failures.join(" · "));
  }, [shift]);
  const latestLoad = useRef(loadCollections);
  latestLoad.current = loadCollections;
  const reloadDashboard = useCallback(() => {
    pendingRefresh.current = true;
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      let failure: unknown;
      do {
        pendingRefresh.current = false;
        failure = undefined;
        try { await latestLoad.current(); } catch (error) { failure = error; }
      } while (mounted.current && pendingRefresh.current);
      if (failure) throw failure;
    })().finally(() => { inFlight.current = null; });
    return inFlight.current;
  }, []);
  useEffect(() => {
    mounted.current = true;
    setDashboardSnapshot(getFallbackDashboardSnapshot());
    setLastRefresh(null);
    const refresh = () => { setNow(Date.now()); void reloadDashboard().catch(() => {}); };
    refresh();
    const stop = subscribeToDashboardStream(event => {
      if (dashboardEventNeedsRefresh(event.event)) refresh();
    }, undefined, state => {
      setConnectionState(state);
      if (state === "live") refresh(); // Catch up after a missed event or reconnect.
    });
    const timer = window.setInterval(refresh, 60000);
    return () => { mounted.current = false; pendingRefresh.current = false; generation.current++; stop(); window.clearInterval(timer); };
  }, [reloadDashboard, shift]);
  const activeDeployments = deployments.filter(d => d.shift === shift && isDeploymentActive(d, now));
  return {
    dashboardSnapshot, setDashboardSnapshot, weatherSnapshot, officers, deployments, pois, setPois,
    activeDeployments,
    deployedOfficersCount: new Set(activeDeployments.map(d => d.officer)).size,
    totalOfficersCount: officers.filter(o => o.shift === shift && ["available", "deployed"].includes(o.status)).length,
    connectionState, lastRefresh, loadError, bottleneckActionError, setBottleneckActionError,
    bottleneckActionNotice, setBottleneckActionNotice,
    deletingBottleneckId, setDeletingBottleneckId, reloadDashboard, reloadOfficers: reloadDashboard,
  };
}
