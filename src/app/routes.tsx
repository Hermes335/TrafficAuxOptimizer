import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { LoadingState } from "./components/LoadingState";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";

// Lazy load all pages for better startup performance
const Dashboard = lazy(() => import("./pages/Dashboard").then(m => ({ default: m.Dashboard })));
const GanttChart = lazy(() => import("./pages/GanttChart").then(m => ({ default: m.GanttChart })));
const Optimization = lazy(() => import("./pages/Optimization").then(m => ({ default: m.Optimization })));
const OptimizationEngine = lazy(() => import("./pages/OptimizationEngine").then(m => ({ default: m.OptimizationEngine })));
const OptimizationRunning = lazy(() => import("./pages/OptimizationRunning").then(m => ({ default: m.OptimizationRunning })));
const Scenarios = lazy(() => import("./pages/Scenarios").then(m => ({ default: m.Scenarios })));
const ComponentLibrary = lazy(() => import("./pages/ComponentLibrary").then(m => ({ default: m.ComponentLibrary })));
const IncidentReport = lazy(() => import("./pages/IncidentReport").then(m => ({ default: m.IncidentReport })));
const Analytics = lazy(() => import("./pages/Analytics").then(m => ({ default: m.Analytics })));
const AuditLogs = lazy(() => import("./pages/AuditLogs").then(m => ({ default: m.AuditLogs })));
const Settings = lazy(() => import("./pages/Settings").then(m => ({ default: m.Settings })));

// Wrapper to provide loading state for lazy-loaded components
const PageLoader = ({ Component }: { Component: React.ComponentType }) => (
  <Suspense fallback={<LoadingState label="Loading page..." />}>
    <Component />
  </Suspense>
);

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, Component: () => <PageLoader Component={Dashboard} /> },
      { path: "gantt-chart", Component: () => <PageLoader Component={GanttChart} /> },
      { path: "optimization", Component: () => <PageLoader Component={Optimization} /> },
      { path: "optimization-engine", Component: () => <PageLoader Component={OptimizationEngine} /> },
      { path: "optimization-running", Component: () => <PageLoader Component={OptimizationRunning} /> },
      { path: "scenarios", Component: () => <PageLoader Component={Scenarios} /> },
      { path: "component-library", Component: () => <PageLoader Component={ComponentLibrary} /> },
      { path: "incident-report", Component: () => <PageLoader Component={IncidentReport} /> },
      { path: "analytics", Component: () => <PageLoader Component={Analytics} /> },
      { path: "audit-logs", Component: () => <PageLoader Component={AuditLogs} /> },
      { path: "settings", Component: () => <PageLoader Component={Settings} /> },
    ],
  },
]);