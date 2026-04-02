import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { GanttChart } from "./pages/GanttChart";
import { Optimization } from "./pages/Optimization";
import { ComponentLibrary } from "./pages/ComponentLibrary";
import { IncidentReport } from "./pages/IncidentReport";
import { Analytics } from "./pages/Analytics";
import { AuditLogs } from "./pages/AuditLogs";
import { Settings } from "./pages/Settings";
import { OptimizationEngine } from "./pages/OptimizationEngine";
import { OptimizationRunning } from "./pages/OptimizationRunning";
import { Scenarios } from "./pages/Scenarios";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Dashboard },
      { path: "gantt-chart", Component: GanttChart },
      { path: "optimization", Component: Optimization },
      { path: "optimization-engine", Component: OptimizationEngine },
      { path: "optimization-running", Component: OptimizationRunning },
      { path: "scenarios", Component: Scenarios },
      { path: "component-library", Component: ComponentLibrary },
      { path: "incident-report", Component: IncidentReport },
      { path: "analytics", Component: Analytics },
      { path: "audit-logs", Component: AuditLogs },
      { path: "settings", Component: Settings },
    ],
  },
]);