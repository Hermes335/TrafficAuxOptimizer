import { RememberedDetails } from "../components/RememberedDetails";
import { usePageState } from "../contexts/PageStateContext";
import { PublishScheduleButton } from "../components/PublishScheduleButton";
import { RecommendationExportButton } from "../components/RecommendationExportButton";
import { operationalDate, operationalTime, operationalShift } from "../services/operationalTime";
import { useEffect, useMemo, useState } from "react";
import { Clock, Target, Zap, TrendingUp, Users, RefreshCw, ChevronLeft, ChevronRight, ArrowUpRight } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  fetchOptimizationConfig,
  fetchOptimizationHistory,
  fetchDashboardSnapshot,
  fetchCurrentWeather,
  fetchPOIs,
  type OptimizationHistoryItem,
  type OptimizationConfigResponse,
  type POI,
} from "../services/backend";
import { computeAutoWeights, type AutoWeightSuggestion } from "../hooks/useOptimizationConfig";
import { ErrorFeedback } from "../components/ErrorFeedback";
import { useOptimizationReadiness } from "../hooks/useOptimizationReadiness";
import { OptimizationReadinessSummary } from "../components/OptimizationReadinessSummary";

const DEFAULT_PARAMS = {
  populationSize: 200,
  generationLimit: 300,
  crossoverRate: 80,
  mutationRate: 10,
  elitismCount: 10,
  tsiWeight: 35,
  wifWeight: 25,
  rpwWeight: 25,
  resourceUtilizationWeight: 15,
};

function compactRunId(runId: string) {
  return runId.length > 22 ? `${runId.slice(0, 12)}…${runId.slice(-6)}` : runId;
}

export function Optimization() {
  const location = useLocation();
  const requestedShift = new URLSearchParams(location.search).get("shift");
  const navigate = useNavigate();
  const [selectedShift, setSelectedShift] = usePageState<"morning" | "afternoon">("optimization.selectedShift", () => new URLSearchParams(window.location.search).get("shift") === "morning" ? "morning" : operationalShift());
  const [populationSize, setPopulationSize] = usePageState("optimization.populationSize", DEFAULT_PARAMS.populationSize);
  const [runDay, setRunDay] = usePageState("optimization.runDay", operationalDate());
  const [mode, setMode] = usePageState<"operational" | "shadow">("optimization.mode", "operational");
  const [sessionId, setSessionId] = usePageState("optimization.sessionId", "");
  const [generationLimit, setGenerationLimit] = usePageState("optimization.generationLimit", DEFAULT_PARAMS.generationLimit);
  const [crossoverRate, setCrossoverRate] = usePageState("optimization.crossoverRate", DEFAULT_PARAMS.crossoverRate);
  const [mutationRate, setMutationRate] = usePageState("optimization.mutationRate", DEFAULT_PARAMS.mutationRate);
  const [elitismCount, setElitismCount] = usePageState("optimization.elitismCount", DEFAULT_PARAMS.elitismCount);
  const [tsiWeight, setTsiWeight] = usePageState("optimization.tsiWeight", DEFAULT_PARAMS.tsiWeight);
  const [wifWeight, setWifWeight] = usePageState("optimization.wifWeight", DEFAULT_PARAMS.wifWeight);
  const [rpwWeight, setRpwWeight] = usePageState("optimization.rpwWeight", DEFAULT_PARAMS.rpwWeight);
  const [resourceUtilizationWeight, setResourceUtilizationWeight] = usePageState("optimization.resourceUtilizationWeight", DEFAULT_PARAMS.resourceUtilizationWeight);
  const [selectedPreset, setSelectedPreset] = usePageState<string | null>("optimization.selectedPreset", null);
  const [historyPage, setHistoryPage] = usePageState("optimization.historyPage", 1);
  const [historyCount, setHistoryCount] = useState(0);
  const [history, setHistory] = useState<OptimizationHistoryItem[]>([]);
  const [validation, setValidation] = useState<OptimizationConfigResponse | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [validationLoading, setValidationLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoSuggestion, setAutoSuggestion] = useState<AutoWeightSuggestion | null>(null);
  const [loadingAutoSuggestion, setLoadingAutoSuggestion] = useState(false);
  const [activePois, setActivePois] = useState<POI[]>([]);
  const [activeIncidents, setActiveIncidents] = useState<Array<{ type: string }>>([]);

  // Explicit links can select a shift while leaving the other saved settings intact.
  useEffect(() => {
    if (requestedShift === "morning" || requestedShift === "afternoon") setSelectedShift(requestedShift);
  }, [requestedShift, setSelectedShift]);

  // Fetch dashboard data, POIs, and compute auto-weight suggestion
  useEffect(() => {
    let active = true;
    setLoadingAutoSuggestion(true);
    Promise.all([fetchDashboardSnapshot(selectedShift), fetchCurrentWeather(), fetchPOIs()])
      .then(([snapshot, weather, pois]) => {
        if (!active) return;
        setActivePois(pois);
        setActiveIncidents(snapshot.incidents);
        if (weather.weather_impact_factor == null || snapshot.metrics.resourceUtilization == null) return;
        const suggestion = computeAutoWeights(
          snapshot.bottlenecks,
          weather.weather_impact_factor ?? 1,
          snapshot.incidents,
          snapshot.metrics.resourceUtilization,
        );
        setAutoSuggestion(suggestion);
      })
      .catch(() => {
        // Silently fail — auto-suggest is optional
      })
      .finally(() => {
        if (active) setLoadingAutoSuggestion(false);
      });
    return () => { active = false; };
  }, [selectedShift]);

  const applyAutoSuggestion = () => {
    if (!autoSuggestion) return;
    setTsiWeight(autoSuggestion.tsiWeight);
    setWifWeight(autoSuggestion.wifWeight);
    setRpwWeight(autoSuggestion.rpwWeight);
    setResourceUtilizationWeight(autoSuggestion.resourceUtilizationWeight);
    setSelectedPreset("custom");
  };

  const params = useMemo(
    () => ({
      shift: selectedShift, operational_date: runDay, mode, session_id: sessionId,
      population_size: populationSize,
      generations: generationLimit,
      mutation_rate: Number((mutationRate / 100).toFixed(2)),
      crossover_rate: Number((crossoverRate / 100).toFixed(2)),
      elitism_count: elitismCount,
      tsi_weight: Number((tsiWeight / 100).toFixed(2)),
      wif_weight: Number((wifWeight / 100).toFixed(2)),
      rpw_weight: Number((rpwWeight / 100).toFixed(2)),
      resource_utilization_weight: Number((resourceUtilizationWeight / 100).toFixed(2)),
    }),
    [
      selectedShift, runDay, mode, sessionId,
      populationSize,
      generationLimit,
      mutationRate,
      crossoverRate,
      elitismCount,
      tsiWeight,
      wifWeight,
      rpwWeight,
      resourceUtilizationWeight,
    ],
  );
  const readiness = useOptimizationReadiness(params);

  useEffect(() => {
    let active = true;

    setLoadingHistory(true);
    fetchOptimizationHistory(historyPage)
      .then((page) => {
        if (!active) {
          return;
        }
        setHistory(page.results); setHistoryCount(page.count);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) {
          return;
        }
        const message = err instanceof Error ? err.message : "Failed to load optimization history";
        setError(message);
      })
      .finally(() => {
        if (active) {
          setLoadingHistory(false);
        }
      });

    return () => {
      active = false;
    };
  }, [historyPage]);

  useEffect(() => {
    let active = true;
    setValidation(null);
    setValidationLoading(true);
    const timer = setTimeout(() => {
      fetchOptimizationConfig(params)
        .then((result) => {
          if (!active) return;
          setValidation(result);
        })
        .catch(() => {
          if (!active) return;
          setValidation({valid: false, parameters: params, errors: {validation: "Unable to validate parameters. Check the backend connection."}});
        })
        .finally(() => {
          if (active) setValidationLoading(false);
        });
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [params]);

  const applyPreset = (preset: string) => {
    setSelectedPreset(preset);
    switch (preset) {
      case "normal":
        setMutationRate(10); setCrossoverRate(80); setElitismCount(10);
        setPopulationSize(200); setGenerationLimit(300);
        setTsiWeight(35); setWifWeight(25); setRpwWeight(25); setResourceUtilizationWeight(15);
        break;
      case "typhoon":
        setMutationRate(8); setCrossoverRate(78); setElitismCount(12);
        setPopulationSize(240); setGenerationLimit(350);
        setTsiWeight(30); setWifWeight(50); setRpwWeight(15); setResourceUtilizationWeight(5);
        break;
      case "special_event":
        setMutationRate(12); setCrossoverRate(85); setElitismCount(15);
        setPopulationSize(180); setGenerationLimit(250);
        setTsiWeight(50); setWifWeight(15); setRpwWeight(25); setResourceUtilizationWeight(10);
        break;
      case "balanced":
        setMutationRate(10); setCrossoverRate(80); setElitismCount(10);
        setPopulationSize(200); setGenerationLimit(300);
        setTsiWeight(25); setWifWeight(25); setRpwWeight(25); setResourceUtilizationWeight(25);
        break;
    }
  };

  const recentCompleted = useMemo(() => history.filter((item) => item.status === "completed").slice(0, 5), [history]);
  const bestRun = useMemo(() => {
    const completed = history.filter((item) => item.status === "completed");
    return completed[0] ?? null;
  }, [history]);
  const currentValidation = !validationLoading && validation?.valid === true && Object.entries(params).every(([key, value]) => validation.parameters[key as keyof typeof params] === value);
  const validationErrors = validation?.errors ?? {};

  // Check if all weights are zero (edge case)
  const allWeightsZero = tsiWeight === 0 && wifWeight === 0 && rpwWeight === 0 && resourceUtilizationWeight === 0;
  const weightsValidation = allWeightsZero ? "At least one objective weight must be > 0" : null;
  const weightTotal = tsiWeight + wifWeight + rpwWeight + resourceUtilizationWeight;
  const weightsValid = weightTotal > 0;

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto text-slate-900 xl:flex-row xl:overflow-hidden">
      <div className="w-full min-w-0 shrink-0 border-b border-slate-200 bg-white p-4 sm:p-5 xl:w-80 xl:overflow-y-auto xl:border-r xl:border-b-0">
        <div className="mb-5">
          <h1 className="mb-1 text-xl font-semibold tracking-tight">Optimization</h1>
          <p className="text-sm leading-relaxed text-slate-600">
            Configure a run to recommend staffing for your next shift.
          </p>
        </div>

        <div className="mb-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <label className="grid gap-1 text-sm">Operational date (Asia/Manila)
            <input type="date" min={operationalDate()} value={runDay} onChange={e => setRunDay(e.target.value)} className="min-w-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
          </label>
          <label className="grid gap-1 text-sm">Recommendation mode
            <select value={mode} onChange={e => setMode(e.target.value as "operational" | "shadow")} className="min-w-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
              <option value="operational">Operational deployment</option><option value="shadow">Shadow field comparison</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">Field session {mode === "shadow" ? "(required)" : "(optional)"}
            <input value={sessionId} maxLength={80} onChange={e => setSessionId(e.target.value)} className="min-w-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
          </label>
          {mode === "shadow" && <p role="status" className="text-sm text-amber-800">Shadow mode records recommendations for comparison. Manual assignments remain authoritative; publication is disabled.</p>}
        </div>

        <div className="mb-5">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-600" />
            <h2 className="text-sm font-semibold">Shift period</h2>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 ${
                selectedShift === "morning" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => setSelectedShift("morning")}
              aria-pressed={selectedShift === "morning"}
            >
              Morning <span className="mt-0.5 block text-xs font-normal">6 AM – 2 PM</span>
            </button>
            <button
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 ${
                selectedShift === "afternoon" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => setSelectedShift("afternoon")}
              aria-pressed={selectedShift === "afternoon"}
            >
              Afternoon <span className="mt-0.5 block text-xs font-normal">2 PM – 10 PM</span>
            </button>
          </div>
        </div>

        <div className="mb-5">
          <div className="mb-3 flex items-center gap-2">
            <Target className="h-5 w-5 text-amber-600" />
            <h2 className="text-sm font-semibold">Parameter presets</h2>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 ${
                selectedPreset === "normal" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => applyPreset("normal")}
              aria-pressed={selectedPreset === "normal"}
            >
              Normal
            </button>
            <button
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 ${
                selectedPreset === "typhoon" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => applyPreset("typhoon")}
              aria-pressed={selectedPreset === "typhoon"}
            >
              Typhoon
            </button>
            <button
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 ${
                selectedPreset === "special_event" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => applyPreset("special_event")}
              aria-pressed={selectedPreset === "special_event"}
            >
              Special Event
            </button>
            <button
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 ${
                selectedPreset === "balanced" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => applyPreset("balanced")}
              aria-pressed={selectedPreset === "balanced"}
            >
              Balanced
            </button>
          </div>
        </div>

        <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-600" />
            <h2 className="text-sm font-semibold">Ready to run?</h2>
          </div>
          {validationLoading ? (
            <p className="text-sm text-slate-600">Validating parameters...</p>
          ) : weightsValidation ? (
            <ErrorFeedback error={weightsValidation} onDismiss={() => {}} />
          ) : currentValidation ? (
            <p className="text-sm font-medium text-green-700">Parameters validated.</p>
          ) : (
            <div className="space-y-2 text-sm text-red-600">
              <p>Current parameters need adjustment.</p>
              {Object.entries(validationErrors).map(([key, value]) => (
                <p key={key}>
                  <span className="font-medium">{key}:</span> {value}
                </p>
              ))}
            </div>
          )}
          <OptimizationReadinessSummary {...readiness} />
          <button
            disabled={!weightsValid || !currentValidation || readiness.loading || !readiness.readiness?.ready || !!readiness.readiness.blockers.length}
            onClick={() => navigate("/optimization-running?" + new URLSearchParams({shift: selectedShift, ...Object.fromEntries(Object.entries(params).map(([k,v]) => [k, String(v)]))}))}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            <Zap className="h-4 w-4" aria-hidden="true" />
            Run Optimization
          </button>
        </div>

        <RememberedDetails stateKey="optimization.advanced" className="mb-4 rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer font-semibold">Advanced settings</summary>
          <p className="my-3 text-sm text-slate-600">Adjust algorithm parameters and objective weights when needed. Current values are used even when this section is closed.</p>
        <div className="mb-5">
          <div className="mb-3 flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-600" />
            <h2 className="text-sm font-semibold">Algorithm parameters</h2>
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Population Size</label>
                <span className="text-amber-700">{populationSize}</span>
              </div>
              <div className="text-xs text-slate-600">Initial chromosome pool</div>
              <input
                type="range"
                min="50"
                max="500"
                aria-label="Population size"
                value={populationSize}
                onChange={(e) => setPopulationSize(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Generation Limit</label>
                <span className="text-amber-700">{generationLimit}</span>
              </div>
              <div className="text-xs text-slate-600">Maximum generations per staffing period</div>
              <input
                type="range"
                min="50"
                max="1000"
                aria-label="Generation limit"
                value={generationLimit}
                onChange={(e) => setGenerationLimit(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Crossover Rate</label>
                <span className="text-amber-700">{crossoverRate}%</span>
              </div>
              <div className="text-xs text-slate-600">Genetic recombination probability</div>
              <input
                type="range"
                min="50"
                max="95"
                aria-label="Crossover rate"
                value={crossoverRate}
                onChange={(e) => setCrossoverRate(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Mutation Rate</label>
                <span className="text-amber-700">{mutationRate}%</span>
              </div>
              <div className="text-xs text-slate-600">Random variation factor</div>
              <input
                type="range"
                min="1"
                max="30"
                aria-label="Mutation rate"
                value={mutationRate}
                onChange={(e) => setMutationRate(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Elitism Count</label>
                <span className="text-amber-700">{elitismCount} individuals</span>
              </div>
              <div className="text-xs text-slate-600">Best individuals preserved</div>
              <input
                type="range"
                min="1"
                max="20"
                aria-label="Elitism count"
                value={elitismCount}
                onChange={(e) => setElitismCount(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>
          </div>
        </div>

        <div className="mb-5">
          <div className="mb-3 flex items-center gap-2">
            <Target className="h-5 w-5 text-amber-600" />
            <h2 className="text-sm font-semibold">Objective weights</h2>
          </div>

          {/* Auto-Suggest Weights */}
          {autoSuggestion && (
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-blue-800">
                  <RefreshCw className="h-4 w-4" />
                  Auto-Suggested Weights
                </div>
                {loadingAutoSuggestion && <span className="text-xs text-blue-500">Refreshing...</span>}
              </div>

              {/* Active data summary */}
              <div className="mb-2 flex flex-wrap gap-3 text-xs">
                {activePois.length > 0 && (
                  <span className="flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-green-800">
                    📍 {activePois.length} POIs (hospitals, fire stations, schools)
                  </span>
                )}
                {activeIncidents.length > 0 && (
                  <span className="flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-red-800">
                    ⚠ {activeIncidents.length} active incident(s)
                  </span>
                )}
                {activePois.length === 0 && activeIncidents.length === 0 && (
                  <span className="text-slate-600">No active POIs or incidents affecting optimization</span>
                )}
              </div>

              <div className="mb-2 space-y-1 text-xs text-blue-700">
                {autoSuggestion.reasons.map((reason, i) => (
                  <div key={i}>• {reason}</div>
                ))}
              </div>
              <div className="mb-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-800">Coverage {autoSuggestion.tsiWeight}%</span>
                <span className="rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-800">Estimated travel {autoSuggestion.wifWeight}%</span>
                <span className="rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-800">Road priority {autoSuggestion.rpwWeight}%</span>
                <span className="rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-800">Staffing efficiency {autoSuggestion.resourceUtilizationWeight}%</span>
              </div>
              <button
                onClick={applyAutoSuggestion}
                className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-medium text-white hover:bg-blue-800"
              >
                Apply Suggestion
              </button>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Coverage</label>
                <span className="text-amber-700">{tsiWeight}%</span>
              </div>
              <div className="text-xs text-slate-600">Cover locations with staffing demand</div>
              <input
                type="range"
                min="0"
                max="100"
                aria-label="Coverage weight"
                value={tsiWeight}
                onChange={(e) => setTsiWeight(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Estimated travel</label>
                <span className="text-amber-700">{wifWeight}%</span>
              </div>
              <div className="text-xs text-slate-600">Prefer shorter estimated officer travel</div>
              <input
                type="range"
                min="0"
                max="100"
                aria-label="Estimated travel weight"
                value={wifWeight}
                onChange={(e) => setWifWeight(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Road priority</label>
                <span className="text-amber-700">{rpwWeight}%</span>
              </div>
              <div className="text-xs text-slate-600">Prioritize important roads and active incidents</div>
              <input
                type="range"
                min="0"
                max="100"
                aria-label="Road priority weight"
                value={rpwWeight}
                onChange={(e) => setRpwWeight(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Staffing efficiency</label>
                <span className="text-amber-700">{resourceUtilizationWeight}%</span>
              </div>
              <div className="text-xs text-slate-600">Meet staffing targets; keep surplus available</div>
              <input
                type="range"
                min="0"
                max="100"
                aria-label="Staffing efficiency weight"
                value={resourceUtilizationWeight}
                onChange={(e) => setResourceUtilizationWeight(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>

            <div className={`rounded-lg border px-3 py-2 text-xs ${weightsValid ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
              Total weight: <span className="font-semibold">{weightTotal}%</span>
              {weightsValid ? " • ready to run" : " • at least one weight must be above 0"}
            </div>
          </div>
        </div>

        </RememberedDetails>

        <div className="border-t border-slate-200 pt-3">
          <button
            className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setPopulationSize(DEFAULT_PARAMS.populationSize);
              setGenerationLimit(DEFAULT_PARAMS.generationLimit);
              setCrossoverRate(DEFAULT_PARAMS.crossoverRate);
              setMutationRate(DEFAULT_PARAMS.mutationRate);
              setElitismCount(DEFAULT_PARAMS.elitismCount);
              setTsiWeight(DEFAULT_PARAMS.tsiWeight);
              setWifWeight(DEFAULT_PARAMS.wifWeight);
              setRpwWeight(DEFAULT_PARAMS.rpwWeight);
              setResourceUtilizationWeight(DEFAULT_PARAMS.resourceUtilizationWeight);
              setSelectedPreset(null);
            }}
          >
            Reset Defaults
          </button>
        </div>
      </div>

      <div className="min-w-0 shrink-0 bg-slate-50 p-4 sm:p-6 xl:flex-1 xl:overflow-y-auto">
        <div className="mx-auto max-w-6xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="mb-1 text-lg font-semibold tracking-tight">Run overview</h2>
              <p className="text-sm text-slate-600">Review saved results and your current configuration.</p>
            </div>
            <span role="status" className={`rounded-full px-3 py-1 text-xs font-medium ${error ? "bg-red-100 text-red-800" : loadingHistory ? "bg-slate-200 text-slate-700" : "bg-green-100 text-green-800"}`}>
              History: {error ? "Unavailable" : loadingHistory ? "Loading" : "Connected"}
            </span>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-3 2xl:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-1 text-xs text-slate-600">Population size</div>
              <div className="mb-1 text-2xl font-bold">{populationSize}</div>
              <div className="text-xs text-slate-600">Configured chromosome pool</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-1 text-xs text-slate-600">Generation limit</div>
              <div className="mb-1 text-2xl font-bold">{generationLimit}</div>
              <div className="text-xs text-slate-600">Backend validation applied</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-1 text-xs text-slate-600">Completed on page</div>
              <div className="mb-1 text-2xl font-bold">{recentCompleted.length}</div>
              <div className="text-xs text-slate-600">Runs in history window</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-1 text-xs text-slate-600">Latest score on page</div>
              <div className="mb-1 text-2xl font-bold">
                {bestRun ? Number(Number(bestRun.result_data?.best_fitness ?? 0).toFixed(4)) : 0}
              </div>
              <div className="text-xs text-slate-600">Latest completed run</div>
            </div>
          </div>

          <section className="mb-5 min-w-0 rounded-xl border border-slate-200 bg-white" aria-labelledby="recent-runs-title">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <h3 id="recent-runs-title" className="flex items-center gap-2 text-sm font-semibold">
                <TrendingUp className="h-4 w-4 text-amber-600" aria-hidden="true" />
                Recent optimization runs
              </h3>
              <span className="text-xs text-slate-600">{historyCount} total · Times in Asia/Manila</span>
            </div>

            {loadingHistory && <p role="status" className="p-4 text-sm text-slate-600">Loading run history...</p>}
            {!loadingHistory && error && <p role="alert" className="p-4 text-sm text-red-700">{error}</p>}
            {!loadingHistory && !error && history.length === 0 && (
              <p className="p-4 text-sm text-slate-600">No optimization runs yet. Configure your first run to get started.</p>
            )}
            {!loadingHistory && !error && history.length > 0 && (
              <ol className="divide-y divide-slate-200" aria-label="Optimization run history">
                {history.slice(0, 10).map((run, runIndex) => {
                  const bestFitness = typeof run.result_data?.best_fitness === "number" ? run.result_data.best_fitness : null;
                  const generationCount = run.generations_completed ?? 0;
                  const prevFitness = runIndex < history.length - 1
                    ? (typeof history[runIndex + 1].result_data.best_fitness === "number" ? history[runIndex + 1].result_data.best_fitness as number : null)
                    : null;
                  const trend = bestFitness !== null && prevFitness !== null ? bestFitness - prevFitness : null;
                  return (
                    <li key={run.id} className="min-w-0 space-y-3 px-4 py-4 transition-colors hover:bg-slate-50/70">
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
                        <Link
                          to={`/optimization-engine?run_id=${encodeURIComponent(run.run_id)}`}
                          title={run.run_id}
                          aria-label={`View run ${run.run_id}`}
                          className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded text-sm font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4 hover:decoration-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                        >
                          <span className="truncate font-mono">{compactRunId(run.run_id)}</span>
                          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                        </Link>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
                          run.status === "completed" ? "bg-green-100 text-green-800" :
                          run.status === "failed" ? "bg-red-100 text-red-800" :
                          run.status === "cancelled" ? "bg-slate-100 text-slate-700" :
                          run.status === "running" ? "bg-blue-100 text-blue-800" :
                          "bg-amber-100 text-amber-900"
                        }`}>
                          {run.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-3">
                        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                          <div>
                            <dt className="mb-1 text-xs text-slate-600">Started</dt>
                            <dd className="text-slate-800">
                              <time dateTime={run.timestamp}>{operationalDate(new Date(run.timestamp))} <span className="text-slate-600">{operationalTime(run.timestamp)}</span></time>
                            </dd>
                          </div>
                          <div>
                            <dt className="mb-1 text-xs text-slate-600">Fitness</dt>
                            <dd className="flex items-center gap-1.5 font-medium tabular-nums text-slate-800">
                              {bestFitness !== null ? bestFitness.toFixed(4) : "—"}
                              {trend !== null && trend !== 0 && (
                                <span title="Change from the previous run on this page" className={`text-xs font-normal ${trend > 0 ? "text-green-700" : "text-red-700"}`}>
                                  {trend > 0 ? "↑" : "↓"}{Math.abs(trend).toFixed(2)}
                                </span>
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt className="mb-1 text-xs text-slate-600">Generations</dt>
                            <dd className="font-medium tabular-nums text-slate-800">{generationCount}</dd>
                          </div>
                        </dl>
                        {run.status === "completed" && (
                          <div role="group" aria-label={`Actions for ${run.run_id}`} className="flex max-w-full flex-wrap items-start gap-2">
                            <PublishScheduleButton compact runId={run.run_id} date={String(run.parameters.operational_date ?? operationalDate())}
                              mode={String(run.parameters.mode ?? "operational")}
                              syntheticSources={Array.isArray(run.result_data.synthetic_data_used) ? run.result_data.synthetic_data_used : null} />
                            <RecommendationExportButton compact runId={run.run_id} />
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            <nav aria-label="Run history pages" className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-3 text-sm">
              <button disabled={historyPage === 1 || loadingHistory} onClick={() => setHistoryPage(p => p - 1)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Newer
              </button>
              <span className="text-xs tabular-nums text-slate-600">Page {historyPage} of {Math.max(1, Math.ceil(historyCount / 10))}</span>
              <button disabled={historyPage * 10 >= historyCount || loadingHistory} onClick={() => setHistoryPage(p => p + 1)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                Older <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </nav>
          </section>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Users className="h-4 w-4 text-amber-600" />
              Configuration Summary
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-slate-600">Population Size</span><span className="font-medium">{params.population_size}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Generations</span><span className="font-medium">{params.generations}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Crossover Rate</span><span className="font-medium">{crossoverRate}%</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Mutation Rate</span><span className="font-medium">{mutationRate}%</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Elitism</span><span className="font-medium">{elitismCount} individuals</span></div>
              <div className="border-t pt-2 mt-2">
                <div className="mb-1 text-slate-600 font-semibold">Objective Weights</div>
                <div className="flex justify-between gap-3"><span className="text-slate-600">Coverage</span><span className="font-medium">{tsiWeight}%</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-600">Estimated travel</span><span className="font-medium">{wifWeight}%</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-600">Road priority</span><span className="font-medium">{rpwWeight}%</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-600">Staffing efficiency</span><span className="font-medium">{resourceUtilizationWeight}%</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
