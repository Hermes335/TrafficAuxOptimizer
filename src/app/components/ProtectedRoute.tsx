import { Navigate, useLocation } from "react-router";
import { useAuth, type UserRole } from "../contexts/AuthContext";
import { LoadingState } from "./LoadingState";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <LoadingState label="Verifying session..." />;
  }

  if (!isAuthenticated) {
    // Redirect to login, preserving the intended destination
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check role-based access if roles are specified
  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    // Redirect to appropriate page based on role
    const roleRedirects: Record<UserRole, string> = {
      dispatcher: "/",
      supervisor: "/",
      administrator: "/settings",
    };

    return <Navigate to={roleRedirects[user.role]} replace />;
  }

  return <>{children}</>;
}

// Role-specific wrapper for conditional rendering
interface RoleGateProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
  fallback?: React.ReactNode;
}

export function RoleGate({ children, allowedRoles, fallback = null }: RoleGateProps) {
  const { user } = useAuth();

  if (!user || !allowedRoles.includes(user.role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

// Component for re-authentication
