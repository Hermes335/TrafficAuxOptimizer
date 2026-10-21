import { useEffect, useState } from "react";
import { fetchOptimizationReadiness, type OptimizationReadiness, type OptimizationRunRequest } from "../services/backend";

export function useOptimizationReadiness(parameters: OptimizationRunRequest) {
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify(parameters);
  const key = `${requestKey}:${attempt}`;
  const [state, setState] = useState<{ key: string; data: OptimizationReadiness | null; error: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const request = JSON.parse(requestKey) as OptimizationRunRequest;
      fetchOptimizationReadiness(request)
        .then(data => {
          if (!active) return;
          if (data.operational_date !== request.operational_date || data.shift !== request.shift || data.mode !== request.mode) {
            setState({ key, data: null, error: "Readiness did not match the selected date, shift and mode. Refresh and try again." });
            return;
          }
          setState({ key, data, error: null });
        })
        .catch(error => {
          if (active) setState({ key, data: null, error: error instanceof Error ? error.message : "Unable to check run readiness." });
        });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [key, requestKey]);
  const current = state?.key === key ? state : null;
  return {
    readiness: current?.data ?? null,
    error: current?.error ?? null,
    loading: current === null,
    refresh: () => setAttempt(value => value + 1),
  };
}
