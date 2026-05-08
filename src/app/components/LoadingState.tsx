import { Loader, AlertCircle } from "lucide-react";

interface LoadingStateProps {
  label?: string;
  error?: string | null;
}

export function LoadingState({ label = "Loading...", error }: LoadingStateProps) {
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8">
        <AlertCircle className="h-12 w-12 text-red-500" />
        <p className="text-center text-sm text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8">
      <Loader className="h-8 w-8 animate-spin text-gray-400" />
      <p className="text-center text-sm text-gray-600">{label}</p>
    </div>
  );
}

export function EmptyState({
  icon: Icon = AlertCircle,
  title = "No data",
  description = "Nothing to display.",
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 py-12">
      <Icon className="h-12 w-12 text-gray-400" />
      <div className="text-center">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <p className="mt-1 text-sm text-gray-600">{description}</p>
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
