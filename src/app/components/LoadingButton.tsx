import React from "react";
import { Button } from "./ui/button";
import { Loader2 } from "lucide-react";
import { cn } from "./ui/utils";

interface LoadingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingText?: string;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

export function LoadingButton({
  loading = false,
  loadingText,
  children,
  className,
  disabled,
  variant = "default",
  size = "default",
  ...props
}: LoadingButtonProps) {
  return (
    <Button
      className={cn("flex items-center gap-2", className)}
      variant={variant}
      size={size}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {loading ? loadingText || children : children}
    </Button>
  );
}

interface AsyncButtonProps extends LoadingButtonProps {
  onClick: () => Promise<void> | void;
}

export function AsyncButton({
  onClick,
  loadingText,
  children,
  className,
  variant,
  size,
  ...props
}: AsyncButtonProps) {
  const [loading, setLoading] = React.useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      await onClick();
    } finally {
      setLoading(false);
    }
  };

  return (
    <LoadingButton
      loading={loading}
      loadingText={loadingText}
      onClick={handleClick}
      className={className}
      variant={variant}
      size={size}
      {...props}
    >
      {children}
    </LoadingButton>
  );
}