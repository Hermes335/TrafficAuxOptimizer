const path = require("path");
const { spawn } = require("child_process");
const { app, BrowserWindow } = require("electron");

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 8000);
const BACKEND_BASE_URL = `http://127.0.0.1:${BACKEND_PORT}`;

let mainWindow;
let backendProcess;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBackendReady(baseUrl) {
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health/`);
      if (response.ok) {
        return;
      }
    } catch {
      // keep waiting
    }
    await wait(250);
  }
  throw new Error(`Django backend did not become ready at ${baseUrl}`);
}

function startDjangoBackend() {
  if (process.env.SKIP_DJANGO_BACKEND === "true") {
    return null;
  }

  const projectRoot = path.resolve(__dirname, "..");
  const djangoRoot = path.join(projectRoot, "traffic_dss_backend");
  const pythonExe = path.join(projectRoot, ".venv", "Scripts", "python.exe");

  backendProcess = spawn(
    pythonExe,
    ["manage.py", "runserver", `127.0.0.1:${BACKEND_PORT}`, "--noreload"],
    {
      cwd: djangoRoot,
      windowsHide: true,
      stdio: "ignore",
    },
  );

  backendProcess.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`Django backend exited with code ${code}`);
    }
  });

  return backendProcess;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 840,
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  } else {
    mainWindow.loadURL(DEV_SERVER_URL);
    if (process.env.ELECTRON_OPEN_DEVTOOLS === "true") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function bootstrap() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  await app.whenReady();
  startDjangoBackend();
  await waitForBackendReady(BACKEND_BASE_URL);
  app.commandLine.appendSwitch("disable-http-cache");
  createWindow();
}

app.on("before-quit", () => {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

bootstrap().catch((error) => {
  console.error("Failed to bootstrap desktop app:", error);
  app.quit();
});

module.exports = {
  BACKEND_BASE_URL,
};
