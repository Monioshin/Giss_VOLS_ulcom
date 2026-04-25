const { app, BrowserWindow } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let backendProcess = null;
// Some environments expose a minimal electron export when run-as-node leaks in.
if (app?.disableHardwareAcceleration) app.disableHardwareAcceleration();

function startBackend() {
  const backendEntry = path.join(__dirname, "..", "..", "backend", "src", "server.js");
  // Use system Node (Electron's Node ABI differs; native addons may break).
  backendProcess = spawn(process.env.BACKEND_NODE || "node", [backendEntry], {
    stdio: "inherit",
    env: { ...process.env, PORT: process.env.PORT || "4000" },
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: "#f5f5f5",
  });

  const url = process.env.FRONTEND_URL || "http://127.0.0.1:5173";
  win.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(`Failed to load ${url}: [${code}] ${description}`);
  });
  win.loadURL(url);
}

app.whenReady().then(() => {
  startBackend();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill("SIGTERM");
  }
  if (process.platform !== "darwin") app.quit();
});

