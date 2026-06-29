const { execSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..").toLowerCase();
const ports = [8080, 8000];

function run(command) {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function killPid(pid) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
  } catch {
    // Ignore processes we cannot terminate.
  }
}

function killWindowsPort(port) {
  try {
    const output = run(`netstat -ano | findstr :${port}`);
    const pids = new Set();

    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const columns = line.split(/\s+/);
        const pid = columns[columns.length - 1];
        if (/^\d+$/.test(pid)) {
          pids.add(pid);
        }
      });

    for (const pid of pids) {
      killPid(pid);
    }
  } catch {
    // Port not in use.
  }
}

function getWindowsProcesses() {
  try {
    const raw = run(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"',
    ).trim();

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function killProjectProcesses() {
  const processes = getWindowsProcesses();
  for (const proc of processes) {
    const pid = Number(proc.ProcessId);
    const cmd = String(proc.CommandLine || "").toLowerCase();

    if (!pid || !cmd.includes(projectRoot)) {
      continue;
    }

    const isBackend = cmd.includes("manage.py runserver");
    const isCelery = cmd.includes("-m celery") && cmd.includes("-a config");
    const isElectron = cmd.includes("electron") && cmd.includes("trafficauxoptimizer");

    if (isBackend || isCelery || isElectron) {
      killPid(pid);
    }
  }
}

if (process.platform === "win32") {
  killProjectProcesses();
  for (const port of ports) {
    killWindowsPort(port);
  }
}
