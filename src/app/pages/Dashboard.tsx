import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  TrendingDown,
  ChevronRight,
  Camera,
  X,
  MapPin,
  Navigation,
  Maximize2,
  TrendingUp,
  ArrowDown,
  Cloud,
  CloudRain,
  Target,
  Clock,
  Plus,
  Trash2,
  Pencil,
  UserPlus,
  UserRound,
} from "lucide-react";
import { Link } from "react-router";
import incidentImage from "../../assets/57fa97e8c83f22033790625605fab5b96dfc2d8b.png";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  createDashboardBottleneck,
  createDashboardOfficer,
  deleteDashboardBottleneck,
  deleteDashboardOfficer,
  fetchDashboardSnapshot,
  fetchDashboardOfficers,
  fetchCurrentWeather,
  getApiBaseUrl,
  getFallbackDashboardSnapshot,
  subscribeToDashboardStream,
  updateDashboardBottleneck,
  updateDashboardOfficer,
  type DashboardOfficerRecord,
  type DashboardSnapshot,
  type WeatherCurrentSnapshot,
} from "../services/backend";

export function Dashboard() {
  const fallbackWeather: WeatherCurrentSnapshot = {
    timestamp: new Date().toISOString(),
    condition: "clear",
    temperature: 30,
    precipitation: 0,
    weather_impact_factor: 1,
  };

  const [dashboardSnapshot, setDashboardSnapshot] = useState<DashboardSnapshot>(
    getFallbackDashboardSnapshot(),
  );
  const [weatherSnapshot, setWeatherSnapshot] = useState<WeatherCurrentSnapshot>(fallbackWeather);
  const [selectedView, setSelectedView] = useState("Congestion");
  const [showIncidentModal, setShowIncidentModal] = useState(true);
  const [showWeatherOverlay, setShowWeatherOverlay] = useState(false);
  const [selectedShift, setSelectedShift] = useState("Afternoon");
  const [filterTerm, setFilterTerm] = useState("");
  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(null);
  const [isAddMode, setIsAddMode] = useState(false);
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
  const [officers, setOfficers] = useState<DashboardOfficerRecord[]>([]);
  const [officerError, setOfficerError] = useState<string | null>(null);
  const [officerNotice, setOfficerNotice] = useState<string | null>(null);
  const [addingOfficer, setAddingOfficer] = useState(false);
  const [editingOfficerId, setEditingOfficerId] = useState<number | null>(null);
  const [savingOfficer, setSavingOfficer] = useState(false);
  const [deletingOfficerId, setDeletingOfficerId] = useState<number | null>(null);
  const [officerName, setOfficerName] = useState("");
  const [officerBadge, setOfficerBadge] = useState("");
  const [officerShift, setOfficerShift] = useState<"morning" | "afternoon" | "night">("afternoon");
  const [officerStatus, setOfficerStatus] = useState<"available" | "deployed" | "off_duty" | "unavailable">("available");
  const [officerSkillsInput, setOfficerSkillsInput] = useState("");
  const [bottleneckActionError, setBottleneckActionError] = useState<string | null>(null);
  const [bottleneckActionNotice, setBottleneckActionNotice] = useState<string | null>(null);
  const [savingBottleneck, setSavingBottleneck] = useState(false);
  const [deletingBottleneckId, setDeletingBottleneckId] = useState<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const hasFittedRef = useRef(false);

  useEffect(() => {
    let active = true;

    const stopStream = subscribeToDashboardStream((event) => {
      if (!active) {
        return;
      }

      if (event.event === "tsi_threshold_exceeded" && event.bottleneck_id) {
        setDashboardSnapshot((current) => ({
          ...current,
          bottlenecks: current.bottlenecks.map((bottleneck) =>
            bottleneck.id === event.bottleneck_id
              ? {
                  ...bottleneck,
                  status: "critical",
                  badge: "LIVE ALERT",
                }
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
            coverageEfficiency:
              event.current_fitness ?? current.metrics.coverageEfficiency,
          },
        }));
      }
    });

    fetchDashboardSnapshot()
      .then((snapshot) => {
        if (active) {
          setDashboardSnapshot(snapshot);
        }
      })
      .catch(() => {
        if (active) {
          setDashboardSnapshot(getFallbackDashboardSnapshot());
        }
      });

    fetchCurrentWeather()
      .then((weather) => {
        if (active) {
          setWeatherSnapshot(weather);
        }
      })
      .catch(() => {
        if (active) {
          setWeatherSnapshot(fallbackWeather);
        }
      });

    fetchDashboardOfficers()
      .then((rows) => {
        if (active) {
          setOfficers(rows);
        }
      })
      .catch(() => {
        if (active) {
          setOfficers([]);
        }
      });

    return () => {
      active = false;
      stopStream();
    };
  }, []);

  const bottlenecks = dashboardSnapshot.bottlenecks;
  const incidents = dashboardSnapshot.incidents;
  const filteredBottlenecks = useMemo(() => {
    const term = filterTerm.trim().toLowerCase();
    if (!term) {
      return bottlenecks;
    }

    return bottlenecks.filter(
      (item) =>
        item.id.toLowerCase().includes(term) ||
        item.name.toLowerCase().includes(term) ||
        item.status.toLowerCase().includes(term),
    );
  }, [bottlenecks, filterTerm]);

  const selectedIncident = useMemo(() => {
    if (incidents.length === 0) {
      return null;
    }
    return incidents.find((item) => item.id === selectedIncidentId) ?? incidents[0];
  }, [incidents, selectedIncidentId]);

  useEffect(() => {
    if (selectedIncidentId === null && incidents.length > 0) {
      setSelectedIncidentId(incidents[0].id);
    }
  }, [incidents, selectedIncidentId]);

  const mapCenter: [number, number] = [122.5621, 10.7202];
  const tomTomTrafficTileUrl = `${getApiBaseUrl()}/api/maps/tomtom-traffic/{z}/{x}/{y}.png?style=relative0`;

  const weatherLabel = weatherSnapshot.condition
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

  const coverageEfficiency = Math.max(0, Math.min(100, dashboardSnapshot.metrics.coverageEfficiency));
  const avgResponseTimeMinutes = dashboardSnapshot.metrics.avgResponseTimeMinutes;
  const resourceUtilization = Math.max(0, Math.min(100, dashboardSnapshot.metrics.resourceUtilization));
  const weatherCorrelation = dashboardSnapshot.metrics.weatherCorrelation;

  const coverageCircumference = 2 * Math.PI * 16;
  const responseTargetMinutes = 15;
  const responseDeltaMinutes = Number((responseTargetMinutes - avgResponseTimeMinutes).toFixed(1));
  const weatherImpactText =
    weatherCorrelation >= 1.7 ? "Severe impact today" : weatherCorrelation >= 1.3 ? "Moderate impact today" : "Low impact today";

  const weatherStatusTone =
    weatherSnapshot.weather_impact_factor >= 1.7
      ? "Severe"
      : weatherSnapshot.weather_impact_factor >= 1.3
        ? "Moderate"
        : "Clear";

  const weatherStyle =
    weatherStatusTone === "Severe"
      ? {
          overlayClass: "bg-slate-700/18",
          blurClass: "backdrop-blur-[0.8px]",
          gradient:
            "radial-gradient(circle at 30% 35%, rgba(71, 85, 105, 0.40) 0%, transparent 52%), radial-gradient(circle at 70% 65%, rgba(30, 41, 59, 0.32) 0%, transparent 54%)",
          chipClass: "bg-rose-500 text-white",
          bannerClass: "bg-rose-500 text-white",
          iconClass: "text-rose-100",
          icon: CloudRain,
        }
      : weatherStatusTone === "Moderate"
        ? {
            overlayClass: "bg-blue-500/14",
            blurClass: "backdrop-blur-[0.5px]",
            gradient:
              "radial-gradient(circle at 30% 40%, rgba(59, 130, 246, 0.28) 0%, transparent 50%), radial-gradient(circle at 70% 60%, rgba(29, 78, 216, 0.20) 0%, transparent 52%)",
            chipClass: "bg-yellow-400 text-white",
            bannerClass: "bg-yellow-400 text-white",
            iconClass: "text-yellow-100",
            icon: CloudRain,
          }
        : {
            overlayClass: "bg-emerald-400/3",
            blurClass: "backdrop-blur-0",
            gradient:
              "radial-gradient(circle at 30% 35%, rgba(16, 185, 129, 0.08) 0%, transparent 50%), radial-gradient(circle at 75% 60%, rgba(52, 211, 153, 0.06) 0%, transparent 52%)",
            chipClass: "bg-emerald-500 text-white",
            bannerClass: "bg-emerald-500 text-white",
            iconClass: "text-emerald-100",
            icon: Cloud,
          };

  const WeatherIndicatorIcon = weatherStyle.icon;

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      center: mapCenter,
      zoom: 12.6,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
          tomtomTraffic: {
            type: "raster",
            tiles: [tomTomTrafficTileUrl],
            tileSize: 256,
            attribution: "© TomTom",
          },
        },
        layers: [
          { id: "osm-base", type: "raster", source: "osm" },
          {
            id: "tomtom-traffic-flow",
            type: "raster",
            source: "tomtomTraffic",
            paint: { "raster-opacity": 0.95, "raster-fade-duration": 350 },
          },
        ],
      },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      hasFittedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [tomTomTrafficTileUrl]);

  useEffect(() => {
    if (!mapRef.current || !mapRef.current.getLayer("tomtom-traffic-flow")) {
      return;
    }

    const opacity =
      selectedView === "Congestion"
        ? 0.95
        : selectedView === "Weather"
          ? 0.55
          : 0.35;

    mapRef.current.setPaintProperty("tomtom-traffic-flow", "raster-opacity", opacity);
  }, [selectedView]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    const map = mapRef.current;
    const onMapClick = (event: maplibregl.MapMouseEvent) => {
      const latitude = Number(event.lngLat.lat.toFixed(6));
      const longitude = Number(event.lngLat.lng.toFixed(6));
      if (isAddMode) {
        setPendingPoint({ latitude, longitude });
      }
      if (editPickFromMap) {
        setEditLatitude(String(latitude));
        setEditLongitude(String(longitude));
      }
      setBottleneckActionError(null);
      setBottleneckActionNotice(null);
    };

    const enableClickCapture = isAddMode || editPickFromMap;
    map.getCanvas().style.cursor = enableClickCapture ? "crosshair" : "";

    if (enableClickCapture) {
      map.on("click", onMapClick);
    }

    return () => {
      map.getCanvas().style.cursor = "";
      map.off("click", onMapClick);
    };
  }, [isAddMode, editPickFromMap]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    for (const bottleneck of filteredBottlenecks) {
      const markerEl = document.createElement("div");
      markerEl.className = "h-4 w-4 rounded-full border-2 border-white shadow";

      const tsiPercent = Math.round((Number(bottleneck.tsi) || 0) * 100);
      let color = "#22c55e";
      if (bottleneck.status === "critical" || tsiPercent >= 80) {
        color = "#ef4444";
      } else if (tsiPercent >= 40) {
        color = "#f59e0b";
      }
      markerEl.style.backgroundColor = color;

      const popup = new maplibregl.Popup({ offset: 10 }).setHTML(
        `<div><div style="font-weight:600">${bottleneck.id}</div><div>${bottleneck.name}</div><div style="font-size:12px;margin-top:4px">TSI: ${tsiPercent}%</div><div style="text-transform:uppercase;font-size:11px;color:#6b7280">${bottleneck.status}</div></div>`,
      );

      const marker = new maplibregl.Marker({ element: markerEl })
        .setLngLat([bottleneck.longitude, bottleneck.latitude])
        .setPopup(popup)
        .addTo(mapRef.current);

      markersRef.current.push(marker);
    }

    if (!hasFittedRef.current && filteredBottlenecks.length > 1 && mapRef.current) {
      const bounds = new maplibregl.LngLatBounds(
        [filteredBottlenecks[0].longitude, filteredBottlenecks[0].latitude],
        [filteredBottlenecks[0].longitude, filteredBottlenecks[0].latitude],
      );
      for (const point of filteredBottlenecks) {
        bounds.extend([point.longitude, point.latitude]);
      }
      mapRef.current.fitBounds(bounds, { padding: 80, duration: 600, maxZoom: 14 });
      hasFittedRef.current = true;
    }
  }, [filteredBottlenecks]);

  const selectedShiftKey = selectedShift.toLowerCase();
  const shiftPressure = selectedShiftKey === "morning" ? 0.92 : 1.08;
  const incidentImpact = selectedIncident?.type === "critical" ? 1.4 : selectedIncident?.type === "major" ? 1.15 : 1.0;
  const impactRadiusKm = Number((Math.max(0.8, Math.min(4.2, (selectedIncident ? incidentImpact * shiftPressure * 1.4 : 1.2)))).toFixed(1));
  const estimatedClearMinutes = Math.max(15, Math.round(avgResponseTimeMinutes * impactRadiusKm * weatherCorrelation * 0.6));
  const networkHealthLabel =
    coverageEfficiency >= 80 && resourceUtilization < 85
      ? "HEALTHY"
      : coverageEfficiency >= 65
        ? "MARGINAL"
        : "CRITICAL";
  const networkHealthClass =
    networkHealthLabel === "HEALTHY"
      ? "text-green-600"
      : networkHealthLabel === "MARGINAL"
        ? "text-orange-600"
        : "text-red-600";

  const cityFlowValue = Math.max(0, Math.min(100, Math.round(coverageEfficiency - (selectedShiftKey === "afternoon" ? 6 : 2))));
  const cityFlowDelta = Math.round(cityFlowValue - coverageEfficiency);
  const delayDeltaMinutes = Math.round(avgResponseTimeMinutes - 15);

  const incidentHeadline = selectedIncident?.text?.split(" - ")[0] ?? "No active incident";
  const incidentLocation = selectedIncident?.text?.split(" - ")[1] ?? "Monitor dashboard telemetry for updates";

  const reloadDashboard = async () => {
    const snapshot = await fetchDashboardSnapshot();
    setDashboardSnapshot(snapshot);
  };

  const reloadOfficers = async () => {
    const rows = await fetchDashboardOfficers();
    setOfficers(rows);
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
      setIsAddMode(false);
    } catch (actionError: unknown) {
      setBottleneckActionError(actionError instanceof Error ? actionError.message : "Failed to create bottleneck.");
    } finally {
      setSavingBottleneck(false);
    }
  };

  const onDeleteBottleneck = async (bottleneckId: string) => {
    const confirmed = window.confirm(`Remove ${bottleneckId} from active bottlenecks?`);
    if (!confirmed) {
      return;
    }

    setDeletingBottleneckId(bottleneckId);
    setBottleneckActionError(null);
    setBottleneckActionNotice(null);
    try {
      await deleteDashboardBottleneck(bottleneckId);
      await reloadDashboard();
      setBottleneckActionNotice(`${bottleneckId} removed.`);
    } catch (actionError: unknown) {
      setBottleneckActionError(actionError instanceof Error ? actionError.message : "Failed to remove bottleneck.");
    } finally {
      setDeletingBottleneckId(null);
    }
  };

  const startEditingBottleneck = (bottleneckId: string) => {
    const target = dashboardSnapshot.bottlenecks.find((item) => item.id === bottleneckId);
    if (!target) {
      return;
    }

    setEditingBottleneckId(target.id);
    setEditBottleneckName(target.name);
    setEditBottleneckDistrict("Iloilo City");
    setEditBottleneckType("intersection");
    setEditBottleneckWeight("1.0");
    setEditLatitude(String(target.latitude));
    setEditLongitude(String(target.longitude));
    setEditPickFromMap(false);
    setIsAddMode(false);
    setBottleneckActionError(null);
    setBottleneckActionNotice(null);
  };

  const onSaveEditedBottleneck = async () => {
    if (!editingBottleneckId) {
      return;
    }

    if (!editBottleneckName.trim()) {
      setBottleneckActionError("Bottleneck name is required.");
      return;
    }

    const latitude = Number(editLatitude);
    const longitude = Number(editLongitude);
    const weight = Number(editBottleneckWeight);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setBottleneckActionError("Latitude and longitude must be valid numbers.");
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
        latitude,
        longitude,
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

  const resetOfficerForm = () => {
    setOfficerName("");
    setOfficerBadge("");
    setOfficerShift("afternoon");
    setOfficerStatus("available");
    setOfficerSkillsInput("");
  };

  const onAddOfficer = async () => {
    if (!officerName.trim() || !officerBadge.trim()) {
      setOfficerError("Officer name and badge number are required.");
      return;
    }

    const skills = officerSkillsInput
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    setSavingOfficer(true);
    setOfficerError(null);
    setOfficerNotice(null);
    try {
      await createDashboardOfficer({
        name: officerName.trim(),
        badge_number: officerBadge.trim(),
        shift: officerShift,
        status: officerStatus,
        skills,
      });
      await reloadOfficers();
      resetOfficerForm();
      setAddingOfficer(false);
      setOfficerNotice("Officer added successfully.");
    } catch (actionError: unknown) {
      setOfficerError(actionError instanceof Error ? actionError.message : "Failed to add officer.");
    } finally {
      setSavingOfficer(false);
    }
  };

  const startEditingOfficer = (officer: DashboardOfficerRecord) => {
    setEditingOfficerId(officer.id);
    setOfficerName(officer.name);
    setOfficerBadge(officer.badge_number);
    setOfficerShift(officer.shift);
    setOfficerStatus(officer.status);
    setOfficerSkillsInput((officer.skills ?? []).join(", "));
    setAddingOfficer(false);
    setOfficerError(null);
    setOfficerNotice(null);
  };

  const onUpdateOfficer = async () => {
    if (!editingOfficerId) {
      return;
    }
    if (!officerName.trim() || !officerBadge.trim()) {
      setOfficerError("Officer name and badge number are required.");
      return;
    }

    const skills = officerSkillsInput
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    setSavingOfficer(true);
    setOfficerError(null);
    setOfficerNotice(null);
    try {
      await updateDashboardOfficer(editingOfficerId, {
        name: officerName.trim(),
        badge_number: officerBadge.trim(),
        shift: officerShift,
        status: officerStatus,
        skills,
      });
      await reloadOfficers();
      setEditingOfficerId(null);
      resetOfficerForm();
      setOfficerNotice("Officer updated successfully.");
    } catch (actionError: unknown) {
      setOfficerError(actionError instanceof Error ? actionError.message : "Failed to update officer.");
    } finally {
      setSavingOfficer(false);
    }
  };

  const onDeleteOfficer = async (officerId: number, badge: string) => {
    const confirmed = window.confirm(`Remove officer ${badge}?`);
    if (!confirmed) {
      return;
    }

    setDeletingOfficerId(officerId);
    setOfficerError(null);
    setOfficerNotice(null);
    try {
      await deleteDashboardOfficer(officerId);
      await reloadOfficers();
      if (editingOfficerId === officerId) {
        setEditingOfficerId(null);
        resetOfficerForm();
      }
      setOfficerNotice(`Officer ${badge} removed.`);
    } catch (actionError: unknown) {
      setOfficerError(actionError instanceof Error ? actionError.message : "Failed to remove officer.");
    } finally {
      setDeletingOfficerId(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Top KPI Cards - Ultra Compact */}
      <div className="border-b bg-white px-4 py-2">
        <div className="grid grid-cols-4 gap-2">
          {/* Coverage Efficiency */}
          <div className="rounded-lg border-2 border-yellow-400 bg-yellow-50 px-3 py-2">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-xs font-medium text-gray-600">COVERAGE EFFICIENCY</div>
              <Target className="h-3 w-3 text-yellow-600" />
            </div>
            <div className="flex items-center gap-2">
              <div className="relative h-10 w-10">
                {/* Animated Ring */}
                <svg className="h-10 w-10 -rotate-90 transform">
                  <circle
                    cx="20"
                    cy="20"
                    r="16"
                    stroke="#FEF3C7"
                    strokeWidth="3"
                    fill="none"
                  />
                  <circle
                    cx="20"
                    cy="20"
                    r="16"
                    stroke="#FBBF24"
                    strokeWidth="3"
                    fill="none"
                    strokeDasharray={`${coverageCircumference * (coverageEfficiency / 100)} ${coverageCircumference}`}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-xs font-bold">
                  {Math.round(coverageEfficiency)}%
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs text-green-600">
                <TrendingUp className="h-3 w-3" />
                <span>{coverageEfficiency >= 80 ? "Good" : "Watch"}</span>
              </div>
            </div>
          </div>

          {/* Avg Response Time */}
          <div className="rounded-lg border px-3 py-2">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-xs font-medium text-gray-600">AVG RESPONSE TIME</div>
              <Clock className="h-3 w-3 text-gray-600" />
            </div>
            <div className="flex items-center gap-2">
              <div className="text-xl font-bold">{avgResponseTimeMinutes}m</div>
              <div className={`flex items-center gap-1 text-xs ${responseDeltaMinutes >= 0 ? "text-green-600" : "text-red-600"}`}>
                <ArrowDown className="h-3 w-3" />
                <span>{responseDeltaMinutes >= 0 ? `-${responseDeltaMinutes}m` : `+${Math.abs(responseDeltaMinutes)}m`}</span>
              </div>
            </div>
            <div className="text-xs text-gray-500">Target: &lt;15m</div>
          </div>

          {/* Resource Utilization */}
          <div className="rounded-lg border px-3 py-2">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-xs font-medium text-gray-600">RESOURCE UTILIZATION</div>
              <TrendingUp className="h-3 w-3 text-gray-600" />
            </div>
            <div className="mb-1 text-xl font-bold">{Math.round(resourceUtilization)}%</div>
            <div className="h-1 overflow-hidden rounded-full bg-gray-200">
              <div className="h-full bg-yellow-400" style={{ width: `${resourceUtilization}%` }} />
            </div>
            <div className="mt-1 text-xs text-gray-500">Live utilization from deployment data</div>
          </div>

          {/* Weather Correlation */}
          <div className="rounded-lg border px-3 py-2">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-xs font-medium text-gray-600">WEATHER CORRELATION</div>
              <CloudRain className="h-3 w-3 text-gray-600" />
            </div>
            <div className="mb-1 text-xl font-bold">{weatherCorrelation.toFixed(2)}</div>
            {/* Simple sparkline */}
            <svg className="h-4 w-full" viewBox="0 0 100 20">
              <polyline
                fill="none"
                stroke="#FBBF24"
                strokeWidth="2"
                points={
                  weatherCorrelation >= 1.7
                    ? "0,16 20,14 40,12 60,9 80,6 100,3"
                    : weatherCorrelation >= 1.3
                      ? "0,15 20,12 40,10 60,8 80,6 100,5"
                      : "0,14 20,13 40,12 60,11 80,10 100,9"
                }
              />
            </svg>
            <div className="text-xs text-gray-500">{weatherImpactText}</div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Bottlenecks List */}
        <div className="w-80 border-r bg-white">
          <div className="border-b p-4">
            <div className="mb-4 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
              <h2 className="text-lg font-semibold">Bottlenecks</h2>
              <span className="ml-auto rounded-full bg-gray-100 px-3 py-1 text-sm">{filteredBottlenecks.length} UNITS</span>
            </div>
            <div className="mb-3 flex items-center gap-2">
              <button
                onClick={() => {
                  setIsAddMode((current) => !current);
                  setPendingPoint(null);
                  setBottleneckActionError(null);
                  setBottleneckActionNotice(null);
                }}
                className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium ${
                  isAddMode ? "bg-yellow-400 text-white" : "border text-gray-700 hover:bg-gray-50"
                }`}
              >
                <Plus className="h-3.5 w-3.5" />
                {isAddMode ? "Cancel Add Mode" : "Add from Map"}
              </button>
            </div>
            <input
              type="text"
              placeholder="Filter stations..."
              value={filterTerm}
              onChange={(event) => setFilterTerm(event.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
            {bottleneckActionError && <p className="mt-2 text-xs text-red-600">{bottleneckActionError}</p>}
            {bottleneckActionNotice && <p className="mt-2 text-xs text-green-700">{bottleneckActionNotice}</p>}
          </div>

          <div className="overflow-y-auto" style={{ height: "calc(100% - 120px)" }}>
            {filteredBottlenecks.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 border-b px-4 py-3 hover:bg-gray-50"
              >
                {item.status === "critical" && (
                  <div className="h-2 w-2 rounded-full bg-red-500"></div>
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{item.id}</span>
                    {item.badge && (
                      <span className="rounded bg-red-500 px-2 py-0.5 text-xs text-white">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <div className="font-medium">{item.name}</div>
                </div>
                <button
                  onClick={() => onDeleteBottleneck(item.id)}
                  disabled={deletingBottleneckId === item.id}
                  className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Remove bottleneck"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => startEditingBottleneck(item.id)}
                  className="rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-600"
                  title="Edit bottleneck"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <ChevronRight className="h-4 w-4 text-gray-400" />
              </div>
            ))}
          </div>
        </div>

        {/* Main Content - Map */}
        <div className="relative flex-1 bg-gray-100">
          {/* View Mode Tabs */}
          <div className="absolute left-4 top-4 z-20 flex gap-2 rounded-lg bg-white p-1 shadow-md">
            <button className="rounded px-3 py-1.5 text-sm text-gray-600">VIEW MODES</button>
            <button
              onClick={() => {
                setSelectedView("Congestion");
                setShowWeatherOverlay(false);
              }}
              className={`rounded px-3 py-1.5 text-sm ${
                selectedView === "Congestion"
                  ? "bg-yellow-400 font-medium text-white"
                  : "hover:bg-gray-100"
              }`}
            >
              Congestion
            </button>
            <button
              onClick={() => {
                setSelectedView("Weather");
                setShowWeatherOverlay(true);
              }}
              className={`rounded px-3 py-1.5 text-sm ${
                selectedView === "Weather" ? "bg-yellow-400 font-medium text-white" : "hover:bg-gray-100"
              }`}
            >
              Weather
            </button>
            <button
              onClick={() => {
                setSelectedView("Assignments");
                setShowWeatherOverlay(false);
              }}
              className={`rounded px-3 py-1.5 text-sm ${
                selectedView === "Assignments"
                  ? "bg-yellow-400 font-medium text-white"
                  : "hover:bg-gray-100"
              }`}
            >
              Assignments
            </button>
          </div>

          {/* Map Container */}
          <div className="relative h-full w-full overflow-hidden bg-gray-100">
            <div ref={mapContainerRef} className="h-full w-full" />

            {isAddMode && (
              <div className="absolute right-4 top-20 z-30 w-80 rounded-xl border bg-white p-4 shadow-xl">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Add Bottleneck</h3>
                  <button
                    onClick={() => {
                      setIsAddMode(false);
                      setPendingPoint(null);
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="mb-3 text-xs text-gray-600">Click on the map to place the bottleneck, then complete details.</p>
                <div className="mb-3 rounded bg-gray-50 p-2 text-xs text-gray-700">
                  {pendingPoint
                    ? `Point selected: ${pendingPoint.latitude}, ${pendingPoint.longitude}`
                    : "No point selected yet."}
                </div>
                <div className="space-y-2">
                  <input
                    value={newBottleneckName}
                    onChange={(event) => setNewBottleneckName(event.target.value)}
                    placeholder="Name *"
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                  <input
                    value={newBottleneckId}
                    onChange={(event) => setNewBottleneckId(event.target.value)}
                    placeholder="Code (optional, e.g. B-031)"
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                  <input
                    value={newBottleneckDistrict}
                    onChange={(event) => setNewBottleneckDistrict(event.target.value)}
                    placeholder="District"
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={newBottleneckType}
                      onChange={(event) => setNewBottleneckType(event.target.value)}
                      className="rounded border px-2 py-1.5 text-sm"
                    >
                      <option value="intersection">Intersection</option>
                      <option value="bridge">Bridge</option>
                      <option value="school_zone">School Zone</option>
                      <option value="market">Market</option>
                      <option value="terminal">Terminal</option>
                      <option value="other">Other</option>
                    </select>
                    <input
                      value={newBottleneckWeight}
                      onChange={(event) => setNewBottleneckWeight(event.target.value)}
                      placeholder="Priority Weight"
                      type="number"
                      min="0.1"
                      step="0.1"
                      className="rounded border px-2 py-1.5 text-sm"
                    />
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => {
                      setPendingPoint(null);
                      setIsAddMode(false);
                    }}
                    className="flex-1 rounded border px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={onCreateBottleneck}
                    disabled={savingBottleneck}
                    className="flex-1 rounded bg-yellow-400 px-3 py-1.5 text-sm font-medium text-white hover:bg-yellow-500 disabled:cursor-not-allowed disabled:bg-yellow-300"
                  >
                    {savingBottleneck ? "Saving..." : "Save Bottleneck"}
                  </button>
                </div>
              </div>
            )}

            {editingBottleneckId && (
              <div className="absolute right-4 top-20 z-30 w-80 rounded-xl border bg-white p-4 shadow-xl">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Edit Bottleneck {editingBottleneckId}</h3>
                  <button
                    onClick={() => {
                      setEditingBottleneckId(null);
                      setEditPickFromMap(false);
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="mb-3 text-xs text-gray-600">Update details, or pick coordinates directly from map.</p>
                <div className="mb-2 flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-xs text-gray-700">
                  <span>{editLatitude || "-"}, {editLongitude || "-"}</span>
                  <button
                    onClick={() => {
                      setEditPickFromMap((current) => !current);
                      setIsAddMode(false);
                    }}
                    className={`rounded px-2 py-1 font-medium ${editPickFromMap ? "bg-yellow-400 text-white" : "border text-gray-700"}`}
                  >
                    {editPickFromMap ? "Click map now" : "Pick from map"}
                  </button>
                </div>
                <div className="space-y-2">
                  <input
                    value={editBottleneckName}
                    onChange={(event) => setEditBottleneckName(event.target.value)}
                    placeholder="Name *"
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                  <input
                    value={editBottleneckDistrict}
                    onChange={(event) => setEditBottleneckDistrict(event.target.value)}
                    placeholder="District"
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={editBottleneckType}
                      onChange={(event) => setEditBottleneckType(event.target.value)}
                      className="rounded border px-2 py-1.5 text-sm"
                    >
                      <option value="intersection">Intersection</option>
                      <option value="bridge">Bridge</option>
                      <option value="school_zone">School Zone</option>
                      <option value="market">Market</option>
                      <option value="terminal">Terminal</option>
                      <option value="other">Other</option>
                    </select>
                    <input
                      value={editBottleneckWeight}
                      onChange={(event) => setEditBottleneckWeight(event.target.value)}
                      placeholder="Priority Weight"
                      type="number"
                      min="0.1"
                      step="0.1"
                      className="rounded border px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={editLatitude}
                      onChange={(event) => setEditLatitude(event.target.value)}
                      placeholder="Latitude"
                      type="number"
                      step="0.000001"
                      className="rounded border px-2 py-1.5 text-sm"
                    />
                    <input
                      value={editLongitude}
                      onChange={(event) => setEditLongitude(event.target.value)}
                      placeholder="Longitude"
                      type="number"
                      step="0.000001"
                      className="rounded border px-2 py-1.5 text-sm"
                    />
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => {
                      setEditingBottleneckId(null);
                      setEditPickFromMap(false);
                    }}
                    className="flex-1 rounded border px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={onSaveEditedBottleneck}
                    disabled={savingEditBottleneck}
                    className="flex-1 rounded bg-yellow-400 px-3 py-1.5 text-sm font-medium text-white hover:bg-yellow-500 disabled:cursor-not-allowed disabled:bg-yellow-300"
                  >
                    {savingEditBottleneck ? "Saving..." : "Update"}
                  </button>
                </div>
              </div>
            )}

            {/* Weather Overlay */}
            {showWeatherOverlay && (
              <div className={`pointer-events-none absolute inset-0 ${weatherStyle.blurClass} ${weatherStyle.overlayClass}`}>
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: weatherStyle.gradient,
                  }}
                />
                <div className={`absolute left-1/2 top-28 z-20 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-medium shadow-lg ${weatherStyle.bannerClass}`}>
                  <WeatherIndicatorIcon className={`mr-2 inline h-4 w-4 ${weatherStyle.iconClass}`} />
                  {weatherLabel} • {weatherStatusTone} impact • WIF {weatherSnapshot.weather_impact_factor.toFixed(2)}x
                </div>
              </div>
            )}

            {/* Map Controls */}
            <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-2">
              <button className="rounded-lg bg-white p-2 shadow-md hover:bg-gray-50">
                <Navigation className="h-5 w-5 text-gray-600" />
              </button>
              <button className="rounded-lg bg-white p-2 shadow-md hover:bg-gray-50">
                <Maximize2 className="h-5 w-5 text-gray-600" />
              </button>
              <div className="rounded-lg bg-white p-2 shadow-md">
                <div className="text-xs font-medium text-gray-700">+</div>
                <div className="my-1 h-px bg-gray-300"></div>
                <div className="text-xs font-medium text-gray-700">−</div>
              </div>
            </div>

            {/* Context Legend */}
            <div className="pointer-events-none absolute bottom-4 left-4 z-20 rounded-lg bg-white p-3 shadow-md">
              {selectedView === "Weather" ? (
                <>
                  <div className="mb-2 text-xs font-semibold text-gray-700">WEATHER LEGEND</div>
                  <div className="flex gap-3 text-xs">
                    <div className="flex items-center gap-1">
                      <div className="h-3 w-3 rounded-full bg-emerald-500"></div>
                      <span>Clear (WIF &lt; 1.30)</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="h-3 w-3 rounded-full bg-yellow-400"></div>
                      <span>Moderate (1.30-1.69)</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="h-3 w-3 rounded-full bg-rose-500"></div>
                      <span>Severe (≥ 1.70)</span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-2 text-xs font-semibold text-gray-700">CONGESTION LEGEND</div>
                  <div className="flex gap-3 text-xs">
                    <div className="flex items-center gap-1">
                      <div className="h-3 w-3 rounded-full bg-green-500"></div>
                      <span>&lt;40%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="h-3 w-3 rounded-full bg-yellow-400"></div>
                      <span>40-80%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="h-3 w-3 rounded-full bg-red-500"></div>
                      <span>&gt;80%</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="pointer-events-none absolute bottom-1 right-2 z-20 rounded bg-white/85 px-2 py-0.5 text-xs text-gray-700">
              Map data © TomTom, © OpenStreetMap contributors
            </div>

            {/* Location Label */}
              <div className="pointer-events-none absolute left-1/2 top-16 z-30 -translate-x-1/2 rounded-full bg-white/90 px-4 py-2 text-sm font-medium shadow-md backdrop-blur-sm">
              📍 {dashboardSnapshot.cityLabel}
            </div>
          </div>

          {/* Incident Modal */}
          {showIncidentModal && (
            <div className="absolute bottom-8 left-1/2 z-30 w-96 -translate-x-1/2 rounded-xl bg-white p-4 shadow-2xl">
              <button
                onClick={() => setShowIncidentModal(false)}
                className="absolute right-2 top-2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="mb-2 inline-block rounded bg-red-500 px-2 py-1 text-xs font-medium text-white">
                {selectedIncident ? selectedIncident.type.toUpperCase() : "NO ACTIVE INCIDENT"}
              </div>
              <h3 className="mb-1 text-xl font-bold">{incidentHeadline}</h3>
              <p className="mb-3 text-sm text-gray-600">
                <MapPin className="mr-1 inline h-3 w-3" />
                {incidentLocation}
              </p>

              <div className="relative mb-4 overflow-hidden rounded-lg">
                <img src={incidentImage} alt="Incident" className="h-48 w-full object-cover" />
                <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-xs text-white">
                  <Camera className="h-3 w-3" />
                  Live Feed
                </div>
              </div>

              <div className="mb-4 flex items-center gap-3">
                <img
                  src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=50&h=50&fit=crop"
                  alt="Officer"
                  className="h-10 w-10 rounded-full"
                />
                <div className="flex-1">
                  <div className="font-medium">Live dashboard feed</div>
                  <div className="text-xs text-gray-500">
                    {selectedIncident ? `Reported via ${selectedIncident.type} channel` : "Awaiting incident selection"}
                  </div>
                </div>
                <div className="text-sm text-gray-600">{selectedIncident ? `ID: ${selectedIncident.id}` : "ID: --"}</div>
              </div>

              <div className="flex gap-2">
                <button className="flex-1 rounded-lg border-2 border-red-500 py-2 text-sm font-medium text-red-500 hover:bg-red-50">
                  Clear Incident
                </button>
                <button className="flex-1 rounded-lg bg-yellow-400 py-2 text-sm font-medium text-white hover:bg-yellow-500">
                  Dispatch Support
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar - Quick Optimize & Incident Ticker */}
        <div className="w-96 space-y-4 overflow-y-auto bg-white p-4">
          {/* Incident Ticker */}
          <div className="rounded-lg border bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <h3 className="font-semibold">Active Incidents</h3>
              <span className="ml-auto rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                LIVE
              </span>
            </div>
            <div className="space-y-2">
              {incidents.map((incident) => (
                <div
                  key={incident.id}
                  className={`rounded-lg p-2 text-xs ${
                    incident.type === "critical"
                      ? "bg-red-50 text-red-900"
                      : incident.type === "major"
                      ? "bg-orange-50 text-orange-900"
                      : "bg-yellow-50 text-yellow-900"
                  }`}
                >
                  {incident.text}
                </div>
              ))}
            </div>
          </div>

          {/* Quick Optimize Card */}
          <div className="rounded-xl border-2 border-yellow-400 bg-yellow-50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <div className="rounded-lg bg-yellow-400 p-1.5">
                <Target className="h-4 w-4 text-white" />
              </div>
              <h3 className="font-semibold">Quick Optimize</h3>
            </div>

            {/* Shift Selector */}
            <div className="mb-4">
              <label className="mb-2 block text-xs font-medium text-gray-600">SELECT SHIFT</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedShift("Morning")}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                    selectedShift === "Morning"
                      ? "bg-yellow-400 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Morning
                  <div className="text-xs opacity-75">6AM-2PM</div>
                </button>
                <button
                  onClick={() => setSelectedShift("Afternoon")}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                    selectedShift === "Afternoon"
                      ? "bg-yellow-400 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Afternoon
                  <div className="text-xs opacity-75">2PM-10PM</div>
                </button>
              </div>
            </div>

            {/* Weather Mode */}
            <div className="mb-4">
              <label className="mb-2 block text-xs font-medium text-gray-600">WEATHER MODE</label>
              <div className="flex items-center gap-2 rounded-lg bg-white p-2">
                <WeatherIndicatorIcon className={`h-4 w-4 ${weatherStyle.iconClass}`} />
                <span className="flex-1 text-sm">Auto-detected</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${weatherStyle.chipClass}`}>
                  {weatherLabel}
                </span>
              </div>
            </div>

            {/* Optimization Info */}
            <div className="mb-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Impact Radius</span>
                <span className="font-medium">{impactRadiusKm} KM</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Estimated Clear Time</span>
                <span className="font-medium">{estimatedClearMinutes} MIN</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Network Health</span>
                <span className={`font-medium ${networkHealthClass}`}>{networkHealthLabel}</span>
              </div>
            </div>

            {/* Run Optimization Button */}
            <Link
              to="/optimization"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-yellow-400 py-3 font-semibold text-white shadow-md transition-all hover:bg-yellow-500 hover:shadow-lg"
            >
              ⚡ Run Optimization
            </Link>
            
            <p className="mt-3 text-center text-xs text-gray-600">
              {selectedIncident ? (
                <>
                  Incident detected at <strong>{selectedIncident.text.split(" - ")[1] ?? selectedIncident.text}</strong>. System recommends recalculating deployment.
                </>
              ) : (
                <>No active incident currently selected.</>
              )}
            </p>
          </div>

          {/* System Stats */}
          <div className="space-y-3">
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="mb-1 text-xs text-gray-600">OVERALL CITY FLOW</div>
              <div className="flex items-end gap-2">
                <div className="text-2xl font-bold">{cityFlowValue}%</div>
                <div className={`mb-1 flex items-center text-sm ${cityFlowDelta <= 0 ? "text-green-500" : "text-red-500"}`}>
                  <TrendingDown className="h-3 w-3" />
                  {Math.abs(cityFlowDelta)}%
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 p-3">
              <div className="mb-1 text-xs text-gray-600">AVG. DELAY TIME</div>
              <div className="flex items-end gap-2">
                <div className="text-2xl font-bold">{avgResponseTimeMinutes}m</div>
                <div className={`mb-1 flex items-center text-sm ${delayDeltaMinutes <= 0 ? "text-green-500" : "text-red-500"}`}>
                  <TrendingDown className="h-3 w-3" />
                  {Math.abs(delayDeltaMinutes)}m
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}