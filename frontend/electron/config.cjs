const fs = require("fs");
const path = require("path");

const APP_FOLDER_NAME = "GIS VOLS";

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").trim();
    const data = JSON.parse(raw);
    if (!data || typeof data.apiUrl !== "string" || !data.apiUrl.trim()) return null;
    return { apiUrl: data.apiUrl.trim(), path: filePath };
  } catch {
    return null;
  }
}

/**
 * @param {{ execPath: string, resourcesPath?: string, userDataPath?: string }} ctx
 */
function loadDesktopConfig(ctx) {
  if (process.env.GIS_API_URL?.trim()) {
    return {
      apiUrl: process.env.GIS_API_URL.trim(),
      path: "(переменная GIS_API_URL)",
    };
  }

  const candidates = [];
  if (ctx.resourcesPath) {
    candidates.push(path.join(ctx.resourcesPath, "gis-desktop.json"));
  }
  candidates.push(path.join(path.dirname(ctx.execPath), "gis-desktop.json"));
  if (ctx.userDataPath) {
    candidates.push(path.join(ctx.userDataPath, "gis-desktop.json"));
    candidates.push(path.join(ctx.userDataPath, APP_FOLDER_NAME, "gis-desktop.json"));
  }

  for (const file of candidates) {
    const hit = readJsonFile(file);
    if (hit) return hit;
  }

  return {
    apiUrl: "http://localhost:4000",
    path: null,
  };
}

module.exports = { loadDesktopConfig, APP_FOLDER_NAME };
