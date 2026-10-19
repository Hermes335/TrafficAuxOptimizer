const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const pythonPath = require("./python-path.cjs");

function checkBackendRuntime(root, executable = pythonPath(root)) {
  const requirement = fs.readFileSync(path.join(root, "traffic_dss_backend", "requirements.txt"), "utf8")
    .match(/^Django>=(\d+)\.(\d+),<(\d+)\.(\d+)/m);
  if (!requirement) throw new Error("Cannot determine the supported Django range from requirements.txt.");
  const probe = spawnSync(executable, ["-c", "import django; print(django.get_version())"], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 15000,
  });
  const installed = (probe.stdout || "").trim();
  const parsed = installed.match(/^(\d+)\.(\d+)/);
  const minimum = Number(requirement[1]) * 1000 + Number(requirement[2]);
  const maximum = Number(requirement[3]) * 1000 + Number(requirement[4]);
  const current = parsed ? Number(parsed[1]) * 1000 + Number(parsed[2]) : -1;
  if (probe.error || probe.status !== 0 || current < minimum || current >= maximum) {
    throw new Error(`The selected Python (${executable}) has Django ${installed || "unavailable"}; expected ${requirement[0]}. Install traffic_dss_backend/requirements.txt with that interpreter, or select an updated interpreter using TRAFFIC_PYTHON.`);
  }
  return {python: executable, django: installed, requirement: requirement[0]};
}

module.exports = {checkBackendRuntime};
if (require.main === module) {
  try { console.log(JSON.stringify(checkBackendRuntime(path.resolve(__dirname, "..")), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
