import { AlertCircle, RotateCcw, X } from "lucide-react";

interface ErrorFeedbackProps {
  error: string | null;
  onRetry?: () => void;
  onDismiss?: () => void;
  retryLabel?: string;
}

export function ErrorFeedback({
  error,
  onRetry,
  onDismiss,
  retryLabel = "Retry",
}: ErrorFeedbackProps) {
  if (!error) return null;

  return (
    <div className="rounded-lg border-l-4 border-red-500 bg-red-50 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
        <div className="flex-1">
          <h3 className="font-semibold text-red-900">Action Failed</h3>
          <p className="mt-1 text-sm text-red-800">{error}</p>
          {(onRetry || onDismiss) && (
            <div className="mt-3 flex gap-2">
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  <RotateCcw className="h-4 w-4" />
                  {retryLabel}
                </button>
              )}
              {onDismiss && (
                <button
                  onClick={onDismiss}
                  className="inline-flex items-center gap-1 rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-200"
                >
                  <X className="h-4 w-4" />
                  Dismiss
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
