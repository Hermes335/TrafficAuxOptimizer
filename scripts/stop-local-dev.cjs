#!/usr/bin/env node
/**
 * Stops all processes started by `npm run dev:local`:
 *   - Django backend (port 8000)
 *   - Celery worker / beat
 *   - Vite dev server (port 5173)
 *   - Electron
 */

const { execSync } = require("child_process");

function killByPort(port) {
  try {
    const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    if (!output) return;
    const pids = new Set();
    for (const line of output.split("\n")) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== "0") pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid} /T`, { stdio: "ignore" });
        console.log(`  Killed PID ${pid} on port ${port}`);
      } catch {}
    }
  } catch {}
}

function killByImage(imageName, label) {
  try {
    execSync(`taskkill /F /IM ${imageName} /T`, { stdio: "ignore" });
    console.log(`  Stopped ${label}`);
  } catch {
    // Not running
  }
}

console.log("Stopping local dev processes...\n");

killByPort(8000);
console.log("  Django backend (port 8000) — done");

killByPort(5173);
console.log("  Vite dev server (port 5173) — done");

killByImage("celery.exe", "Celery worker/beat");
killByImage("electron.exe", "Electron");

console.log("\nDone.");
