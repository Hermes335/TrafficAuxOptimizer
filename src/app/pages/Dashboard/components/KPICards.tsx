import { AlertCircle, Target, Clock, CloudRain, TrendingUp, ArrowDown, Link } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "../../../components/ui/tooltip";
import { Link as RouterLink } from "react-router";
import type { DashboardSnapshot, WeatherCurrentSnapshot } from "../../../services/backend";

interface KPICardsProps {
  metrics: DashboardSnapshot["metrics"];
  weather: WeatherCurrentSnapshot;
  deployedOfficersCount: number;
  totalOfficersCount: number;
}

export function KPICards({ metrics, weather, deployedOfficersCount, totalOfficersCount }: KPICardsProps) {
  const coverageEfficiency = Math.max(0, Math.min(100, metrics.coverageEfficiency));
  const avgResponseTimeMinutes = metrics.avgResponseTimeMinutes;
  const resourceUtilization = Math.max(0, Math.min(100, metrics.resourceUtilization));
  const weatherCorrelation = metrics.weatherCorrelation;

  const coverageCircumference = 2 * Math.PI * 16;
  const responseTargetMinutes = 15;
  const responseDeltaMinutes = Number((responseTargetMinutes - avgResponseTimeMinutes).toFixed(1));

  const weatherImpactText =
    weatherCorrelation >= 1.7 ? "Severe impact today" : weatherCorrelation >= 1.3 ? "Moderate impact today" : "Low impact today";

  const weatherStatusTone =
    weatherCorrelation >= 1.7 ? "Severe" : weatherCorrelation >= 1.3 ? "Moderate" : "Clear";

  const weatherStyle = weatherStatusTone === "Severe"
    ? { chipClass: "bg-rose-500 text-white", icon: CloudRain }
    : weatherStatusTone === "Moderate"
      ? { chipClass: "bg-yellow-400 text-white", icon: CloudRain }
      : { chipClass: "bg-emerald-500 text-white", icon: CloudRain };

  const WeatherIndicatorIcon = weatherStyle.icon;

  return (
    <div className="border-b bg-white px-4 py-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {/* Coverage Efficiency */}
        <div className="rounded-lg border-2 border-yellow-400 bg-yellow-50 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-xs font-medium text-gray-600">COVERAGE EFFICIENCY</div>
            <Target className="h-3 w-3 text-yellow-600" aria-hidden="true" />
          </div>
          <div className="flex items-center gap-2">
            <div className="relative h-10 w-10">
              <svg className="h-10 w-10 -rotate-90 transform" aria-hidden="true">
                <circle cx="20" cy="20" r="16" stroke="#FEF3C7" strokeWidth="3" fill="none" />
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
            <div className={`flex items-center gap-1 text-xs ${coverageEfficiency >= 80 ? "text-green-600" : "text-yellow-600"}`}>
              {coverageEfficiency >= 80 ? <TrendingUp className="h-3 w-3" aria-hidden="true" /> : <AlertCircle className="h-3 w-3" aria-hidden="true" />}
              <span>{coverageEfficiency >= 80 ? "Good" : "Watch"}</span>
            </div>
          </div>
        </div>

        {/* Avg Response Time */}
        <div className="rounded-lg border px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-xs font-medium text-gray-600">AVG RESPONSE TIME</div>
            <Clock className="h-3 w-3 text-gray-600" aria-hidden="true" />
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xl font-bold">{avgResponseTimeMinutes}m</div>
            <div className={`flex items-center gap-1 text-xs ${responseDeltaMinutes >= 0 ? "text-green-600" : "text-red-600"}`}>
              <ArrowDown className="h-3 w-3" aria-hidden="true" />
              <span>{responseDeltaMinutes >= 0 ? `-${responseDeltaMinutes}m` : `+${Math.abs(responseDeltaMinutes)}m`}</span>
            </div>
          </div>
          <div className="text-xs text-gray-500">Target: &lt;15m</div>
        </div>

        {/* Resource Utilization */}
        <div className="rounded-lg border px-3 py-2">
          <div className="mb-2 flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className="text-xs font-medium text-gray-600">RESOURCE UTILIZATION</div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-gray-400 hover:text-gray-600" aria-label="Resource utilization info">
                    <AlertCircle className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent sideOffset={6}>
                  <div className="text-xs">Resource utilization = officers with status 'deployed' / total officers</div>
                </TooltipContent>
              </Tooltip>
            </div>

            <RouterLink to="/gantt-chart" className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline">
              Next step
              <Link className="h-3 w-3" aria-hidden="true" />
            </RouterLink>
          </div>

          <div className="mb-1 text-2xl font-bold">{Math.round(resourceUtilization)}%</div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full bg-yellow-400" style={{ width: `${resourceUtilization}%` }} />
          </div>

          <div className="mt-2 text-xs text-gray-700 font-medium">
            {deployedOfficersCount} deployed / {totalOfficersCount} active
          </div>
        </div>

        {/* Weather Correlation */}
        <div className="rounded-lg border px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-xs font-medium text-gray-600">WEATHER CORRELATION</div>
            <CloudRain className="h-3 w-3 text-gray-600" aria-hidden="true" />
          </div>
          <div className="mb-1 text-xl font-bold">{weatherCorrelation.toFixed(2)}</div>
          <svg className="h-4 w-full" viewBox="0 0 100 20" aria-hidden="true">
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
  );
}