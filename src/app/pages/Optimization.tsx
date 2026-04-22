import { useEffect, useMemo, useState } from "react";
import { Clock, Target, Zap, TrendingUp, Users } from "lucide-react";
import { Link } from "react-router";
import {
  fetchOptimizationConfig,
  fetchOptimizationHistory,
  type OptimizationHistoryItem,
  type OptimizationConfigResponse,
} from "../services/backend";

const DEFAULT_PARAMS = {
  populationSize: 200,
  generationLimit: 300,
  crossoverRate: 80,
  mutationRate: 10,
  elitismRate: 10,
};

export function Optimization() {
  const [populationSize, setPopulationSize] = useState(DEFAULT_PARAMS.populationSize);
  const [generationLimit, setGenerationLimit] = useState(DEFAULT_PARAMS.generationLimit);
  const [crossoverRate, setCrossoverRate] = useState(DEFAULT_PARAMS.crossoverRate);
  const [mutationRate, setMutationRate] = useState(DEFAULT_PARAMS.mutationRate);
  const [elitismRate, setElitismRate] = useState(DEFAULT_PARAMS.elitismRate);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [history, setHistory] = useState<OptimizationHistoryItem[]>([]);
  const [validation, setValidation] = useState<OptimizationConfigResponse | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [validationLoading, setValidationLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(
    () => ({
      population_size: populationSize,
      generations: generationLimit,
      mutation_rate: Number((mutationRate / 100).toFixed(2)),
      crossover_rate: Number((crossoverRate / 100).toFixed(2)),
      elitism_count: Math.max(1, Math.round((elitismRate / 100) * 10)),
    }),
    [populationSize, generationLimit, mutationRate, crossoverRate, elitismRate],
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
    setValidationLoading(true);

    fetchOptimizationConfig(params)
      .then((result) => {
        if (!active) {
          return;
        }
        setValidation(result);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setValidation(null);
      })
      .finally(() => {
        if (active) {
          setValidationLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [params]);

  const applyPreset = (preset: string) => {
    setSelectedPreset(preset);
    switch (preset) {
      case "normal":
        setMutationRate(10);
        setCrossoverRate(80);
        setElitismRate(10);
        setPopulationSize(200);
        setGenerationLimit(300);
        break;
      case "weather":
        setMutationRate(8);
        setCrossoverRate(78);
        setElitismRate(12);
        setPopulationSize(240);
        setGenerationLimit(350);
        break;
      case "event":
        setMutationRate(12);
        setCrossoverRate(85);
        setElitismRate(15);
        setPopulationSize(180);
        setGenerationLimit(250);
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
            <h2 className="font-semibold">PARAMETER PRESETS</h2>
          </div>

          <div className="grid grid-cols-3 gap-2">
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
                selectedPreset === "weather" ? "border-yellow-400 bg-yellow-400 text-white" : "hover:bg-gray-50"
              }`}
              onClick={() => applyPreset("weather")}
            >
              Weather
            </button>
            <button
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                selectedPreset === "event" ? "border-yellow-400 bg-yellow-400 text-white" : "hover:bg-gray-50"
              }`}
              onClick={() => applyPreset("event")}
            >
              Event
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
              setSelectedPreset(null);
            }}
          >
            Reset Defaults
          </button>
          <Link
            to={`/optimization-running?population_size=${populationSize}&generations=${generationLimit}&mutation_rate=${(mutationRate / 100).toFixed(2)}&crossover_rate=${(crossoverRate / 100).toFixed(2)}&elitism_count=${Math.max(1, Math.round((elitismRate / 100) * 10))}`}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-yellow-400 px-4 py-2.5 font-medium text-white hover:bg-yellow-500"
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

            {loadingHistory && <p className="text-sm text-gray-500">Loading run history...</p>}
            {!loadingHistory && error && <p className="text-sm text-red-600">{error}</p>}
            {!loadingHistory && !error && history.length === 0 && (
              <p className="text-sm text-gray-500">No optimization runs available yet.</p>
            )}
            {!loadingHistory && !error && history.length > 0 && (
              <div className="overflow-auto">
                <table className="w-full min-w-[860px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="px-3 py-2">Run ID</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Started</th>
                      <th className="px-3 py-2">Fitness</th>
                      <th className="px-3 py-2">Generations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.slice(0, 10).map((run) => {
                      const topSolutions = run.result_data?.top_solutions as Array<{ fitness?: number }> | undefined;
                      const bestFitness = topSolutions?.[0]?.fitness ?? null;
                      const generationCount = Array.isArray(run.fitness_scores) ? run.fitness_scores.length : 0;
                      return (
                        <tr key={run.id} className="border-b last:border-b-0">
                          <td className="px-3 py-2 font-medium text-gray-900">{run.run_id}</td>
                          <td className="px-3 py-2">
                            <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                              {run.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            <div className="flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5 text-gray-400" />
                              {new Date(run.timestamp).toLocaleString()}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-gray-700">{bestFitness ?? "-"}</td>
                          <td className="px-3 py-2 text-gray-700">{generationCount}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-white p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Users className="h-4 w-4 text-yellow-500" />
              Live Configuration Payload
            </div>
            <pre className="overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-700">
              {JSON.stringify(params, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
