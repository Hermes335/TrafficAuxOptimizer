import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router";

const pageTitles: Record<string, string> = {
  "/": "Live operations",
  "/login": "Sign in",
  "/gantt-chart": "Deployment schedule",
  "/optimization": "Create a recommendation",
  "/optimization-running": "Optimization progress",
  "/optimization-engine": "Recommendation results",
  "/incident-report": "Report a road incident",
  "/incident-review": "Review incident reports",
  "/officer-management": "Officer management",
  "/audit-logs": "Audit logs",
  "/settings": "System health",
  "/component-library": "Component library",
};

const focusPageEvent = "app:focus-route-heading";

// Mobile navigation calls this after its focus trap has closed. Closing the
// drawer without navigating continues to restore focus to its opener.
export function requestRouteHeadingFocus() {
  document.dispatchEvent(new Event(focusPageEvent));
}

export function RouteAccessibility() {
  const location = useLocation();
  const runId = new URLSearchParams(location.search).get("run_id");
  // Filters and hash changes should not move someone away from their control.
  const pageKey = location.pathname + (runId ? `?run_id=${runId}` : "");
  const previousPage = useRef(pageKey);

  useEffect(() => {
    const title = pageTitles[location.pathname]
      ?? (location.pathname.startsWith("/incident-report/") ? "Edit incident report" : "Traffic operations");
    document.title = `${title} | TrafficOffOptimizer`;

    let pending = previousPage.current !== pageKey;
    previousPage.current = pageKey;
    let timeout: number | undefined;
    let attempt: number | undefined;
    const observer = new MutationObserver(() => { if (pending) queueAttempt(); });

    function stopWaiting() {
      pending = false;
      observer.disconnect();
      window.clearTimeout(timeout);
    }

    function focusHeading() {
      if (!pending) return;
      // Wait for a mobile drawer (including its closing animation), or any
      // destination dialog that intentionally owns keyboard focus.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const heading = document.querySelector<HTMLElement>("main h1, h1");
      if (!heading || heading.closest('[hidden], [aria-hidden="true"], [style*="display: none"]')) return;
      const main = heading.closest("main");
      const active = document.activeElement;
      // Preserve form autofocus, a focused validation message, or a user's
      // interaction while a lazy page was loading. Do not refocus later.
      if (active && active !== document.body && active !== main && main?.contains(active)) {
        stopWaiting();
        return;
      }
      if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
      heading.focus();
      stopWaiting();
    }

    function queueAttempt() {
      window.clearTimeout(attempt);
      attempt = window.setTimeout(focusHeading, 0);
    }

    function waitForHeading() {
      pending = true;
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "aria-hidden", "style"] });
      window.clearTimeout(timeout);
      // Lazy routes get time to load, without leaving a stale focus request
      // around to interrupt an unrelated action minutes later.
      timeout = window.setTimeout(stopWaiting, 15000);
      queueAttempt();
    }

    if (pending) waitForHeading();
    document.addEventListener(focusPageEvent, waitForHeading);
    return () => {
      stopWaiting();
      window.clearTimeout(attempt);
      document.removeEventListener(focusPageEvent, waitForHeading);
    };
  }, [pageKey, location.pathname]);

  return <Outlet />;
}
