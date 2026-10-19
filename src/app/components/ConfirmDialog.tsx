import { useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
  requiresTypedConfirmation?: string; // Text user must type to confirm
  onConfirm: () => Promise<void> | void;
  onCancel?: () => void;
  trigger: React.ReactNode;
  disabled?: boolean;
}

export function ConfirmDialog({
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  isDangerous = false,
  requiresTypedConfirmation,
  onConfirm,
  onCancel,
  trigger,
  disabled = false,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [typedValue, setTypedValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  const canConfirm = !requiresTypedConfirmation || typedValue === requiresTypedConfirmation;

  const handleConfirm = async () => {
    if (!canConfirm || disabled || submitting.current) return;
    submitting.current = true;
    setIsLoading(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
      setTypedValue("");
    } catch (actionError: unknown) {
      setError(actionError instanceof Error ? actionError.message : "The action could not be completed. Please try again.");
    } finally {
      submitting.current = false;
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setOpen(false);
    setTypedValue("");
    setError(null);
    onCancel?.();
  };

  return (
    <AlertDialog open={open} onOpenChange={value => {
      if (submitting.current || (value && disabled)) return;
      setOpen(value);
      setError(null);
      if (!value) setTypedValue("");
    }}>
      <div onClick={() => {
        if (disabled || submitting.current) return;
        setError(null);
        setOpen(true);
      }}>{trigger}</div>
      <AlertDialogContent aria-busy={isLoading} onEscapeKeyDown={event => {
        if (submitting.current) event.preventDefault();
      }}>
        <AlertDialogHeader>
          <AlertDialogTitle className={isDangerous ? "text-red-600" : ""}>
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {requiresTypedConfirmation && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">
              Type <code className="rounded bg-gray-100 px-2 py-1 font-mono text-sm">{requiresTypedConfirmation}</code> to confirm
            </p>
            <input
              type="text"
              value={typedValue}
              onChange={(e) => setTypedValue(e.target.value)}
              placeholder="Type to confirm..."
              className="w-full rounded-lg border px-3 py-2 text-sm"
              autoFocus
              disabled={isLoading}
            />
          </div>
        )}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <AlertDialogCancel onClick={handleCancel} disabled={isLoading}>
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={event => {
              event.preventDefault();
              void handleConfirm();
            }}
            disabled={!canConfirm || isLoading}
            className={isDangerous ? "bg-red-600 hover:bg-red-700" : ""}
          >
            {isLoading ? "Processing..." : confirmText}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
