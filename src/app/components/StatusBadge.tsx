import { AlertCircle, CheckCircle, Clock, Loader, XCircle } from "lucide-react";

type OptimizationStatus = "queued" | "running" | "completed" | "cancelled" | "failed" | "starting";

interface StatusBadgeProps {
  status: OptimizationStatus | string;
  size?: "sm" | "md" | "lg";
}

export function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const normalizedStatus = (status || "queued").toLowerCase();

  const config = {
    queued: { icon: Clock, bg: "bg-blue-100", text: "text-blue-700", label: "Queued" },
    starting: { icon: Loader, bg: "bg-blue-100", text: "text-blue-700", label: "Starting" },
    running: { icon: Loader, bg: "bg-yellow-100", text: "text-yellow-700", label: "Running" },
    completed: { icon: CheckCircle, bg: "bg-green-100", text: "text-green-700", label: "Completed" },
    cancelled: { icon: XCircle, bg: "bg-gray-100", text: "text-gray-700", label: "Cancelled" },
    failed: { icon: AlertCircle, bg: "bg-red-100", text: "text-red-700", label: "Failed" },
  } as const;

  const badgeConfig = config[normalizedStatus as keyof typeof config] || config.queued;
  const Icon = badgeConfig.icon;

  const sizeClasses = {
    sm: "px-2 py-1 text-xs gap-1",
    md: "px-3 py-1.5 text-sm gap-2",
    lg: "px-4 py-2 text-base gap-2",
  };

  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  return (
    <div className={`inline-flex items-center gap-2 rounded-full ${badgeConfig.bg} ${badgeConfig.text} font-medium ${sizeClasses[size]}`}>
      <Icon className={`${iconSizes[size]} ${normalizedStatus === "running" ? "animate-spin" : ""}`} />
      <span>{badgeConfig.label}</span>
    </div>
  );
}
