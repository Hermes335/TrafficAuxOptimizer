import { ChevronLeft, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import {
  fetchBottlenecks,
  fetchIncident,
  fetchIncidentMeta,
  reportIncident,
  updateIncident,
  type BottleneckOption,
  type IncidentMetaOption,
} from "../services/backend";

const incidentTypeIcons: Record<string, string> = {
  collision: "⚠️",
  road_closure: "🚫",
  construction: "🚧",
  flooding: "🌧️",
  other: "📍",
};

export function IncidentReport() {
  const { id: editId } = useParams<{ id?: string }>();
  const isEditing = !!editId;

  const [incidentType, setIncidentType] = useState("collision");
  const [severity, setSeverity] = useState("major");
  const [description, setDescription] = useState("");
  const [bottlenecks, setBottlenecks] = useState<BottleneckOption[]>([]);
  const [incidentTypes, setIncidentTypes] = useState<IncidentMetaOption[]>([]);
  const [severities, setSeverities] = useState<IncidentMetaOption[]>([]);
  const [selectedBottleneck, setSelectedBottleneck] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setLoaded(false); setError(null); setStatusMessage(null);
    Promise.all([fetchBottlenecks(), fetchIncidentMeta(), editId ? fetchIncident(Number(editId)) : Promise.resolve(null)])
      .then(([rows, meta, incident]) => {
        if (!active) {
          return;
        }
        setBottlenecks(rows);
        setIncidentTypes(meta.incident_types);
        setSeverities(meta.severities);
        if (incident) {
          setIncidentType(incident.incident_type);
          setSeverity(incident.severity);
          setDescription(incident.description);
          setSelectedBottleneck(incident.bottleneck ?? "");
        } else {
          setSelectedBottleneck(rows[0]?.id ?? "");
          setIncidentType(meta.incident_types[0]?.value ?? "collision");
          setSeverity(meta.severities.find(item => item.value === "major")?.value ?? meta.severities[0]?.value ?? "major");
          setDescription("");
        }
        setLoaded(true);
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return;
        }
        const message = loadError instanceof Error ? loadError.message : "Failed to load incident form";
        setError(message);
      }).finally(() => { if (active) setLoading(false); });

    return () => {
      active = false;
    };
  }, [editId, loadAttempt]);

  const onSubmit = async () => {
    if (!loaded || loading || saving) return;
    if (!description.trim()) {
      setError("Please enter a description.");
      return;
    }
    if (!isEditing && !selectedBottleneck) {
      setError("Please choose a location.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (isEditing) {
        await updateIncident(Number(editId), {
          incident_type: incidentType,
          severity,
          description: description.trim(),
          ...(selectedBottleneck ? {bottleneck: selectedBottleneck} : {}),
        });
        setStatusMessage("Incident updated successfully.");
      } else {
        await reportIncident({
          bottleneck: selectedBottleneck,
          incident_type: incidentType,
          severity,
          description: description.trim(),
        });
        setStatusMessage("Incident submitted successfully.");
        setDescription("");
      }
    } catch (submitError: unknown) {
      const message = submitError instanceof Error ? submitError.message : "Failed to save incident";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="rounded-lg p-2 hover:bg-gray-100">
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="text-xs text-gray-500">FIELD OPERATIONS</div>
              <h1 className="text-xl font-bold">{isEditing ? "Edit Incident" : "Report Incident"}</h1>
            </div>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-400">
            <span className="text-lg font-bold text-white">⚡</span>
          </div>
        </div>

        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="incident-location" className="text-sm font-medium text-gray-700">INCIDENT LOCATION</label>
            <span className="rounded bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-700">Backend Live</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border p-3">
            <MapPin className="h-5 w-5 text-yellow-500" />
            <select
              id="incident-location" disabled={loading || !loaded || saving}
              className="w-full outline-none"
              value={selectedBottleneck}
              onChange={(event) => setSelectedBottleneck(event.target.value)}
            >
              {!selectedBottleneck && <option value="">{isEditing ? "Original map location" : "Choose a location"}</option>}
              {bottlenecks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id} - {item.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-6">
          <label className="mb-3 block text-sm font-medium text-gray-700">TYPE OF INCIDENT</label>
          <div className="grid grid-cols-2 gap-3">
            {incidentTypes.map((type) => (
              <button
                key={type.value}
                onClick={() => setIncidentType(type.value)}
                aria-pressed={incidentType === type.value} disabled={loading || !loaded || saving}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                  incidentType === type.value ? "border-red-500 bg-red-50" : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <span className="text-2xl">{incidentTypeIcons[type.value] ?? "📍"}</span>
                <span className={`text-sm font-medium ${incidentType === type.value ? "text-red-700" : ""}`}>
                  {type.label}
                </span>
              </button>
            ))}
            {incidentTypes.length === 0 && (
              <p className="col-span-2 text-sm text-gray-500">No incident types available.</p>
            )}
          </div>
        </div>

        <div className="mb-6">
          <label className="mb-3 block text-sm font-medium text-gray-700">PRIORITY LEVEL</label>
          <div className="flex gap-2">
            {severities.map((level) => (
              <button
                key={level.value}
                onClick={() => setSeverity(level.value)}
                aria-pressed={severity === level.value} disabled={loading || !loaded || saving}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                  severity === level.value ? "bg-yellow-400 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {level.label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <label htmlFor="incident-description" className="mb-2 block text-sm font-medium text-gray-700">DESCRIPTION & NOTES</label>
          <textarea
            id="incident-description" disabled={loading || !loaded || saving}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe the incident details..."
            className="w-full rounded-lg border p-3 text-sm outline-none focus:border-yellow-400"
            rows={4}
          />
        </div>

        <p className="mb-4 text-xs text-gray-500">This form saves text reports. Photo upload is unavailable here.</p>
        {loading && <p role="status">Loading incident details…</p>}
        {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
        {!loading && !loaded && <button onClick={() => setLoadAttempt(n => n + 1)} className="mb-4 underline">Retry loading</button>}
        {statusMessage && <p role="status" className="mb-4 text-sm text-green-600">{statusMessage}</p>}

        <div className="flex gap-3">
          <Link
            to="/"
            className="flex w-1/3 items-center justify-center rounded-xl border py-4 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            onClick={onSubmit}
            disabled={saving || loading || !loaded}
            className="w-2/3 rounded-xl bg-yellow-400 py-4 text-lg font-bold text-white hover:bg-yellow-500 disabled:cursor-not-allowed disabled:bg-yellow-300"
          >
            {saving ? "SAVING..." : isEditing ? "UPDATE REPORT" : "SUBMIT REPORT"}
          </button>
        </div>
      </div>
    </div>
  );
}
