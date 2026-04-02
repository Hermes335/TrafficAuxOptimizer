const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("desktopConfig", {
  backendUrl: "http://127.0.0.1:8000",
});
