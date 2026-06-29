import { useEffect, useState } from "react";
import {
  fetchDashboardSnapshot,
  fetchDashboardOfficers,
  fetchDeploymentSchedule,
  fetchCurrentWeather,
  getFallbackDashboardSnapshot,
  subscribeToDashboardStream,
  type DashboardOfficerRecord,
  type DashboardSnapshot,
  type DeploymentScheduleItem,
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
  const [deployments, setDeployments] = useState<DeploymentScheduleItem[]>([]);
  const [deployedOfficersCount, setDeployedOfficersCount] = useState(0);
  const [totalOfficersCount, setTotalOfficersCount] = useState(0);
  const [bottleneckActionError, setBottleneckActionError] = useState<string | null>(null);
  const [bottleneckActionNotice, setBottleneckActionNotice] = useState<string | null>(null);
  const [savingBottleneck, setSavingBottleneck] = useState(false);
  const [deletingBottleneckId, setDeletingBottleneckId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const refreshDeployments = () => {
      fetchDeploymentSchedule()
        .then((rows) => {
          if (active) {
            setDeployments(rows);
          }
        })
        .catch(() => {
          if (active) {
            setDeployments([]);
          }
        });
    };

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

      if (event.event === "deployment_changed" || event.event === "deployment_schedule_cleared") {
        refreshDeployments();
        fetchDashboardSnapshot()
          .then((snapshot) => {
            if (active) setDashboardSnapshot(snapshot);
          })
          .catch(() => { /* ignore refresh errors */ });
        fetchDashboardOfficers()
          .then((rows) => {
            if (active) {
              setOfficers(rows);
              setTotalOfficersCount(rows.filter((o) => o.status === "available" || o.status === "deployed").length);
              setDeployedOfficersCount(rows.filter((o) => o.status === "deployed").length);
            }
          })
          .catch(() => { /* ignore refresh errors */ });
      }

      // Re-fetch bottleneck data when TSI values are updated by Celery
      if (event.event === "bottlenecks_updated") {
        fetchDashboardSnapshot()
          .then((snapshot) => {
            if (active) setDashboardSnapshot(snapshot);
          })
          .catch(() => { /* ignore refresh errors */ });
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

    refreshDeployments();

    fetchDashboardOfficers()
      .then((rows) => {
        if (active) {
          setOfficers(rows);
          setTotalOfficersCount(rows.filter((o) => o.status === "available" || o.status === "deployed").length);
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

    // Periodic refresh every 5 minutes to pick up TSI updates from Celery
    const refreshInterval = window.setInterval(() => {
      if (!active) return;
      fetchDashboardSnapshot()
        .then((snapshot) => {
          if (active) setDashboardSnapshot(snapshot);
        })
        .catch(() => { /* ignore refresh errors */ });
      fetchCurrentWeather()
        .then((weather) => {
          if (active) setWeatherSnapshot(weather);
        })
        .catch(() => { /* ignore refresh errors */ });
    }, 5 * 60 * 1000);

    return () => {
      active = false;
      stopStream();
      window.clearInterval(refreshInterval);
    };
  }, []);

  const reloadDashboard = async () => {
    const snapshot = await fetchDashboardSnapshot();
    setDashboardSnapshot(snapshot);
  };

  const reloadOfficers = async () => {
    const rows = await fetchDashboardOfficers();
    setOfficers(rows);
    setTotalOfficersCount(rows.filter((o) => o.status === "available" || o.status === "deployed").length);
    setDeployedOfficersCount(rows.filter((o) => o.status === "deployed").length);
  };

  return {
    dashboardSnapshot,
    setDashboardSnapshot,
    weatherSnapshot,
    officers,
    deployments,
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
