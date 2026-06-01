import { TrendingDown, TrendingUp } from "lucide-react";

interface SystemStatsProps {
  cityFlowValue: number;
  cityFlowDelta: number;
  avgResponseTimeMinutes: number;
  delayDeltaMinutes: number;
}

export function SystemStats({ cityFlowValue, cityFlowDelta, avgResponseTimeMinutes, delayDeltaMinutes }: SystemStatsProps) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-gray-50 p-3">
        <div className="mb-1 text-xs text-gray-600">OVERALL CITY FLOW</div>
        <div className="flex items-end gap-2">
          <div className="text-2xl font-bold">{cityFlowValue}%</div>
          <div className={`mb-1 flex items-center text-sm ${cityFlowDelta >= 0 ? "text-green-500" : "text-red-500"}`}>
            {cityFlowDelta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(cityFlowDelta)}%
          </div>
        </div>
      </div>
      <div className="rounded-lg bg-gray-50 p-3">
        <div className="mb-1 text-xs text-gray-600">AVG. DELAY TIME</div>
        <div className="flex items-end gap-2">
          <div className="text-2xl font-bold">{avgResponseTimeMinutes}m</div>
          <div className={`mb-1 flex items-center text-sm ${delayDeltaMinutes <= 0 ? "text-green-500" : "text-red-500"}`}>
            {delayDeltaMinutes <= 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
            {Math.abs(delayDeltaMinutes)}m
          </div>
        </div>
      </div>
    </div>
  );
}
