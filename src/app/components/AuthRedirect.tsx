import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { LoadingState } from "./LoadingState";
import { loginDestination } from "../services/loginDestination";

export function AuthRedirect({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  if (isLoading) return <LoadingState label="Checking session..." />;
  if (isAuthenticated) return <Navigate to={loginDestination(location.state, user?.role)} replace />;
  return <>{children}</>;
}
