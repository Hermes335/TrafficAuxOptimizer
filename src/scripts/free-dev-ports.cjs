const { execSync } = require("node:child_process");

const ports = [8080, 8000];

function killWindowsPort(port) {
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
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
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      } catch {
        // Ignore processes we cannot terminate.
      }
    }
  } catch {
    // Port not in use.
  }
}

for (const port of ports) {
  if (process.platform === "win32") {
    killWindowsPort(port);
  }
}
