export type SeverityLevel = "free" | "moderate" | "heavy" | "critical";

/**
 * Get severity for a single bottleneck using fixed thresholds.
 * Used when no context of other bottlenecks is available.
 */
export function getCongestionSeverity(item: { status: string; tsi?: number }): SeverityLevel {
  const tsiPercent = Math.round((Number(item.tsi) || 0) * 100);
  if (item.status === "critical" || tsiPercent >= 80) return "critical";
  if (tsiPercent >= 60) return "heavy";
  if (tsiPercent >= 40) return "moderate";
  return "free";
}

/**
 * Compute severity thresholds from the current bottleneck dataset.
 * Uses quartile-based thresholds so colors spread across the actual data range.
 * Falls back to fixed thresholds if fewer than 4 bottlenecks.
 */
export function computeRelativeThresholds(bottlenecks: Array<{ tsi?: number }>): { p25: number; p50: number; p75: number } {
  const values = bottlenecks
    .map((b) => Number(b.tsi) || 0)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);

  if (values.length < 4) {
    return { p25: 0.25, p50: 0.50, p75: 0.75 };
  }

  const q1 = values[Math.floor(values.length * 0.25)];
  const q2 = values[Math.floor(values.length * 0.50)];
  const q3 = values[Math.floor(values.length * 0.75)];

  return { p25: q1, p50: q2, p75: q3 };
}

/**
 * Get severity for a bottleneck relative to the current dataset.
 * Uses quartile-based thresholds so markers differentiate between bottlenecks.
 */
export function getRelativeCongestionSeverity(
  item: { status: string; tsi?: number },
  thresholds: { p25: number; p50: number; p75: number },
): SeverityLevel {
  const tsi = Number(item.tsi) || 0;
  if (item.status === "critical") return "critical";
  if (tsi >= thresholds.p75) return "critical";
  if (tsi >= thresholds.p50) return "heavy";
  if (tsi >= thresholds.p25) return "moderate";
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
