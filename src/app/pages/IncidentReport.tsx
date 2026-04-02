import { ChevronLeft, MapPin, Camera } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { fetchBottlenecks, reportIncident, type BottleneckOption } from "../services/backend";

const incidentTypeOptions = [
  { name: "collision", label: "Collision", icon: "⚠️" },
  { name: "road_closure", label: "Road Closure", icon: "🚫" },
  { name: "construction", label: "Construction", icon: "🚧" },
  { name: "flooding", label: "Flooding", icon: "🌧️" },
];

const severityOptions = ["critical", "major", "minor"];

export function IncidentReport() {
  const [incidentType, setIncidentType] = useState("collision");
  const [severity, setSeverity] = useState("major");
  const [description, setDescription] = useState("");
  const [bottlenecks, setBottlenecks] = useState<BottleneckOption[]>([]);
  const [selectedBottleneck, setSelectedBottleneck] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchBottlenecks()
      .then((rows) => {
        if (!active) {
          return;
        }
        setBottlenecks(rows);
        if (rows.length > 0) {
          setSelectedBottleneck(rows[0].id);
        }
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return;
        }
        const message = loadError instanceof Error ? loadError.message : "Failed to load bottlenecks";
        setError(message);
      });

    return () => {
      active = false;
    };
  }, []);

  const onSubmit = async () => {
    if (!selectedBottleneck || !description.trim()) {
      setError("Please choose a location and enter a description.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await reportIncident({
        bottleneck: selectedBottleneck,
        incident_type: incidentType,
        severity,
        description: description.trim(),
      });
      setStatusMessage("Incident submitted successfully.");
      setDescription("");
    } catch (submitError: unknown) {
      const message = submitError instanceof Error ? submitError.message : "Failed to submit incident";
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
              <h1 className="text-xl font-bold">Report Incident</h1>
            </div>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-400">
            <span className="text-lg font-bold text-white">⚡</span>
          </div>
        </div>

        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">INCIDENT LOCATION</label>
            <span className="rounded bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-700">Backend Live</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border p-3">
            <MapPin className="h-5 w-5 text-yellow-500" />
            <select
              className="w-full outline-none"
              value={selectedBottleneck}
              onChange={(event) => setSelectedBottleneck(event.target.value)}
            >
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
            {incidentTypeOptions.map((type) => (
              <button
                key={type.name}
                onClick={() => setIncidentType(type.name)}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                  incidentType === type.name ? "border-red-500 bg-red-50" : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <span className="text-2xl">{type.icon}</span>
                <span className={`text-sm font-medium ${incidentType === type.name ? "text-red-700" : ""}`}>
                  {type.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <label className="mb-3 block text-sm font-medium text-gray-700">PRIORITY LEVEL</label>
          <div className="flex gap-2">
            {severityOptions.map((level) => (
              <button
                key={level}
                onClick={() => setSeverity(level)}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                  severity === level ? "bg-yellow-400 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {level.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-gray-700">DESCRIPTION & NOTES</label>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe the incident details..."
            className="w-full rounded-lg border p-3 text-sm outline-none focus:border-yellow-400"
            rows={4}
          />
        </div>

        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-gray-700">VISUAL EVIDENCE</label>
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-yellow-300 bg-yellow-50 p-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-yellow-200">
              <Camera className="h-8 w-8 text-yellow-600" />
            </div>
            <div className="text-center">
              <div className="font-medium">Photo upload is optional in desktop mode</div>
              <div className="text-sm text-gray-500">You can still submit text reports now.</div>
            </div>
          </div>
        </div>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {statusMessage && <p className="mb-4 text-sm text-green-600">{statusMessage}</p>}

        <button
          onClick={onSubmit}
          disabled={saving}
          className="w-full rounded-xl bg-yellow-400 py-4 text-lg font-bold text-white hover:bg-yellow-500 disabled:cursor-not-allowed disabled:bg-yellow-300"
        >
          {saving ? "SUBMITTING..." : "SUBMIT REPORT"}
        </button>
      </div>
    </div>
  );
}
