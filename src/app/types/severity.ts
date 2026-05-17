export type SeverityLevel = "free" | "moderate" | "heavy" | "critical";

export function getCongestionSeverity(item: { status: string; tsi?: number }): SeverityLevel {
  const tsiPercent = Math.round((Number(item.tsi) || 0) * 100);
  if (item.status === "critical" || tsiPercent >= 80) return "critical";
  if (tsiPercent >= 60) return "heavy";
  if (tsiPercent >= 40) return "moderate";
  return "free";
}

export function getSeverityColor(severity: SeverityLevel): string {
  const colors: Record<SeverityLevel, string> = {
    free: "#22c55e",
    moderate: "#eab308",
    heavy: "#f97316",
    critical: "#ef4444",
  };
  return colors[severity];
}

export function getSeverityBgClass(severity: SeverityLevel): string {
  const classes: Record<SeverityLevel, string> = {
    free: "bg-emerald-50 border-emerald-200",
    moderate: "bg-yellow-50 border-yellow-200",
    heavy: "bg-orange-50 border-orange-200",
    critical: "bg-red-50 border-red-200",
  };
  return classes[severity];
}

export function getSeverityTextClass(severity: SeverityLevel): string {
  const classes: Record<SeverityLevel, string> = {
    free: "text-emerald-700",
    moderate: "text-yellow-700",
    heavy: "text-orange-700",
    critical: "text-red-700",
  };
  return classes[severity];
}

export const congestionTone: Record<SeverityLevel, { dot: string; text: string }> = {
  free: { dot: "bg-emerald-500", text: "text-emerald-600" },
  moderate: { dot: "bg-yellow-500", text: "text-yellow-600" },
  heavy: { dot: "bg-orange-500", text: "text-orange-600" },
  critical: { dot: "bg-red-500", text: "text-red-500" },
};
