const express = require("express");

const BACKEND_PORT = 3001;
const BACKEND_HOST = "127.0.0.1";

const dashboardSnapshot = {
  cityLabel: "Iloilo City, Philippines",
  bottlenecks: [
    { id: "B-001", name: "University of Iloilo - Main", status: "normal", x: 45, y: 25 },
    { id: "B-003", name: "Jaro Plaza Intersection", status: "normal", x: 30, y: 35 },
    { id: "B-012", name: "General Luna St. Bridge", status: "critical", badge: "ACTIVE INCIDENT", x: 52, y: 48 },
    { id: "B-018", name: "SM City Iloilo Diversion", status: "critical", x: 65, y: 62 },
    { id: "B-020", name: "Molo Church Perimeter", status: "normal", x: 35, y: 55 },
    { id: "B-022", name: "Iloilo Terminal Market", status: "normal", x: 42, y: 68 },
    { id: "B-025", name: "Location Area 1", status: "normal", x: 58, y: 32 },
    { id: "B-026", name: "Location Area 2", status: "warning", x: 48, y: 75 },
    { id: "B-027", name: "Location Area 3", status: "normal", x: 38, y: 42 },
    { id: "B-028", name: "Location Area 4", status: "warning", x: 55, y: 55 },
  ],
  incidents: [
    { id: 1, text: "Critical: Vehicle Collision - B-012 General Luna Bridge", type: "critical" },
    { id: 2, text: "Major: Road Closure - B-018 SM City Diversion", type: "major" },
    { id: 3, text: "Minor: Construction Work - B-005 Molo District", type: "minor" },
  ],
  metrics: {
    coverageEfficiency: 85,
    avgResponseTimeMinutes: 12,
    resourceUtilization: 78,
    weatherCorrelation: 0.82,
  },
};

function createBackendServer() {
  const app = express();

  app.use(express.json());
  app.use((_, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (res.req && res.req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get("/api/health", (_, res) => {
    res.json({
      status: "ok",
      app: "TrafficAuxOptimizer Desktop Backend",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/dashboard", (_, res) => {
    res.json(dashboardSnapshot);
  });

  app.get("/api/optimization/status", (_, res) => {
    res.json({
      progress: 72,
      currentGeneration: 720,
      fitnessScore: 89.6,
      status: "running",
      updatedAt: new Date().toISOString(),
    });
  });

  app.post("/api/optimization/run", (req, res) => {
    const { shift = "Afternoon", weatherMode = "Moderate Rain" } = req.body ?? {};

    res.status(202).json({
      runId: `RUN-${Date.now()}`,
      status: "queued",
      shift,
      weatherMode,
      message: "Optimization job accepted by the local backend.",
      estimatedSeconds: 18,
      createdAt: new Date().toISOString(),
    });
  });

  return app;
}

function startBackendServer() {
  const app = createBackendServer();

  return new Promise((resolve, reject) => {
    const server = app.listen(BACKEND_PORT, BACKEND_HOST, () => {
      resolve({
        server,
        port: BACKEND_PORT,
        host: BACKEND_HOST,
        baseUrl: `http://${BACKEND_HOST}:${BACKEND_PORT}`,
      });
    });

    server.on("error", reject);
  });
}

module.exports = {
  BACKEND_PORT,
  startBackendServer,
};
