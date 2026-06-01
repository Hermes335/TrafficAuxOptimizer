import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { LoadingState } from "../components/LoadingState";
import { Eye, EyeOff, Shield, AlertTriangle, LogIn, MapPin, CheckCircle2 } from "lucide-react";

export function Login() {
  const { login, logout, isAuthenticated, isLoading: authLoading, error, clearError } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);
  const [sessionWarning, setSessionWarning] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const displayError = localError || error;

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && !authLoading) {
      navigate("/");
    }
  }, [isAuthenticated, authLoading, navigate]);

  // Clear errors on input change
  useEffect(() => {
    setLocalError(null);
    clearError();
  }, [username, password, clearError]);

  // Check lockout
  useEffect(() => {
    if (lockedUntil) {
      const interval = setInterval(() => {
        if (new Date() >= lockedUntil) {
          setLockedUntil(null);
          setLoginAttempts(0);
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [lockedUntil]);

  // Session idle timeout warning (simulated - 30 minutes)
  useEffect(() => {
    if (!isAuthenticated) return;

    const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    let idleTimer: ReturnType<typeof setTimeout>;

    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        setSessionWarning("Session will expire in 5 minutes due to inactivity.");
        setTimeout(() => {
          logout();
          navigate("/login");
        }, 5 * 60 * 1000);
      }, IDLE_TIMEOUT);
    };

    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((event) => window.addEventListener(event, resetIdleTimer));
    resetIdleTimer();

    return () => {
      clearTimeout(idleTimer);
      events.forEach((event) => window.removeEventListener(event, resetIdleTimer));
    };
  }, [isAuthenticated, logout, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (lockedUntil) {
      const remaining = Math.ceil((lockedUntil.getTime() - Date.now()) / 1000 / 60);
      setLocalError(`Account locked. Try again in ${remaining} minutes.`);
      return;
    }

    if (!username.trim()) {
      setLocalError("Username or badge number is required.");
      return;
    }

    if (!password) {
      setLocalError("Password is required.");
      return;
    }

    setIsSubmitting(true);
    setLocalError(null);

    try {
      await login(username.trim(), password);
      navigate("/");
    } catch {
      const newAttempts = loginAttempts + 1;
      setLoginAttempts(newAttempts);

      if (newAttempts >= 5) {
        const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
        setLockedUntil(lockUntil);
        setLocalError("Too many failed attempts. Account locked for 15 minutes.");
      } else {
        setLocalError(`Invalid credentials. ${5 - newAttempts} attempts remaining.`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = () => {
    setLocalError("Password recovery: Contact your administrator for password reset.");
  };

  if (authLoading) {
    return <LoadingState label="Checking session..." />;
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#e9edf2]">
      {/* Session Warning Banner */}
      {sessionWarning && (
        <div className="absolute left-0 right-0 top-0 z-50 bg-amber-500 px-4 py-2 text-center text-sm text-white">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {sessionWarning}
        </div>
      )}

      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.35fr_1fr]">
        {/* Left Hero Panel */}
        <section
          className="relative hidden overflow-hidden border-r border-slate-700/40 lg:block"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(3,16,44,0.88) 0%, rgba(4,18,50,0.84) 100%), url('https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1200&h=900&fit=crop&auto=format')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:52px_52px]" />
          <div className="relative z-10 flex h-full flex-col px-8 py-7 text-white">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-md border border-yellow-400/35 bg-yellow-500/10">
                <Shield className="h-4 w-4 text-yellow-400" />
              </div>
              <div>
                <div className="text-[11px] font-semibold tracking-[0.18em] text-yellow-400">ILOILO CITY</div>
                <div className="text-[10px] tracking-[0.14em] text-slate-300">TRAFFIC MANAGEMENT OFFICE</div>
              </div>
            </div>

            <div className="mt-auto max-w-md pb-7">
              <div className="mb-5 inline-flex items-center rounded-md border border-yellow-500/25 bg-yellow-500/10 px-3 py-1.5 text-xs font-medium text-yellow-300">
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                System Online - All Zones Active
              </div>

              <h1 className="leading-[0.95] text-white">
                <span className="block text-6xl font-black">Traffic</span>
                <span className="block text-6xl font-black text-yellow-400">Deployment</span>
                <span className="block text-6xl font-black">DSS</span>
              </h1>

              <p className="mt-5 max-w-sm text-sm leading-7 text-slate-300">
                Decision Support System for intelligent officer deployment, real-time incident management, and optimized traffic flow across Iloilo City.
              </p>

              <div className="mt-4 inline-flex items-center gap-2 text-xs text-slate-300">
                <MapPin className="h-3.5 w-3.5 text-yellow-400" />
                Iloilo City, Western Visayas, Philippines
              </div>

              <div className="mt-9 grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                  <div className="text-4xl font-black text-yellow-400">124</div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Deployed</div>
                  <div className="text-sm text-slate-300">Active Officers</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                  <div className="text-4xl font-black text-yellow-400">38</div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Monitored</div>
                  <div className="text-sm text-slate-300">Intersections</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                  <div className="text-4xl font-black text-yellow-400">4.2</div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Minutes</div>
                  <div className="text-sm text-slate-300">Avg Response</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Right Form Panel */}
        <section className="relative flex items-center justify-center px-6 py-10 sm:px-10">
          <div className="absolute right-8 top-7 hidden items-center gap-2 text-xs text-slate-500 sm:flex">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            v2.4.1 - Secure
          </div>

          <div className="w-full max-w-md">
            <h2 className="text-4xl font-black tracking-tight text-slate-900">Sign In</h2>
            <p className="mt-2 text-sm text-slate-500">Access the Traffic Deployment System with your credentials.</p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div>
                <label htmlFor="username" className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-500">
                  Employee ID
                </label>
                <input
                  type="text"
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. TMO-2024-001"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20"
                  autoComplete="username"
                  disabled={isSubmitting || !!lockedUntil}
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-500">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-xs font-medium text-amber-600 hover:text-amber-700"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-11 text-sm text-slate-700 placeholder:text-slate-400 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20"
                    autoComplete="current-password"
                    disabled={isSubmitting || !!lockedUntil}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {displayError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertTriangle className="mr-2 inline h-4 w-4" />
                  {displayError}
                </div>
              )}

              {lockedUntil && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                  <AlertTriangle className="mr-2 inline h-4 w-4" />
                  Account locked until {lockedUntil.toLocaleTimeString()}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || !!lockedUntil}
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Authenticating...
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" />
                    Sign In to System
                  </>
                )}
              </button>

            </form>

            <p className="mt-8 text-center text-xs leading-6 text-slate-400">
              Authorized personnel only. All access is logged
              <br />
              and subject to audit. Iloilo City TMO 2024
            </p>

            <div className="mt-16 flex items-center justify-between text-[10px] uppercase tracking-[0.1em] text-slate-400">
              <span>256-bit Encrypted</span>
              <span>ISO 27001 Compliant</span>
              <span>Build 2024.12</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}