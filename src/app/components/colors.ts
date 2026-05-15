import { cn } from "./ui/utils";

// Semantic color tokens for consistent styling
// Use these instead of hardcoded colors throughout the app

export const colors = {
  // Status colors
  status: {
    success: "text-green-600 bg-green-50 border-green-200",
    successBg: "bg-green-500",
    warning: "text-yellow-600 bg-yellow-50 border-yellow-200",
    warningBg: "bg-yellow-400",
    error: "text-red-600 bg-red-50 border-red-200",
    errorBg: "bg-red-500",
    info: "text-blue-600 bg-blue-50 border-blue-200",
    infoBg: "bg-blue-500",
  },

  // Severity colors for incidents
  severity: {
    critical: "bg-red-500 text-white",
    criticalBg: "bg-red-50 text-red-900",
    major: "bg-orange-500 text-white",
    majorBg: "bg-orange-50 text-orange-900",
    minor: "bg-yellow-400 text-white",
    minorBg: "bg-yellow-50 text-yellow-900",
  },

  // Bottleneck status
  bottleneck: {
    normal: "bg-green-500",
    normalHex: "#22c55e",
    warning: "bg-yellow-500",
    warningHex: "#eab308",
    critical: "bg-red-500",
    criticalHex: "#ef4444",
  },

  // Primary brand color (yellow/amber)
  primary: {
    default: "bg-yellow-400 text-white hover:bg-yellow-500",
    light: "bg-yellow-50 border-yellow-400",
    text: "text-yellow-600",
    border: "border-yellow-400",
  },

  // Neutral grays
  neutral: {
    light: "bg-gray-50",
    default: "bg-gray-100 border-gray-200",
    dark: "bg-gray-200",
    text: "text-gray-600",
    muted: "text-gray-400",
  },
} as const;

// Helper function to get bottleneck color based on status
export function getBottleneckColor(status: "normal" | "warning" | "critical"): string {
  return colors.bottleneck[status];
}

export function getBottleneckColorHex(status: "normal" | "warning" | "critical"): string {
  return colors.bottleneck[`${status}Hex`];
}

// Helper function for severity styling
export function getSeverityStyles(type: "critical" | "major" | "minor"): {
  badge: string;
  background: string;
} {
  return {
    badge: colors.severity[type],
    background: colors.severity[`${type}Bg`],
  };
}

// Status badge helper
export function getStatusBadgeColor(status: string): string {
  const statusLower = status.toLowerCase();
  if (statusLower === "completed" || statusLower === "success" || statusLower === "healthy") {
    return colors.status.success;
  }
  if (statusLower === "running" || statusLower === "pending" || statusLower === "active") {
    return colors.status.warning;
  }
  if (statusLower === "failed" || statusLower === "error" || statusLower === "critical") {
    return colors.status.error;
  }
  return colors.status.info;
}

// Compact utility for common patterns
export const statusIndicator = (status: "normal" | "warning" | "critical") =>
  cn("h-2 w-2 rounded-full", getBottleneckColor(status));

export const severityBadge = (type: "critical" | "major" | "minor") =>
  cn("rounded px-2 py-0.5 text-xs font-medium", getSeverityStyles(type).badge);

export const actionButton = (variant: "primary" | "danger" | "secondary" = "primary") => {
  const variants = {
    primary: "bg-yellow-400 text-white hover:bg-yellow-500",
    danger: "bg-red-500 text-white hover:bg-red-600",
    secondary: "border text-gray-700 hover:bg-gray-50",
  };
  return cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", variants[variant]);
};