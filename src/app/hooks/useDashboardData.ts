import { useCallback, useEffect, useRef, useState } from "react";
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
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bottleneckActionError, setBottleneckActionError] = useState<string | null>(null);
  const [bottleneckActionNotice, setBottleneckActionNotice] = useState<string | null>(null);
  const [deletingBottleneckId, setDeletingBottleneckId] = useState<string | null>(null);
  const generation = useRef(0);

  const reloadDashboard = useCallback(async () => {
    const request = ++generation.current;
    try {
      const [snapshot, roster, schedule, weather, poiRows] = await Promise.all([
        fetchDashboardSnapshot(shift), fetchDashboardOfficers(), fetchDeploymentSchedule(), fetchCurrentWeather(), fetchPOIs(),
      ]);
      if (request !== generation.current) return;
      setDashboardSnapshot(snapshot); setOfficers(roster); setDeployments(schedule); setWeatherSnapshot(weather); setPois(poiRows);
      setLastRefresh(new Date().toISOString()); setLoadError(null);
    } catch (error) {
      if (request !== generation.current) return;
      setLoadError(error instanceof Error ? error.message : "Refresh failed. Displaying last successful data.");
      throw error;
    }
  }, [shift]);
  useEffect(() => {
    setDashboardSnapshot(getFallbackDashboardSnapshot());
    setLastRefresh(null);
    const refresh = () => { void reloadDashboard().catch(() => {}); };
    refresh();
    const stop = subscribeToDashboardStream(event => {
      if (dashboardEventNeedsRefresh(event.event)) refresh();
    }, undefined, state => {
      setConnectionState(state);
      if (state === "live") refresh(); // Catch up after a missed event or reconnect.
    });
    const timer = window.setInterval(refresh, 60000);
    return () => { generation.current++; stop(); window.clearInterval(timer); };
  }, [reloadDashboard]);
  return {
    dashboardSnapshot, setDashboardSnapshot, weatherSnapshot, officers, deployments, pois, setPois,
    deployedOfficersCount: new Set(deployments.filter(d => d.shift === shift && d.status === "assigned").map(d => d.officer)).size,
    totalOfficersCount: officers.filter(o => o.shift === shift && ["available", "deployed"].includes(o.status)).length,
    connectionState, lastRefresh, loadError, bottleneckActionError, setBottleneckActionError,
    bottleneckActionNotice, setBottleneckActionNotice,
    deletingBottleneckId, setDeletingBottleneckId, reloadDashboard, reloadOfficers: reloadDashboard,
  };
}
