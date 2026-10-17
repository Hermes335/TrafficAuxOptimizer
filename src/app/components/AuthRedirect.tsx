import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { LoadingState } from "./LoadingState";

export function AuthRedirect({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <LoadingState label="Checking session..." />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}
