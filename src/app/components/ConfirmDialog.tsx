import { useState } from "react";
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
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [typedValue, setTypedValue] = useState("");

  const canConfirm = !requiresTypedConfirmation || typedValue === requiresTypedConfirmation;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setIsLoading(true);
    try {
      await onConfirm();
      setOpen(false);
      setTypedValue("");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setOpen(false);
    setTypedValue("");
    onCancel?.();
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <div onClick={() => setOpen(true)}>{trigger}</div>
      <AlertDialogContent>
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
            />
          </div>
        )}
        <div className="flex justify-end gap-3">
          <AlertDialogCancel onClick={handleCancel} disabled={isLoading}>
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
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
