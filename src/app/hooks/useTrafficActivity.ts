import { useEffect } from "react";
import { fetchWithTimeout, getApiBaseUrl } from "../services/backend";

export function useTrafficActivity(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return;
    let inFlight = false;
    let stopped = false;
    const heartbeat = async () => {
      if (stopped || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        await fetchWithTimeout(`${getApiBaseUrl()}/api/traffic/activity/`, {
          method: "POST", timeout: 10000,
        });
      } catch {
        // Activity tracking must not interrupt sign-in or normal app use.
      } finally { inFlight = false; }
    };
    void heartbeat();
    const onVisibility = () => { void heartbeat(); };
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => { void heartbeat(); }, 60000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [signedIn]);
}
