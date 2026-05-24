const fs = require("fs");
const path = require("path");
const { getOrOpenWorkspaceBySlug, getDefaultWorkspaceSlug } = require("./workspaces");

function resolveBackupDb(slug) {
  return getOrOpenWorkspaceBySlug(slug || getDefaultWorkspaceSlug());
}

const dataDir = path.join(__dirname, "..", "data");
const backupsDir = path.join(dataDir, "backups");
const configPath = path.join(dataDir, "backup-config.json");

const DEFAULT_CONFIG = {
  enabled: false,
  intervalMinutes: 60,
  maxBackups: 30,
};

let timer = null;

function ensureDirs() {
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
}

function readConfig() {
  ensureDirs();
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return {
        ...DEFAULT_CONFIG,
        ...raw,
        intervalMinutes: Math.max(5, Math.min(10080, Number(raw.intervalMinutes) || DEFAULT_CONFIG.intervalMinutes)),
        maxBackups: Math.max(1, Math.min(200, Number(raw.maxBackups) || DEFAULT_CONFIG.maxBackups)),
      };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_CONFIG };
}

function writeConfig(config) {
  ensureDirs();
  const next = {
    enabled: Boolean(config.enabled),
    intervalMinutes: Math.max(5, Math.min(10080, Number(config.intervalMinutes) || 60)),
    maxBackups: Math.max(1, Math.min(200, Number(config.maxBackups) || 30)),
  };
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2), "utf8");
  scheduleAutoBackup();
  return next;
}

function backupFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `gis-${stamp}.sqlite`;
}

function pruneOldBackups(maxBackups) {
  const files = listBackupFiles();
  if (files.length <= maxBackups) return;
  const toRemove = files.slice(maxBackups);
  for (const f of toRemove) {
    try {
      fs.unlinkSync(path.join(backupsDir, f.filename));
    } catch {
      /* ignore */
    }
  }
}

function listBackupFiles() {
  ensureDirs();
  return fs
    .readdirSync(backupsDir)
    .filter((f) => f.endsWith(".sqlite") && f.startsWith("gis-"))
    .map((filename) => {
      const full = path.join(backupsDir, filename);
      const stat = fs.statSync(full);
      return {
        id: filename,
        filename,
        size_bytes: stat.size,
        created_at: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

async function runBackup(workspaceSlug) {
  ensureDirs();
  const filename = backupFilename();
  const dest = path.join(backupsDir, filename);
  const db = resolveBackupDb(workspaceSlug);
  await db.backup(dest);
  const config = readConfig();
  pruneOldBackups(config.maxBackups);
  const stat = fs.statSync(dest);
  return {
    id: filename,
    filename,
    size_bytes: stat.size,
    created_at: stat.mtime.toISOString(),
  };
}

function sqlQuotePath(p) {
  return `'${String(p).replace(/'/g, "''")}'`;
}

function restoreBackup(filename, workspaceSlug) {
  if (!/^gis-[\dT-]+\.sqlite$/.test(filename)) {
    throw new Error("Недопустимое имя файла резервной копии");
  }
  const srcPath = path.join(backupsDir, filename);
  if (!fs.existsSync(srcPath)) throw new Error("Файл резервной копии не найден");

  const db = resolveBackupDb(workspaceSlug);
  const attach = `restore_src`;
  const quoted = sqlQuotePath(path.resolve(srcPath));

  const tx = db.transaction(() => {
    db.pragma("foreign_keys", "OFF");
    db.exec(`ATTACH DATABASE ${quoted} AS ${attach}`);
    try {
      db.exec("DELETE FROM fiber_orders");
      db.exec("DELETE FROM edges");
      db.exec("DELETE FROM nodes");
      db.exec("DELETE FROM projects");

      db.exec(`INSERT INTO projects SELECT * FROM ${attach}.projects`);
      db.exec(`INSERT INTO nodes SELECT * FROM ${attach}.nodes`);
      db.exec(`INSERT INTO edges SELECT * FROM ${attach}.edges`);
      db.exec(`INSERT INTO fiber_orders SELECT * FROM ${attach}.fiber_orders`);
    } finally {
      db.exec(`DETACH DATABASE ${attach}`);
    }
    db.pragma("foreign_keys", "ON");

    for (const table of ["projects", "nodes", "edges", "fiber_orders"]) {
      const { m } = db.prepare(`SELECT IFNULL(MAX(id), 0) AS m FROM ${table}`).get();
      db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(table);
      if (m > 0) db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run(table, m);
    }
  });

  tx();
  return { ok: true };
}

function getBackupInfo(filename) {
  if (!/^gis-[\dT-]+\.sqlite$/.test(filename)) {
    throw new Error("Недопустимое имя файла резервной копии");
  }
  const srcPath = path.join(backupsDir, filename);
  if (!fs.existsSync(srcPath)) throw new Error("Файл резервной копии не найден");
  const Database = require("better-sqlite3");
  const src = new Database(srcPath, { readonly: true });
  try {
    return {
      projects: src.prepare("SELECT COUNT(*) AS c FROM projects").get().c,
      nodes: src.prepare("SELECT COUNT(*) AS c FROM nodes").get().c,
      edges: src.prepare("SELECT COUNT(*) AS c FROM edges").get().c,
    };
  } finally {
    src.close();
  }
}

function getBackupFilePath(filename) {
  if (!/^gis-[\dT-]+\.sqlite$/.test(filename)) {
    throw new Error("Недопустимое имя файла");
  }
  const full = path.join(backupsDir, filename);
  if (!fs.existsSync(full)) throw new Error("Файл не найден");
  return full;
}

function deleteBackup(filename) {
  if (!/^gis-[\dT-]+\.sqlite$/.test(filename)) {
    throw new Error("Недопустимое имя файла");
  }
  const full = path.join(backupsDir, filename);
  if (!fs.existsSync(full)) throw new Error("Файл не найден");
  fs.unlinkSync(full);
}

function scheduleAutoBackup() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const config = readConfig();
  if (!config.enabled) return;
  const ms = config.intervalMinutes * 60 * 1000;
  timer = setInterval(() => {
    runBackup().catch((err) => console.error("[backup]", err.message || err));
  }, ms);
  console.log(`[backup] авто-резерв каждые ${config.intervalMinutes} мин.`);
}

function initBackupScheduler() {
  ensureDirs();
  scheduleAutoBackup();
}

module.exports = {
  readConfig,
  writeConfig,
  listBackupFiles,
  runBackup,
  restoreBackup,
  deleteBackup,
  getBackupInfo,
  getBackupFilePath,
  initBackupScheduler,
};
