import { SESSION_EVENT, sessionChanged, clearSession } from "../services/session";
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { getApiBaseUrl } from "../services/backend";
import { LoginError } from "../services/loginErrors";
import { useTrafficActivity } from "../hooks/useTrafficActivity";

export type UserRole = "dispatcher" | "supervisor" | "administrator";

export interface User {
  id: number;
  username: string;
  badge_number: string;
  role: UserRole;
  shift: "morning" | "afternoon";
  permissions: string[];
  profile_complete: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useTrafficActivity(!!user && !!token);

  useEffect(() => {
    const sync = () => {
      const storedToken = localStorage.getItem("auth_token");
      const storedUser = localStorage.getItem("auth_user");
      try {
        setToken(storedToken);
        setUser(storedToken && storedUser ? JSON.parse(storedUser) : null);
      } catch { setUser(null); setToken(null); }
      setIsLoading(false);
    };
    sync();
    window.addEventListener(SESSION_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(SESSION_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);

  const login = async (username: string, password: string) => {
    setError(null);
    // Session loading gates the whole route. The form owns its submitting state
    // so a pending or failed sign-in must not unmount it.
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(`${getApiBaseUrl()}/api/auth/login/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const credentialsRejected = response.status === 400 || response.status === 401;
        const fallback = credentialsRejected ? "Invalid credentials." :
          response.status === 429 ? "Too many sign-in requests. Please wait before trying again." :
          "The sign-in service is unavailable. Please try again shortly.";
        throw new LoginError(data.detail || data.message || fallback,
          credentialsRejected ? "credentials" : "server");
      }

      const data = await response.json();
      if (!(data.token || data.access) || !data.user) {
        throw new LoginError("The sign-in service returned an invalid response. Please try again.", "server");
      }

      // Store token and user
      setToken(data.token || data.access);
      setUser(data.user);

      localStorage.setItem("auth_token", data.token || data.access);
      localStorage.setItem("auth_user", JSON.stringify(data.user));
      if (data.refresh) {
        localStorage.setItem("refresh_token", data.refresh);
      }

      sessionChanged();
      // Establish WebSocket connection after login
      // This will be handled by the dashboard components
    } catch (err) {
      const failure = err instanceof LoginError ? err : new LoginError(
        err instanceof Error && err.name === "AbortError"
          ? "The server took too long to respond. Please try again."
          : err instanceof TypeError
            ? "Cannot reach the server. Please check your connection and try again."
            : "Sign-in could not be completed. Please try again.",
        err instanceof TypeError || (err instanceof Error && err.name === "AbortError") ? "connection" : "server",
      );
      setError(failure.message);
      throw failure;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const logout = async () => {
    // Capture this session before clearing it. A delayed response must never
    // clear credentials belonging to a subsequent sign-in.
    const accessToken = localStorage.getItem("auth_token") || token;
    const refreshToken = localStorage.getItem("refresh_token");
    setUser(null);
    setToken(null);
    setError(null);
    clearSession();

    if (!accessToken) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    // Local sign-out is complete. Revocation is best effort and cannot hold
    // the user on a signed-in page when the server is unavailable.
    void (async () => {
      try {
        await fetch(`${getApiBaseUrl()}/api/auth/logout/`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ refresh: refreshToken }),
          signal: controller.signal,
          keepalive: true,
        });
      } catch {
        // The local session has already ended, including when offline.
      } finally {
        window.clearTimeout(timeout);
      }
    })();
  };

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
        isLoading,
        login,
        logout,
        error,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function useRequireAuth(allowedRoles?: UserRole[]) {
  const { isAuthenticated, isLoading, user } = useAuth();

  const isAuthorized = allowedRoles
    ? user && allowedRoles.includes(user.role)
    : true;

  return { isAuthenticated, isLoading, isAuthorized, user };
}
