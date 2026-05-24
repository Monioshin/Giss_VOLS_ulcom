const { app, BrowserWindow } = require("electron");
const path = require("path");
const http = require("http");
const net = require("net");
const { spawn } = require("child_process");
const { loadDesktopConfig } = require("./config.cjs");

let backendProcess = null;
let backendSpawnedByElectron = false;
let desktopConfig = { apiUrl: "http://localhost:4000", path: null };

if (app?.disableHardwareAcceleration) app.disableHardwareAcceleration();

/** Собранное приложение грузит UI с file:// — без этого fetch на http://192.168.x.x может давать Failed to fetch. */
if (app.isPackaged || process.env.GIS_LOAD_DIST === "1") {
  app.commandLine.appendSwitch("disable-features", "BlockInsecurePrivateNetworkRequests");
}

const isDevFrontend = Boolean(process.env.FRONTEND_URL);
const loadPackagedDist = app.isPackaged || process.env.GIS_LOAD_DIST === "1";

function shouldStartLocalBackend() {
  if (process.env.GIS_START_LOCAL_BACKEND === "1") return true;
  if (process.env.GIS_START_LOCAL_BACKEND === "0") return false;
  if (app.isPackaged) return false;
  if (loadPackagedDist && process.env.GIS_START_LOCAL_BACKEND !== "1") return false;
  return isDevFrontend;
}

function parseApiTarget(apiUrl) {
  try {
    const u = new URL(apiUrl);
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    const hosts = new Set();
    if (u.hostname === "localhost" || u.hostname === "::1") {
      hosts.add("127.0.0.1");
    } else {
      hosts.add(u.hostname);
    }
    hosts.add("127.0.0.1");
    return { port, hosts: [...hosts] };
  } catch {
    return { port: Number(process.env.PORT) || 4000, hosts: ["127.0.0.1"] };
  }
}

function probeBackendOnHost(host, port) {
  return new Promise((resolve) => {
    const healthUrl = `http://${host}:${port}/health`;
    const req = http.get(healthUrl, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    const probeMs = Number(process.env.GIS_HEALTH_PROBE_MS) || 3000;
    req.setTimeout(probeMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (open) => {
      socket.removeAllListeners();
      if (!socket.destroyed) socket.destroy();
      resolve(open);
    };
    const probeMs = Number(process.env.GIS_HEALTH_PROBE_MS) || 3000;
    socket.setTimeout(probeMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function backendAlreadyReachable(apiUrl) {
  const { port, hosts } = parseApiTarget(apiUrl);
  for (const host of hosts) {
    if (await probeBackendOnHost(host, port)) return { ok: true, reason: "health" };
  }
  for (const host of hosts) {
    if (await isPortOpen(host, port)) return { ok: true, reason: "port" };
  }
  return { ok: false };
}

function startBackend() {
  if (!shouldStartLocalBackend()) return;
  const backendEntry = path.join(__dirname, "..", "..", "backend", "src", "server.js");
  backendProcess = spawn(process.env.BACKEND_NODE || "node", [backendEntry], {
    stdio: "inherit",
    env: { ...process.env, PORT: process.env.PORT || "4000" },
  });
  backendSpawnedByElectron = true;
}

async function ensureLocalBackend() {
  if (!shouldStartLocalBackend()) return;
  const apiUrl = desktopConfig.apiUrl || `http://127.0.0.1:${process.env.PORT || "4000"}`;
  const existing = await backendAlreadyReachable(apiUrl);
  if (existing.ok) {
    if (existing.reason === "health") {
      console.log(`Используется уже запущенный backend: ${apiUrl}`);
    } else {
      console.log(
        `Порт ${parseApiTarget(apiUrl).port} уже занят — второй backend не запускаем (используйте существующий сервер на ${apiUrl}).`,
      );
    }
    return;
  }
  startBackend();
}

function preloadArgs() {
  const enc = encodeURIComponent;
  const exeDir = path.dirname(process.execPath);
  return [
    `--gis-exe-dir=${enc(exeDir)}`,
    `--gis-api-url=${enc(desktopConfig.apiUrl)}`,
    `--gis-config-path=${enc(desktopConfig.path ?? "null")}`,
  ];
}

function createWindow() {
  const preloadPath = path.join(__dirname, "preload.cjs");
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: "GIS · ВОЛС",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      additionalArguments: preloadArgs(),
    },
    backgroundColor: "#f5f5f5",
  });

  if (isDevFrontend && !loadPackagedDist) {
    const url = process.env.FRONTEND_URL || "http://127.0.0.1:5173";
    win.webContents.on("did-fail-load", (_event, code, description) => {
      console.error(`Failed to load ${url}: [${code}] ${description}`);
    });
    win.loadURL(url);
    return;
  }

  const indexHtml = path.join(__dirname, "..", "dist", "index.html");
  win.loadFile(indexHtml);
}

app.whenReady().then(async () => {
  desktopConfig = loadDesktopConfig({
    execPath: process.execPath,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath("userData"),
  });
  console.log(`GIS desktop → API ${desktopConfig.apiUrl}`);
  if (desktopConfig.path) console.log(`Конфиг: ${desktopConfig.path}`);

  await ensureLocalBackend();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (backendSpawnedByElectron && backendProcess && !backendProcess.killed) {
    backendProcess.kill("SIGTERM");
  }
  if (process.platform !== "darwin") app.quit();
});
