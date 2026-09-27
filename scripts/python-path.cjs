const path = require("node:path");

module.exports = function pythonPath(root, platform = process.platform) {
  return process.env.TRAFFIC_PYTHON || path.join(root, ".venv", ...(platform === "win32"
    ? ["Scripts", "python.exe"] : ["bin", "python"]));
};
