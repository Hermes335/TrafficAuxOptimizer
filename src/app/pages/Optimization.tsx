import { useState, useMemo } from "react";
import { ChevronDown, TrendingUp, Users, Zap, Clock, Target } from "lucide-react";
import { Link } from "react-router";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export function Optimization() {
  const [populationSize, setPopulationSize] = useState(50);
  const [generationLimit, setGenerationLimit] = useState(100);
  const [crossoverRate, setCrossoverRate] = useState(80);
  const [mutationRate, setMutationRate] = useState(5);
  const [elitismRate, setElitismRate] = useState(10);
  const [tsi, setTsi] = useState(35);
  const [wif, setWif] = useState(25);
  const [rpw, setRpw] = useState(25);
  const [resourceUtil, setResourceUtil] = useState(15);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  const applyPreset = (preset: string) => {
    setSelectedPreset(preset);
    switch (preset) {
      case "normal":
        setTsi(35);
        setWif(15);
        setRpw(30);
        setResourceUtil(20);
        break;
      case "weather":
        setTsi(25);
        setWif(45);
        setRpw(20);
        setResourceUtil(10);
        break;
      case "event":
        setTsi(40);
        setWif(10);
        setRpw(35);
        setResourceUtil(15);
        break;
    }
  };

  const convergenceData = useMemo(() => 
    Array.from({ length: 30 }, (_, i) => ({
      generation: i * 5,
      bestFitness: 50 + i * 1.5 + Math.random() * 5,
      avgFitness: 30 + i * 1.2 + Math.random() * 3,
    })), 
  []);

  const bottleneckAllocations = [
    { id: "B-001", name: "General Luna St.", officers: 4, total: 4, status: "Optimal" },
    { id: "B-005", name: "Molo Mansion Pla", officers: 3, total: 3, status: "Optimal" },
    { id: "B-012", name: "Diversion Rd. (SM)", officers: 5, total: 6, status: "Warning" },
    { id: "B-018", name: "Jaro Cathedral", officers: 2, total: 2, status: "Optimal" },
    { id: "B-022", name: "Lapaz Public Mark", officers: 2, total: 4, status: "Critical" },
  ];

  return (
    <div className="flex h-full">
      {/* Left Panel - Algorithm Configuration */}
      <div className="w-96 overflow-y-auto border-r bg-white p-6">
        <div className="mb-6">
          <h1 className="mb-2 text-2xl font-bold">Optimization Interface</h1>
          <p className="text-sm text-gray-600">
            Configure Genetic Algorithm parameters to generate optimal deployment strategies.
          </p>
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
                max="300"
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
                min="0"
                max="100"
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
                min="0"
                max="20"
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

          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Traffic Severity Index (TSI)</label>
                <span className="text-yellow-500">{tsi}%</span>
              </div>
              <div className="text-xs text-gray-500">CONGESTION, SPEED, QUEUE LENGTH</div>
              <input
                type="range"
                min="0"
                max="100"
                value={tsi}
                onChange={(e) => setTsi(Number(e.target.value))}
                className="w-full accent-yellow-400"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Weather Impact Factor (WIF)</label>
                <span className="text-yellow-500">{wif}%</span>
              </div>
              <div className="text-xs text-gray-500">RAINFALL CAPACITY REDUCTION</div>
              <input
                type="range"
                min="0"
                max="100"
                value={wif}
                onChange={(e) => setWif(Number(e.target.value))}
                className="w-full accent-yellow-400"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Road Priority Weight (RPW)</label>
                <span className="text-yellow-500">{rpw}%</span>
              </div>
              <div className="text-xs text-gray-500">VOLUME, ECONOMIC IMPORTANCE, INFRASTRUCTURE</div>
              <input
                type="range"
                min="0"
                max="100"
                value={rpw}
                onChange={(e) => setRpw(Number(e.target.value))}
                className="w-full accent-yellow-400"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Resource Utilization</label>
                <span className="text-yellow-500">{resourceUtil}%</span>
              </div>
              <div className="text-xs text-gray-500">OFFICER-HOUR EFFICIENCY</div>
              <input
                type="range"
                min="0"
                max="100"
                value={resourceUtil}
                onChange={(e) => setResourceUtil(Number(e.target.value))}
                className="w-full accent-yellow-400"
              />
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div className="mb-4 flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            <h2 className="font-semibold">PRESET CONFIGURATIONS</h2>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                selectedPreset === "normal" ? "bg-yellow-400 text-white border-yellow-400" : "hover:bg-gray-50"
              }`}
              onClick={() => applyPreset("normal")}
            >
              Normal Ops
            </button>
            <button
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                selectedPreset === "weather" ? "bg-yellow-400 text-white border-yellow-400" : "hover:bg-gray-50"
              }`}
              onClick={() => applyPreset("weather")}
            >
              Weather Emergency
            </button>
            <button
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                selectedPreset === "event" ? "bg-yellow-400 text-white border-yellow-400" : "hover:bg-gray-50"
              }`}
              onClick={() => applyPreset("event")}
            >
              Special Event
            </button>
          </div>
        </div>

        <div className="flex gap-3">
          <button className="flex-1 rounded-lg border px-4 py-2.5 font-medium hover:bg-gray-50">
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

      {/* Center Panel - Convergence Visualization */}
      <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
        <div className="rounded-lg bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="mb-1 text-lg font-semibold">Convergence Visualization</h2>
              <p className="text-sm text-gray-600">Real-time fitness evolution across generations</p>
            </div>
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
              Engine: Active (GA-V7)
            </span>
          </div>

          <div className="mb-6 grid grid-cols-4 gap-3">
            <div className="rounded-lg border bg-white p-3">
              <div className="mb-1 text-xs text-gray-600">BEST FITNESS</div>
              <div className="mb-1 text-2xl font-bold">0.98</div>
              <div className="text-xs text-green-600">+12.4%</div>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <div className="mb-1 text-xs text-gray-600">POPUL. DIVERS.</div>
              <div className="mb-1 text-2xl font-bold">0.64</div>
              <div className="text-xs text-gray-600">Stable</div>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <div className="mb-1 text-xs text-gray-600">RUNTIME</div>
              <div className="mb-1 text-2xl font-bold">14.8s</div>
              <div className="text-xs text-gray-600">Est. 4s left</div>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <div className="mb-1 text-xs text-gray-600">GEN 123</div>
              <div className="mb-1 text-2xl font-bold">82%</div>
              <div className="text-xs text-gray-600">Complete</div>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={convergenceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis
                dataKey="generation"
                tick={{ fontSize: 10 }}
                label={{ value: "← Generation", position: "insideBottomLeft", offset: 0, fontSize: 11 }}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                domain={[0, 100]}
                label={{ value: "Fitness Score", angle: -90, position: "insideLeft", fontSize: 11 }}
              />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="bestFitness"
                stroke="#facc15"
                strokeWidth={2}
                name="Best Fitness"
                dot={false}
                isAnimationActive={false}
                key="best-fitness-line"
              />
              <Line
                type="monotone"
                dataKey="avgFitness"
                stroke="#9ca3af"
                strokeWidth={2}
                name="Average Fitness"
                dot={false}
                isAnimationActive={false}
                key="avg-fitness-line"
              />
            </LineChart>
          </ResponsiveContainer>

          <div className="mt-2 flex justify-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="h-0.5 w-6 bg-yellow-400"></div>
              <span className="text-gray-600">Best Fitness</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-0.5 w-6 bg-gray-400"></div>
              <span className="text-gray-600">Average Fitness</span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-yellow-50 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-yellow-700">
                <TrendingUp className="h-4 w-4" />
                <span>GENERATIONS</span>
              </div>
              <div className="text-2xl font-bold">500 / 500</div>
            </div>
            <div className="rounded-lg bg-blue-50 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-blue-700">
                <Users className="h-4 w-4" />
                <span>CANDIDATE PLANS</span>
              </div>
              <div className="text-2xl font-bold">100,000+</div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Generated Strategy */}
      <div className="w-96 overflow-y-auto border-l bg-white p-6">
        <div className="mb-4 flex items-center gap-2">
          <div className="rounded-lg bg-yellow-100 p-2">
            <Zap className="h-5 w-5 text-yellow-600" />
          </div>
          <h2 className="font-semibold">GENERATED STRATEGY</h2>
        </div>

        <div className="mb-6 rounded-xl bg-yellow-50 p-6 text-center">
          <div className="mb-1 text-sm text-gray-600">Final predicted operational outcome</div>
          <div className="mb-2 text-5xl font-bold text-yellow-500">92.4%</div>
          <div className="text-sm text-gray-700">Predicted Efficiency</div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-gray-600" />
              <span className="text-sm">Bottleneck Coverage</span>
            </div>
            <span className="font-semibold">22 / 22</span>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-gray-600" />
              <span className="text-sm">Congestion Reduction</span>
            </div>
            <span className="font-semibold text-green-600">-38%</span>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-gray-600" />
              <span className="text-sm">Officer Utilization</span>
            </div>
            <span className="font-semibold">84%</span>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-gray-600" />
              <span className="text-sm">Response Readiness</span>
            </div>
            <span className="font-semibold">High</span>
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <h3 className="mb-3 text-sm font-semibold">BOTTLENECK ALLOCATION</h3>
          {bottleneckAllocations.map((item) => (
            <div key={item.id} className="rounded-lg border p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-gray-500">{item.id}</span>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    item.status === "Optimal"
                      ? "bg-green-100 text-green-700"
                      : item.status === "Warning"
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {item.status}
                </span>
              </div>
              <div className="mb-2 font-medium">{item.name}</div>
              <div className="text-sm text-gray-600">
                {item.officers} / {item.total} STAFF
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full bg-yellow-400"
                  style={{ width: `${(item.officers / item.total) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        <Link
          to="/optimization-engine"
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-yellow-400 py-3 font-medium text-white hover:bg-yellow-500"
        >
          Approve & Deploy →
        </Link>

        <button className="mt-2 w-full rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">
          Export Model (.json)
        </button>

        <div className="mt-6 rounded-lg bg-green-50 p-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500 text-white">
              ✓
            </div>
            <span className="font-medium text-green-900">Optimization Insight</span>
          </div>
          <p className="text-sm text-green-800">
            The current model prioritizes <strong>Diversion Road</strong> due to rain forecasts.
            Total congestion impact is expected to drop by 22% compared to manual scheduling.
          </p>
        </div>
      </div>
    </div>
  );
}