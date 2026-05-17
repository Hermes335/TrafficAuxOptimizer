import { useEffect, useState } from "react";
import {
  fetchDashboardSnapshot,
  fetchDashboardOfficers,
  fetchCurrentWeather,
  getFallbackDashboardSnapshot,
  subscribeToDashboardStream,
  type DashboardOfficerRecord,
  type DashboardSnapshot,
  type WeatherCurrentSnapshot,
} from "../services/backend";

const fallbackWeather: WeatherCurrentSnapshot = {
  timestamp: new Date().toISOString(),
  condition: "clear",
  temperature: 30,
  precipitation: 0,
  weather_impact_factor: 1,
};

export function useDashboardData() {
  const [dashboardSnapshot, setDashboardSnapshot] = useState<DashboardSnapshot>(
    getFallbackDashboardSnapshot(),
  );
  const [weatherSnapshot, setWeatherSnapshot] = useState<WeatherCurrentSnapshot>(fallbackWeather);
  const [officers, setOfficers] = useState<DashboardOfficerRecord[]>([]);
  const [deployedOfficersCount, setDeployedOfficersCount] = useState(0);
  const [totalOfficersCount, setTotalOfficersCount] = useState(0);
  const [bottleneckActionError, setBottleneckActionError] = useState<string | null>(null);
  const [bottleneckActionNotice, setBottleneckActionNotice] = useState<string | null>(null);
  const [savingBottleneck, setSavingBottleneck] = useState(false);
  const [deletingBottleneckId, setDeletingBottleneckId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const stopStream = subscribeToDashboardStream((event) => {
      if (!active) return;

      if (event.event === "tsi_threshold_exceeded" && event.bottleneck_id) {
        setDashboardSnapshot((current) => ({
          ...current,
          bottlenecks: current.bottlenecks.map((bottleneck) =>
            bottleneck.id === event.bottleneck_id
              ? { ...bottleneck, status: "critical", badge: "LIVE ALERT" }
              : bottleneck,
          ),
        }));
      }

      if (event.event === "weather_wif_shift") {
        setDashboardSnapshot((current) => ({
          ...current,
          metrics: {
            ...current.metrics,
            weatherCorrelation: event.weather_impact_factor ?? current.metrics.weatherCorrelation,
          },
        }));
      }

      if (event.event === "optimization_progress" || event.event === "optimization_complete") {
        setDashboardSnapshot((current) => ({
          ...current,
          metrics: {
            ...current.metrics,
            coverageEfficiency: event.current_fitness ?? current.metrics.coverageEfficiency,
          },
        }));
      }
    });

    fetchDashboardSnapshot()
      .then((snapshot) => {
        if (active) setDashboardSnapshot(snapshot);
      })
      .catch(() => {
        if (active) setDashboardSnapshot(getFallbackDashboardSnapshot());
      });

    fetchCurrentWeather()
      .then((weather) => {
        if (active) setWeatherSnapshot(weather);
      })
      .catch(() => {
        if (active) setWeatherSnapshot(fallbackWeather);
      });

    fetchDashboardOfficers()
      .then((rows) => {
        if (active) {
          setOfficers(rows);
          setTotalOfficersCount(rows.length);
          setDeployedOfficersCount(rows.filter((o) => o.status === "deployed").length);
        }
      })
      .catch(() => {
        if (active) {
          setOfficers([]);
          setTotalOfficersCount(0);
          setDeployedOfficersCount(0);
        }
      });

    return () => {
      active = false;
      stopStream();
    };
  }, []);

  const reloadDashboard = async () => {
    const snapshot = await fetchDashboardSnapshot();
    setDashboardSnapshot(snapshot);
  };

  const reloadOfficers = async () => {
    const rows = await fetchDashboardOfficers();
    setOfficers(rows);
    setTotalOfficersCount(rows.length);
    setDeployedOfficersCount(rows.filter((o) => o.status === "deployed").length);
  };

  return {
    dashboardSnapshot,
    setDashboardSnapshot,
    weatherSnapshot,
    officers,
    deployedOfficersCount,
    totalOfficersCount,
    bottleneckActionError,
    setBottleneckActionError,
    bottleneckActionNotice,
    setBottleneckActionNotice,
    savingBottleneck,
    setSavingBottleneck,
    deletingBottleneckId,
    setDeletingBottleneckId,
    reloadDashboard,
    reloadOfficers,
  };
}
