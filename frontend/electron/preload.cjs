const { contextBridge } = require("electron");
const fs = require("fs");
const path = require("path");

function normalizeApiUrl(url) {
  return url.trim().replace(/\/+$/, "");
}

function readJsonApiUrl(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").trim();
    const data = JSON.parse(raw);
    if (typeof data?.apiUrl === "string" && data.apiUrl.trim()) {
      return { apiUrl: normalizeApiUrl(data.apiUrl), path: filePath };
    }
  } catch {
    return null;
  }
  return null;
}

function configCandidates() {
  const out = [];
  const exeDirArg = process.argv.find((a) => a.startsWith("--gis-exe-dir="));
  if (exeDirArg) {
    try {
      const dir = decodeURIComponent(exeDirArg.slice("--gis-exe-dir=".length));
      out.push(path.join(dir, "gis-desktop.json"));
    } catch {
      /* ignore */
    }
  }
  const argv0 = process.argv[0];
  if (argv0) {
    out.push(path.join(path.dirname(argv0), "gis-desktop.json"));
  }
  const appData = process.env.APPDATA;
  if (appData) {
    out.push(path.join(appData, "GIS VOLS", "gis-desktop.json"));
    out.push(path.join(appData, "gis-desktop.json"));
  }
  return [...new Set(out)];
}

function resolveDesktopApi() {
  if (process.env.GIS_API_URL?.trim()) {
    return {
      apiUrl: normalizeApiUrl(process.env.GIS_API_URL),
      path: "(переменная GIS_API_URL)",
    };
  }

  const apiUrlArg = process.argv.find((a) => a.startsWith("--gis-api-url="));
  const configPathArg = process.argv.find((a) => a.startsWith("--gis-config-path="));

  for (const filePath of configCandidates()) {
    const hit = readJsonApiUrl(filePath);
    if (hit) return hit;
  }

  if (apiUrlArg) {
    const apiUrl = normalizeApiUrl(decodeURIComponent(apiUrlArg.slice("--gis-api-url=".length)));
    const configPath =
      configPathArg && configPathArg !== "--gis-config-path=null"
        ? decodeURIComponent(configPathArg.slice("--gis-config-path=".length))
        : null;
    if (apiUrl !== "http://localhost:4000" || configPath) {
      return { apiUrl, configPath };
    }
  }

  return { apiUrl: "http://localhost:4000", configPath: null };
}

const desktop = resolveDesktopApi();

contextBridge.exposeInMainWorld("gisDesktop", {
  apiUrl: desktop.apiUrl,
  isDesktop: true,
  configPath: desktop.configPath,
});
