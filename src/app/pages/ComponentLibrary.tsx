import { Bell, Home, User } from "lucide-react";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis } from "recharts";
import PrettyCurve from "../components/PrettyCurve";

export function ComponentLibrary() {
  const convergenceData = Array.from({ length: 20 }, (_, i) => 20 + i * 3);

  const congestionData = [
    { id: "B-001", value: 92 },
    { id: "B-005", value: 96 },
    { id: "B-012", value: 78 },
    { id: "B-018", value: 65 },
    { id: "B-022", value: 88 },
  ];

  return (
    <div className="min-h-full bg-gray-50 p-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="mb-2 text-sm text-gray-500">Design System v1.4</div>
          <h1 className="mb-3 text-4xl font-bold">Component Library</h1>
          <p className="max-w-2xl text-gray-600">
            A comprehensive catalog of UI primitives, brand assets, and interactive patterns
            powering the Iloilo City Traffic Management Office Decision Support System.
          </p>
        </div>

        {/* Visual Foundations */}
        <section className="mb-12">
          <div className="mb-4 flex items-center gap-2">
            <span className="text-2xl">💡</span>
            <h2 className="text-2xl font-bold">Visual Foundations</h2>
          </div>
          <p className="mb-6 text-sm text-gray-600">
            Core brand and typography rules applied for high-usability user-commands.
          </p>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            {/* Color Palette */}
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <h3 className="mb-4 font-semibold">Color Palette</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="mb-2 h-24 rounded-lg bg-yellow-400"></div>
                  <div className="mb-1 font-medium">PRIMARY</div>
                  <div className="text-xs text-gray-500">#F7B428</div>
                  <div className="text-xs text-gray-400">
                    Primary CTAs and
                    <br />
                    intelligent highlights
                  </div>
                </div>

                <div>
                  <div className="mb-2 h-24 rounded-lg bg-gray-900"></div>
                  <div className="mb-1 font-medium">SECONDARY</div>
                  <div className="text-xs text-gray-500">#1F2937</div>
                  <div className="text-xs text-gray-400">
                    Text, headers,
                    <br />
                    UI frame
                  </div>
                </div>

                <div>
                  <div className="mb-2 h-24 rounded-lg bg-gray-700"></div>
                  <div className="mb-1 font-medium">ACCENT</div>
                  <div className="text-xs text-gray-500">#374151</div>
                  <div className="text-xs text-gray-400">
                    Metadata labels,
                    <br />
                    subtle content
                  </div>
                </div>

                <div>
                  <div className="mb-2 h-24 rounded-lg bg-sky-400"></div>
                  <div className="mb-1 font-medium">BRAND-200</div>
                  <div className="text-xs text-gray-500">#38BDF8</div>
                  <div className="text-xs text-gray-400">
                    Info tags and
                    <br />
                    selected badges
                  </div>
                </div>

                <div>
                  <div className="mb-2 h-24 rounded-lg bg-green-500"></div>
                  <div className="mb-1 font-medium">SUCCESS</div>
                  <div className="text-xs text-gray-500">#22C55E</div>
                  <div className="text-xs text-gray-400">
                    Safe mode,
                    <br />
                    high values
                  </div>
                </div>

                <div>
                  <div className="mb-2 h-24 rounded-lg bg-gray-400"></div>
                  <div className="mb-1 font-medium">MUTED</div>
                  <div className="text-xs text-gray-500">#9CA3AF</div>
                  <div className="text-xs text-gray-400">
                    Disabled state,
                    <br />
                    empty containers
                  </div>
                </div>
              </div>
            </div>

            {/* Typography Scale */}
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <h3 className="mb-4 font-semibold">Typography Scale</h3>
              <div className="space-y-6">
                <div>
                  <div className="mb-2 text-3xl font-bold">Optimization Engine</div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                    <div>
                      <span className="text-gray-700">Headings / Display</span>
                    </div>
                    <div className="text-right">
                      <div>Font: Inter • 700 • 36px</div>
                      <div>
                        Text align: <span className="text-gray-900">left</span> • Line-H:{" "}
                        <span className="text-gray-900">40 / 28 tight</span>
                      </div>
                      <div>
                        Kerning: <span className="text-gray-900">-.02em / -0.01em</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-sm text-gray-600">Bottleneck Analysis</div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                    <div>
                      <span className="text-gray-700">Body Label / Tag (description)</span>
                    </div>
                    <div className="text-right">
                      <div>
                        <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                          Text weight: 500 (medium) • 14px
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* User Interactions */}
        <section className="mb-12">
          <div className="mb-4 flex items-center gap-2">
            <span className="text-2xl">🎯</span>
            <h2 className="text-2xl font-bold">User Interactions</h2>
          </div>
          <p className="mb-6 text-sm text-gray-600">
            Common button types, form elements, and user-controlled hotspots and action states.
          </p>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            {/* Action Buttons */}
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <h3 className="mb-2 font-semibold">Action Buttons</h3>
              <p className="mb-4 text-xs text-gray-500">Primary, secondary, and utility triggers</p>
              <div className="space-y-3">
                <button className="w-full rounded-lg bg-yellow-400 px-4 py-2 font-medium text-white hover:bg-yellow-500">
                  PRIMARY VARIANT
                </button>
                <div className="text-center text-xs text-gray-400">
                  High-emphasis CTA for important ops
                </div>

                <button className="w-full rounded-lg border-2 border-yellow-400 px-4 py-2 font-medium text-yellow-600 hover:bg-yellow-50">
                  REJECT PARAMETER
                </button>

                <button className="w-full rounded-lg bg-gray-200 px-4 py-2 font-medium text-gray-600 hover:bg-gray-300">
                  Secondary Action
                </button>

                <button className="w-full rounded-lg bg-red-500 px-4 py-2 font-medium text-white hover:bg-red-600">
                  Danger Navigation
                </button>

                <button className="w-full rounded-lg border border-gray-300 bg-yellow-50 px-4 py-2 text-sm text-gray-700 hover:bg-yellow-100">
                  LOAD RUNTIME DATA
                </button>
              </div>
            </div>

            {/* Form Inputs */}
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <h3 className="mb-2 font-semibold">Form Inputs</h3>
              <p className="mb-4 text-xs text-gray-500">Selection and data-entry controls</p>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs text-gray-600">DEFAULT INPUT</label>
                  <input
                    type="text"
                    placeholder="Type here..."
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-yellow-400"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-gray-600">SEARCH FIELD</label>
                  <div className="relative">
                    <input
                      type="search"
                      placeholder="Search officers..."
                      className="w-full rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm outline-none focus:border-yellow-400"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Status & Identity */}
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <h3 className="mb-2 font-semibold">Status & Identity</h3>
              <p className="mb-4 text-xs text-gray-500">Officer badges and status visual tags</p>
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-lg border p-3">
                  <img
                    src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=50&h=50&fit=crop"
                    alt="Officer"
                    className="h-10 w-10 rounded-full"
                  />
                  <div className="flex-1">
                    <div className="font-medium">Officer J. Santos</div>
                    <div className="text-xs text-gray-500">Active Field Officer</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                    Active
                  </span>
                  <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-700">
                    Moderate
                  </span>
                  <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
                    Critical
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Data Visualization */}
        <section className="mb-12">
          <div className="mb-4 flex items-center gap-2">
            <span className="text-2xl">📊</span>
            <h2 className="text-2xl font-bold">Data Visualization</h2>
          </div>
          <p className="mb-6 text-sm text-gray-600">
            Specialized charts and metrics for complex decision-support analysis.
          </p>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            {/* Metrics Display */}
            <div className="space-y-4">
              <div className="rounded-xl bg-white p-6 shadow-sm">
                <h3 className="mb-4 font-semibold">Key Metrics</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border-2 border-yellow-400 bg-yellow-50 p-4 text-center">
                    <div className="mb-1 text-xs text-gray-600">TRAFFIC FLOW</div>
                    <div className="text-4xl font-bold">84%</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-4 text-center">
                    <div className="mb-1 text-xs text-gray-600">DEPLOYMENT ACCURACY</div>
                    <div className="text-4xl font-bold">92.4</div>
                  </div>
                </div>
              </div>

              {/* Bottleneck Congestion */}
              <div className="rounded-xl bg-white p-6 shadow-sm">
                <h3 className="mb-2 font-semibold">Bottleneck Congestion</h3>
                <p className="mb-4 text-xs text-gray-500">
                  Live data for key traffic choke points across city districts
                </p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={congestionData} layout="vertical">
                    <XAxis type="number" domain={[0, 100]} hide />
                    <YAxis type="category" dataKey="id" tick={{ fontSize: 11 }} width={50} />
                    <Bar dataKey="value" fill="#facc15" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-2 text-right text-xs text-gray-500">% Congestion Density</div>
              </div>
            </div>

            {/* Convergence Analysis */}
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <h3 className="mb-2 font-semibold">Convergence Analysis</h3>
              <p className="mb-4 text-xs text-gray-500">
                Genetic algorithm fitness evolution over 150+ generations
              </p>
              <ResponsiveContainer width="100%" height={300}>
                <div className="h-64">
                  <PrettyCurve values={convergenceData} color="#facc15" />
                </div>
              </ResponsiveContainer>
              <div className="mt-4 flex justify-center gap-6 text-xs">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-yellow-400"></div>
                  <span>Best Fitness</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-gray-400"></div>
                  <span>Average Fitness</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Traffic & Map Assets */}
        <section className="mb-12">
          <div className="mb-4 flex items-center gap-2">
            <span className="text-2xl">🗺️</span>
            <h2 className="text-2xl font-bold">Traffic & Map Assets</h2>
          </div>
          <p className="mb-6 text-sm text-gray-600">
            Geolocated markers and status indicators used across the mapping and scheduling
            interface.
          </p>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            {/* Yard Park Markers */}
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <h3 className="mb-4 font-semibold">Yard Park Markers</h3>
              <div className="flex items-center justify-around">
                <div className="text-center">
                  <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                    <div className="font-bold text-green-700">78%</div>
                  </div>
                  <div className="text-xs text-gray-500">OPTIMAL</div>
                </div>
                <div className="text-center">
                  <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
                    <div className="font-bold text-red-700">42%</div>
                  </div>
                  <div className="text-xs text-gray-500">CRITICAL</div>
                </div>
              </div>
            </div>

            {/* Progress Rings */}
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <h3 className="mb-4 font-semibold">Progress Rings</h3>
              <div className="text-center">
                <div className="mb-2 inline-flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-yellow-400 to-yellow-500">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white">
                    <span className="text-2xl font-bold">78%</span>
                  </div>
                </div>
                <div className="text-xs text-gray-500">Completion indicator</div>
              </div>
            </div>

            {/* System Metadata */}
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <h3 className="mb-4 font-semibold">System Metadata</h3>
              <div className="space-y-2">
                <div className="rounded-lg bg-blue-50 p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <Bell className="h-4 w-4 text-blue-600" />
                    <span className="text-xs font-medium text-blue-900">
                      Calibration Notice
                    </span>
                  </div>
                  <p className="text-xs text-blue-800">
                    Weather data auto-synced with city sensors. Light rain forecasted for 3PM
                    shift.
                  </p>
                </div>

                <div className="rounded-lg bg-red-50 p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <Bell className="h-4 w-4 text-red-600" />
                    <span className="text-xs font-medium text-red-900">
                      Alert! Bottleneck B-012 Overflow
                    </span>
                  </div>
                  <p className="text-xs text-red-800">
                    Officer count exceeded safe threshold. Reallocate backup units.
                  </p>
                </div>

                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <Home className="h-4 w-4 text-gray-600" />
                    <span className="text-xs font-medium text-gray-900">Automated Schedule</span>
                  </div>
                  <p className="text-xs text-gray-600">
                    Next sync occurs in 3min aligned with GA 3:45 update window.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="flex items-center justify-between border-t pt-6 text-xs text-gray-500">
          <div>© 2024 ILOILO CITY TRAFFIC MANAGEMENT OFFICE (ICTMO)</div>
          <div className="flex gap-6">
            <span>DSS ENGINE V2.4.0</span>
            <span>STYLE GUIDE</span>
          </div>
        </footer>
      </div>
    </div>
  );
}