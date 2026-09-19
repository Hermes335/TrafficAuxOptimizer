import { useEffect, useMemo, useState } from "react";
import { Clock, Target, Zap, TrendingUp, Users, AlertTriangle, ChevronLeft, RefreshCw } from "lucide-react";
import { Link, useNavigate } from "react-router";
import {
  fetchOptimizationConfig,
  fetchOptimizationHistory,
  fetchDashboardSnapshot,
  fetchCurrentWeather,
  fetchPOIs,
  publishDeploymentsFromOptimization,
  type OptimizationHistoryItem,
  type OptimizationConfigResponse,
  type POI,
} from "../services/backend";
import { computeAutoWeights, type AutoWeightSuggestion } from "../hooks/useOptimizationConfig";
import { ErrorFeedback } from "../components/ErrorFeedback";

const DEFAULT_PARAMS = {
  populationSize: 200,
  generationLimit: 300,
  crossoverRate: 80,
  mutationRate: 10,
  elitismRate: 10,
  tsiWeight: 35,
  wifWeight: 25,
  rpwWeight: 25,
  resourceUtilizationWeight: 15,
};

export function Optimization() {
  const navigate = useNavigate();
  const [selectedShift, setSelectedShift] = useState<"morning" | "afternoon">("afternoon");
  const [populationSize, setPopulationSize] = useState(DEFAULT_PARAMS.populationSize);
  const [generationLimit, setGenerationLimit] = useState(DEFAULT_PARAMS.generationLimit);
  const [crossoverRate, setCrossoverRate] = useState(DEFAULT_PARAMS.crossoverRate);
  const [mutationRate, setMutationRate] = useState(DEFAULT_PARAMS.mutationRate);
  const [elitismRate, setElitismRate] = useState(DEFAULT_PARAMS.elitismRate);
  const [tsiWeight, setTsiWeight] = useState(DEFAULT_PARAMS.tsiWeight);
  const [wifWeight, setWifWeight] = useState(DEFAULT_PARAMS.wifWeight);
  const [rpwWeight, setRpwWeight] = useState(DEFAULT_PARAMS.rpwWeight);
  const [resourceUtilizationWeight, setResourceUtilizationWeight] = useState(DEFAULT_PARAMS.resourceUtilizationWeight);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [history, setHistory] = useState<OptimizationHistoryItem[]>([]);
  const [validation, setValidation] = useState<OptimizationConfigResponse | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [validationLoading, setValidationLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishingRunId, setPublishingRunId] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const [autoSuggestion, setAutoSuggestion] = useState<AutoWeightSuggestion | null>(null);
  const [loadingAutoSuggestion, setLoadingAutoSuggestion] = useState(false);
  const [activePois, setActivePois] = useState<POI[]>([]);
  const [activeIncidents, setActiveIncidents] = useState<Array<{ type: string }>>([]);

  // Fetch dashboard data, POIs, and compute auto-weight suggestion
  useEffect(() => {
    let active = true;
    setLoadingAutoSuggestion(true);
    Promise.all([fetchDashboardSnapshot(), fetchCurrentWeather(), fetchPOIs()])
      .then(([snapshot, weather, pois]) => {
        if (!active) return;
        setActivePois(pois);
        setActiveIncidents(snapshot.incidents);
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
  }, []);

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
      population_size: populationSize,
      generations: generationLimit,
      mutation_rate: Number((mutationRate / 100).toFixed(2)),
      crossover_rate: Number((crossoverRate / 100).toFixed(2)),
      elitism_count: Math.max(1, Math.round((elitismRate / 100) * populationSize)),
      tsi_weight: Number((tsiWeight / 100).toFixed(2)),
      wif_weight: Number((wifWeight / 100).toFixed(2)),
      rpw_weight: Number((rpwWeight / 100).toFixed(2)),
      resource_utilization_weight: Number((resourceUtilizationWeight / 100).toFixed(2)),
    }),
    [
      populationSize,
      generationLimit,
      mutationRate,
      crossoverRate,
      elitismRate,
      tsiWeight,
      wifWeight,
      rpwWeight,
      resourceUtilizationWeight,
    ],
  );

  useEffect(() => {
    let active = true;

    fetchOptimizationHistory()
      .then((rows) => {
        if (!active) {
          return;
        }
        setHistory(rows);
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
  }, []);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setValidationLoading(true);
      fetchOptimizationConfig(params)
        .then((result) => {
          if (!active) return;
          setValidation(result);
        })
        .catch(() => {
          if (!active) return;
          setValidation(null);
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
        setMutationRate(10); setCrossoverRate(80); setElitismRate(10);
        setPopulationSize(200); setGenerationLimit(300);
        setTsiWeight(35); setWifWeight(25); setRpwWeight(25); setResourceUtilizationWeight(15);
        break;
      case "typhoon":
        setMutationRate(8); setCrossoverRate(78); setElitismRate(12);
        setPopulationSize(240); setGenerationLimit(350);
        setTsiWeight(30); setWifWeight(50); setRpwWeight(15); setResourceUtilizationWeight(5);
        break;
      case "special_event":
        setMutationRate(12); setCrossoverRate(85); setElitismRate(15);
        setPopulationSize(180); setGenerationLimit(250);
        setTsiWeight(50); setWifWeight(15); setRpwWeight(25); setResourceUtilizationWeight(10);
        break;
      case "balanced":
        setMutationRate(10); setCrossoverRate(80); setElitismRate(10);
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
  const currentValidation = validation?.valid ?? false;
  const validationErrors = validation?.errors ?? {};

  // Check if all weights are zero (edge case)
  const allWeightsZero = tsiWeight === 0 && wifWeight === 0 && rpwWeight === 0 && resourceUtilizationWeight === 0;
  const weightsValidation = allWeightsZero ? "At least one objective weight must be > 0" : null;
  const weightTotal = tsiWeight + wifWeight + rpwWeight + resourceUtilizationWeight;
  const weightsValid = weightTotal > 0;

  const onPublishCompletedRun = async (runId: string) => {
    setPublishError(null);
    setPublishNotice(null);
    setPublishingRunId(runId);
    try {
      const result = await publishDeploymentsFromOptimization({
        run_id: runId,
        replace_existing: true,
      });
      setPublishNotice(`Published ${result.created} deployments from ${runId}.`);
      if (result.skipped.length > 0) {
        setPublishError(`${result.skipped.length} assignments were skipped due to missing officer or bottleneck.`);
      }
    } catch (publishActionError: unknown) {
      const message =
        publishActionError instanceof Error
          ? publishActionError.message
          : "Failed to publish completed optimization run";
      setPublishError(message);
    } finally {
      setPublishingRunId(null);
    }
  };

  return (
    <div className="flex h-full">
      <div className="w-96 overflow-y-auto border-r bg-white p-6">
        <div className="mb-6">
          <h1 className="mb-2 text-2xl font-bold">Optimization Interface</h1>
          <p className="text-sm text-gray-600">
            Configure genetic algorithm parameters and launch a live optimization run.
          </p>
        </div>

        <div className="mb-6 rounded-xl border bg-gray-50 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            <h2 className="font-semibold">CURRENT VALIDATION</h2>
          </div>
          {validationLoading ? (
            <p className="text-sm text-gray-500">Validating parameters...</p>
          ) : weightsValidation ? (
            <ErrorFeedback error={weightsValidation} onDismiss={() => {}} />
          ) : currentValidation ? (
            <p className="text-sm font-medium text-green-700">Parameters are valid for backend execution.</p>
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
        </div>

        <div className="mb-6">
          <div className="mb-4 flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            <h2 className="font-semibold">ALGORITHM SPECS</h2>
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Population Size</label>
                <span className="text-yellow-500">{populationSize}</span>
              </div>
              <div className="text-xs text-gray-500">INITIAL CHROMOSOME POOL</div>
              <input
                type="range"
                min="50"
                max="500"
                value={populationSize}
                onChange={(e) => setPopulationSize(Number(e.target.value))}
                className="w-full accent-yellow-400"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Generation Limit</label>
                <span className="text-yellow-500">{generationLimit}</span>
              </div>
              <div className="text-xs text-gray-500">MAX ITERATIONS BEFORE STOP</div>
              <input
                type="range"
                min="50"
                max="1000"
                value={generationLimit}
                onChange={(e) => setGenerationLimit(Number(e.target.value))}
                className="w-full accent-yellow-400"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Crossover Rate</label>
                <span className="text-yellow-500">{crossoverRate}%</span>
              </div>
              <div className="text-xs text-gray-500">GENETIC RECOMBINATION PROBABILITY</div>
              <input
                type="range"
                min="50"
                max="95"
                value={crossoverRate}
                onChange={(e) => setCrossoverRate(Number(e.target.value))}
                className="w-full accent-yellow-400"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Mutation Rate</label>
                <span className="text-yellow-500">{mutationRate}%</span>
              </div>
              <div className="text-xs text-gray-500">RANDOM VARIATION FACTOR</div>
              <input
                type="range"
                min="1"
                max="30"
                value={mutationRate}
                onChange={(e) => setMutationRate(Number(e.target.value))}
                className="w-full accent-yellow-400"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Elitism Rate</label>
                <span className="text-yellow-500">{elitismRate}%</span>
              </div>
              <div className="text-xs text-gray-500">BEST INDIVIDUALS PRESERVED</div>
              <input
                type="range"
                min="0"
                max="20"
                value={elitismRate}
                onChange={(e) => setElitismRate(Number(e.target.value))}
                className="w-full accent-yellow-400"
              />
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div className="mb-4 flex items-center gap-2">
            <Target className="h-5 w-5 text-yellow-500" />
            <h2 className="font-semibold">FITNESS WEIGHTS</h2>
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
                  <span className="text-gray-500">No active POIs or incidents affecting optimization</span>
                )}
              </div>

              <div className="mb-2 space-y-1 text-xs text-blue-700">
                {autoSuggestion.reasons.map((reason, i) => (
                  <div key={i}>• {reason}</div>
                ))}
              </div>
              <div className="mb-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-800">TSI {autoSuggestion.tsiWeight}%</span>
                <span className="rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-800">WIF {autoSuggestion.wifWeight}%</span>
                <span className="rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-800">RPW {autoSuggestion.rpwWeight}%</span>
                <span className="rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-800">RU {autoSuggestion.resourceUtilizationWeight}%</span>
              </div>
              <button
                onClick={applyAutoSuggestion}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                Apply Suggestion
              </button>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Traffic Severity Index (TSI)</label>
                <span className="text-yellow-500">{tsiWeight}%</span>
              </div>
              <div className="text-xs text-gray-500">CONGESTION, SPEED, QUEUE LENGTH</div>
              <input
                type="range"
                min="0"
                max="100"
                value={tsiWeight}
                onChange={(e) => setTsiWeight(Number(e.target.value))}
                className="w-full accent-yellow-400"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Weather Impact Factor (WIF)</label>
                <span className="text-yellow-500">{wifWeight}%</span>
              </div>
              <div className="text-xs text-gray-500">RAINFALL CAPACITY REDUCTION</div>
              <input
                type="range"
                min="0"
                max="100"
                value={wifWeight}
                onChange={(e) => setWifWeight(Number(e.target.value))}
                className="w-full accent-yellow-400"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Road Priority Weight (RPW)</label>
                <span className="text-yellow-500">{rpwWeight}%</span>
              </div>
              <div className="text-xs text-gray-500">VOLUME, ECONOMIC IMPORTANCE, INFRASTRUCTURE</div>
              <input
                type="range"
                min="0"
                max="100"
                value={rpwWeight}
                onChange={(e) => setRpwWeight(Number(e.target.value))}
                className="w-full accent-yellow-400"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Resource Utilization</label>
                <span className="text-yellow-500">{resourceUtilizationWeight}%</span>
              </div>
              <div className="text-xs text-gray-500">OFFICER-HOUR EFFICIENCY</div>
              <input
                type="range"
                min="0"
                max="100"
                value={resourceUtilizationWeight}
                onChange={(e) => setResourceUtilizationWeight(Number(e.target.value))}
                className="w-full accent-yellow-400"
              />
            </div>

            <div className={`rounded-lg border px-3 py-2 text-xs ${weightsValid ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
              Total weight: <span className="font-semibold">{weightTotal}%</span>
              {weightsValid ? " • ready to run" : " • at least one weight must be above 0"}
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div className="mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-yellow-500" />
            <h2 className="font-semibold">SHIFT PERIOD</h2>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                selectedShift === "morning" ? "border-yellow-400 bg-yellow-400 text-white" : "hover:bg-gray-50"
              }`}
              onClick={() => setSelectedShift("morning")}
            >
              Morning (6AM - 2PM)
            </button>
            <button
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                selectedShift === "afternoon" ? "border-yellow-400 bg-yellow-400 text-white" : "hover:bg-gray-50"
              }`}
              onClick={() => setSelectedShift("afternoon")}
            >
              Afternoon (2PM - 10PM)
            </button>
          </div>
        </div>

        <div className="mb-6">
          <div className="mb-4 flex items-center gap-2">
            <Target className="h-5 w-5 text-yellow-500" />
            <h2 className="font-semibold">PARAMETER PRESETS</h2>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                selectedPreset === "normal" ? "border-yellow-400 bg-yellow-400 text-white" : "hover:bg-gray-50"
              }`}
              onClick={() => applyPreset("normal")}
            >
              Normal
            </button>
            <button
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                selectedPreset === "typhoon" ? "border-yellow-400 bg-yellow-400 text-white" : "hover:bg-gray-50"
              }`}
              onClick={() => applyPreset("typhoon")}
            >
              Typhoon
            </button>
            <button
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                selectedPreset === "special_event" ? "border-yellow-400 bg-yellow-400 text-white" : "hover:bg-gray-50"
              }`}
              onClick={() => applyPreset("special_event")}
            >
              Special Event
            </button>
            <button
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                selectedPreset === "balanced" ? "border-yellow-400 bg-yellow-400 text-white" : "hover:bg-gray-50"
              }`}
              onClick={() => applyPreset("balanced")}
            >
              Balanced
            </button>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            className="flex-1 rounded-lg border px-4 py-2.5 font-medium hover:bg-gray-50"
            onClick={() => {
              setPopulationSize(DEFAULT_PARAMS.populationSize);
              setGenerationLimit(DEFAULT_PARAMS.generationLimit);
              setCrossoverRate(DEFAULT_PARAMS.crossoverRate);
              setMutationRate(DEFAULT_PARAMS.mutationRate);
              setElitismRate(DEFAULT_PARAMS.elitismRate);
              setTsiWeight(DEFAULT_PARAMS.tsiWeight);
              setWifWeight(DEFAULT_PARAMS.wifWeight);
              setRpwWeight(DEFAULT_PARAMS.rpwWeight);
              setResourceUtilizationWeight(DEFAULT_PARAMS.resourceUtilizationWeight);
              setSelectedPreset(null);
            }}
          >
            Reset Defaults
          </button>
          <Link
            to={weightsValid ? `/optimization-running?shift=${selectedShift}&population_size=${populationSize}&generations=${generationLimit}&mutation_rate=${(mutationRate / 100).toFixed(2)}&crossover_rate=${(crossoverRate / 100).toFixed(2)}&elitism_count=${Math.max(1, Math.round((elitismRate / 100) * populationSize))}&tsi_weight=${(tsiWeight / 100).toFixed(2)}&wif_weight=${(wifWeight / 100).toFixed(2)}&rpw_weight=${(rpwWeight / 100).toFixed(2)}&resource_utilization_weight=${(resourceUtilizationWeight / 100).toFixed(2)}` : "#"}
            aria-disabled={!weightsValid}
            tabIndex={weightsValid ? 0 : -1}
            onClick={(e) => {
              if (!weightsValid) {
                e.preventDefault();
              }
            }}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-medium text-white transition-colors ${weightsValid ? "bg-yellow-400 hover:bg-yellow-500" : "cursor-not-allowed bg-gray-300 text-gray-600"}`}
          >
            Run Algorithm
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
        <div className="rounded-lg bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="mb-1 text-lg font-semibold">Optimization Overview</h2>
              <p className="text-sm text-gray-600">Live backend history and configuration summary</p>
            </div>
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
              Backend: {error ? "Unavailable" : "Connected"}
            </span>
          </div>

          <div className="mb-6 grid grid-cols-4 gap-3">
            <div className="rounded-lg border bg-white p-3">
              <div className="mb-1 text-xs text-gray-600">ACTIVE POPULATION</div>
              <div className="mb-1 text-2xl font-bold">{populationSize}</div>
              <div className="text-xs text-gray-600">Configured chromosome pool</div>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <div className="mb-1 text-xs text-gray-600">GENERATION LIMIT</div>
              <div className="mb-1 text-2xl font-bold">{generationLimit}</div>
              <div className="text-xs text-gray-600">Backend validation applied</div>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <div className="mb-1 text-xs text-gray-600">RECENT COMPLETED</div>
              <div className="mb-1 text-2xl font-bold">{recentCompleted.length}</div>
              <div className="text-xs text-gray-600">Runs in history window</div>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <div className="mb-1 text-xs text-gray-600">BEST SCORE</div>
              <div className="mb-1 text-2xl font-bold">
                {bestRun ? Number(((bestRun.result_data as { top_solutions?: Array<{ fitness?: number }> })?.top_solutions?.[0]?.fitness ?? 0).toFixed(4)) : 0}
              </div>
              <div className="text-xs text-gray-600">Latest completed run</div>
            </div>
          </div>

          <div className="mb-6 rounded-lg border bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
              <TrendingUp className="h-4 w-4 text-yellow-500" />
              Recent Optimization Runs
            </div>

            {publishNotice && <p className="mb-2 text-sm text-green-700">{publishNotice}</p>}
            {publishError && <p className="mb-2 text-sm text-red-600">{publishError}</p>}

            {loadingHistory && <p className="text-sm text-gray-500">Loading run history...</p>}
            {!loadingHistory && error && <p className="text-sm text-red-600">{error}</p>}
            {!loadingHistory && !error && history.length === 0 && (
              <p className="text-sm text-gray-500">No optimization runs available yet.</p>
            )}
            {!loadingHistory && !error && history.length > 0 && (
              <div className="overflow-auto">
                <table className="w-full min-w-[980px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="px-3 py-2">Run ID</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Started</th>
                      <th className="px-3 py-2">Fitness</th>
                      <th className="px-3 py-2">Generations</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.slice(0, 10).map((run, runIndex) => {
                      const topSolutions = run.result_data?.top_solutions as Array<{ fitness?: number }> | undefined;
                      const bestFitness = topSolutions?.[0]?.fitness ?? null;
                      const generationCount = Array.isArray(run.fitness_scores) ? run.fitness_scores.length : 0;
                      const prevFitness = runIndex < history.length - 1
                        ? ((history[runIndex + 1].result_data as { top_solutions?: Array<{ fitness?: number }> })?.top_solutions?.[0]?.fitness ?? null)
                        : null;
                      const trend = bestFitness && prevFitness ? bestFitness - prevFitness : null;
                      return (
                        <tr key={run.id} className="border-b last:border-b-0 cursor-pointer hover:bg-gray-50" onClick={() => { if (run.status === "completed") navigate(`/optimization-engine?run_id=${encodeURIComponent(run.run_id)}`); }}>
                          <td className="px-3 py-2 font-medium text-gray-900">{run.run_id}</td>
                          <td className="px-3 py-2">
                            <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                              run.status === "completed" ? "bg-green-100 text-green-800" :
                              run.status === "failed" ? "bg-red-100 text-red-800" :
                              run.status === "cancelled" ? "bg-gray-100 text-gray-800" :
                              run.status === "running" ? "bg-blue-100 text-blue-800" :
                              "bg-yellow-100 text-yellow-800"
                            }`}>
                              {run.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            <div className="flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5 text-gray-400" />
                              {new Date(run.timestamp).toLocaleString()}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            <div className="flex items-center gap-1">
                              {bestFitness ? bestFitness.toFixed(4) : "-"}
                              {trend !== null && trend !== 0 && (
                                <span className={`text-xs ${trend > 0 ? "text-green-600" : "text-red-600"}`}>
                                  {trend > 0 ? "↑" : "↓"}{Math.abs(trend).toFixed(2)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-gray-700">{generationCount}</td>
                          <td className="px-3 py-2">
                            {run.status === "completed" ? (
                              <button
                                onClick={() => onPublishCompletedRun(run.run_id)}
                                disabled={publishingRunId === run.run_id}
                                className="rounded bg-yellow-400 px-2.5 py-1 text-xs font-medium text-white hover:bg-yellow-500 disabled:cursor-not-allowed disabled:bg-yellow-300"
                              >
                                {publishingRunId === run.run_id ? "Publishing..." : "Publish"}
                              </button>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Users className="h-4 w-4 text-yellow-500" />
              Configuration Summary
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-gray-500">Population Size</span><span className="font-medium">{params.population_size}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Generations</span><span className="font-medium">{params.generations}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Crossover Rate</span><span className="font-medium">{params.crossover_rate}%</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Mutation Rate</span><span className="font-medium">{params.mutation_rate}%</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Elitism</span><span className="font-medium">{elitismRate}%</span></div>
              <div className="border-t pt-2 mt-2">
                <div className="mb-1 text-gray-500 font-semibold">Objective Weights</div>
                <div className="flex justify-between"><span className="text-gray-500">TSI Weight</span><span className="font-medium">{params.tsi_weight}%</span></div>
                <div className="flex justify-between"><span className="text-gray-500">WIF Weight</span><span className="font-medium">{params.wif_weight}%</span></div>
                <div className="flex justify-between"><span className="text-gray-500">RPW Weight</span><span className="font-medium">{params.rpw_weight}%</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Utilization Weight</span><span className="font-medium">{params.resource_utilization_weight}%</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
