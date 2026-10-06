const path = require("node:path");
const { spawn } = require("node:child_process");
const pythonPath = require("./python-path.cjs");
const root = path.resolve(__dirname, "..");

async function main() {
  const service = process.argv[2];
  const commands = {
    backend: ["manage.py", "runserver", `127.0.0.1:${process.env.BACKEND_PORT || 8000}`],
    worker: ["-m", "celery", "-A", "config", "worker", "-l", "info", "--pool=solo"],
    beat: ["-m", "celery", "-A", "config", "beat", "-l", "info"],
  };
  let executable, args, cwd, env = process.env;
  if (service === "desktop-local") {
    const url = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:8080";
    await require("wait-on")({ resources: [url], timeout: 120000 });
    executable = require("electron");
    args = [root];
    cwd = root;
    env = { ...process.env, SKIP_DJANGO_BACKEND: "true" };
  } else if (commands[service]) {
    executable = pythonPath(root);
    args = commands[service];
    cwd = path.join(root, "traffic_dss_backend");
  } else {
    throw new Error("Choose backend, worker, beat, or desktop-local.");
  }
  const child = spawn(executable, args, { cwd, env, stdio: "inherit", windowsHide: true });
  child.on("error", error => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 0; });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
