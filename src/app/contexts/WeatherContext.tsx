import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchCurrentWeather, type WeatherCurrentSnapshot } from "../services/backend";

const missingWeather: WeatherCurrentSnapshot = {
  timestamp: null, condition: null, temperature: null, precipitation: null, weather_impact_factor: null,
  source: "unknown", data_status: "unavailable", available: false, is_synthetic: false,
  is_stale: false, observed_at: null, fetched_at: null,
};

interface WeatherContextValue {
  weather: WeatherCurrentSnapshot;
  loading: boolean;
  error: string | null;
  refreshWeather: () => Promise<void>;
}

const WeatherContext = createContext<WeatherContextValue | undefined>(undefined);

export function WeatherProvider({ children }: { children: ReactNode }) {
  const [weather, setWeather] = useState(missingWeather);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);

  const refreshWeather = useCallback(() => {
    if (!mounted.current) return Promise.resolve();
    if (inFlight.current) return inFlight.current;
    const request = ++generation.current;
    setLoading(true);
    const pending = (async () => {
      try {
        const snapshot = await fetchCurrentWeather();
        if (!mounted.current || request !== generation.current) return;
        setWeather(snapshot);
        setError(null);
      } catch (failure) {
        if (!mounted.current || request !== generation.current) return;
        setError(failure instanceof Error ? failure.message : "Weather refresh failed");
        // Retain the last observation for context, but never label it as current
        // after a failed refresh.
        setWeather(previous => ({
          ...previous,
          available: false,
          data_status: "unavailable",
          is_stale: previous.is_stale || previous.available,
        }));
        throw failure;
      } finally {
        if (mounted.current && request === generation.current) setLoading(false);
      }
    })().finally(() => {
      if (inFlight.current === pending) inFlight.current = null;
    });
    inFlight.current = pending;
    return pending;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshWeather().catch(() => {});
    const timer = window.setInterval(() => { void refreshWeather().catch(() => {}); }, 5 * 60 * 1000);
    return () => {
      mounted.current = false;
      generation.current++;
      inFlight.current = null;
      window.clearInterval(timer);
    };
  }, [refreshWeather]);

  const value = useMemo(() => ({ weather, loading, error, refreshWeather }), [weather, loading, error, refreshWeather]);
  return <WeatherContext.Provider value={value}>{children}</WeatherContext.Provider>;
}

export function useWeather() {
  const context = useContext(WeatherContext);
  if (!context) throw new Error("useWeather must be used within a WeatherProvider");
  return context;
}
