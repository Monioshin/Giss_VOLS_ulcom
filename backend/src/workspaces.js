const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { initWorkspaceSchema, copyNetworkTables, NETWORK_TABLES } = require("./workspaceSchema");
const { ensureSyncTables } = require("./syncRevision");
const { runWithWorkspaceContext } = require("./requestContext");

const dataDir = path.join(__dirname, "..", "data");
const workspacesDir = path.join(dataDir, "workspaces");
const systemPath = path.join(dataDir, "system.sqlite");
const legacyPath = path.join(dataDir, "gis.sqlite");

const DEFAULT_WORKSPACE_NAME = "ТЕСТ";
const DEFAULT_WORKSPACE_SLUG = "test";

let systemDb = null;
/** @type {Map<string, import('better-sqlite3').Database>} */
const connectionPool = new Map();

function ensureDataDirs() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(workspacesDir)) fs.mkdirSync(workspacesDir, { recursive: true });
}

function slugifyDisplayName(name) {
  const trimmed = String(name ?? "").trim();
  const base = trimmed
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u0400-\u04ff-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (base.length >= 2) return base.slice(0, 48);
  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) hash = (hash * 31 + trimmed.charCodeAt(i)) | 0;
  return `ws-${Math.abs(hash).toString(36).slice(0, 10)}`;
}

function validateWorkspaceName(name) {
  const trimmed = String(name ?? "").trim();
  if (trimmed.length < 2 || trimmed.length > 64) {
    throw new Error("Название базы: от 2 до 64 символов");
  }
  if (!/^[\p{L}\p{N}\s._-]+$/u.test(trimmed)) {
    throw new Error("Название может содержать буквы, цифры, пробелы, дефис и точку");
  }
  return trimmed;
}

function workspaceFilePath(slug) {
  return path.join(workspacesDir, `${slug}.sqlite`);
}

function openSystemDb() {
  ensureDataDirs();
  systemDb = new Database(systemPath);
  systemDb.pragma("journal_mode = WAL");
  systemDb.pragma("busy_timeout = 5000");
  systemDb.pragma("foreign_keys = ON");
  systemDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('ADMIN', 'ARCHITECT', 'USER')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_workspace_prefs (
      user_id INTEGER NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bitrix_edge_incidents (
      workspace_slug TEXT NOT NULL,
      edge_id INTEGER NOT NULL,
      bitrix_task_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (workspace_slug, edge_id)
    );
  `);
  return systemDb;
}

function getSetting(key) {
  const row = systemDb.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
  return row?.value ?? null;
}

function setSetting(key, value) {
  systemDb
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, String(value));
}

function getDefaultWorkspaceId() {
  return Number(getSetting("active_workspace_id") || 0);
}

function getDefaultWorkspaceSlug() {
  const id = getDefaultWorkspaceId();
  const row = systemDb.prepare("SELECT slug FROM workspaces WHERE id = ?").get(id);
  if (!row) throw new Error("База по умолчанию не найдена");
  return row.slug;
}

function getOrOpenWorkspaceBySlug(slug) {
  let db = connectionPool.get(slug);
  if (db) return db;

  const file = workspaceFilePath(slug);
  if (!fs.existsSync(file)) {
    const tmp = new Database(file);
    initWorkspaceSchema(tmp);
    tmp.close();
  }
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  initWorkspaceSchema(db);
  ensureSyncTables(db);
  connectionPool.set(slug, db);
  return db;
}

function closeWorkspaceInPool(slug) {
  const db = connectionPool.get(slug);
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    connectionPool.delete(slug);
  }
}

function migrateUserRolesArchitectOnSystem() {
  const row = systemDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (!row?.sql || row.sql.includes("ARCHITECT")) return;
  systemDb.exec(`
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('ADMIN', 'ARCHITECT', 'USER')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users_new (id, username, password_hash, role, created_at)
      SELECT id, username, password_hash, role, created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
  `);
}

function migrateFromLegacyGisSqlite() {
  if (!fs.existsSync(legacyPath)) return false;
  const legacy = new Database(legacyPath, { readonly: true });
  try {
    migrateUserRolesArchitectOnSystem();
    const users = legacy.prepare("SELECT id, username, password_hash, role, created_at FROM users").all();
    for (const u of users) {
      systemDb
        .prepare(
          `INSERT OR REPLACE INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(u.id, u.username, u.password_hash, u.role, u.created_at);
    }

    const wsPath = workspaceFilePath(DEFAULT_WORKSPACE_SLUG);
    closeWorkspaceInPool(DEFAULT_WORKSPACE_SLUG);
    if (fs.existsSync(wsPath)) fs.unlinkSync(wsPath);
    const workspaceDb = new Database(wsPath);
    initWorkspaceSchema(workspaceDb);
    copyNetworkTables(legacy, workspaceDb);
    workspaceDb.close();

    systemDb.prepare("DELETE FROM workspaces").run();
    systemDb
      .prepare("INSERT INTO workspaces (id, name, slug, created_at) VALUES (1, ?, ?, datetime('now'))")
      .run(DEFAULT_WORKSPACE_NAME, DEFAULT_WORKSPACE_SLUG);
    setSetting("active_workspace_id", "1");

    const bakPath = legacyPath + ".bak";
    if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);
    fs.renameSync(legacyPath, bakPath);
    return true;
  } finally {
    legacy.close();
  }
}

function ensureDefaultWorkspace() {
  let row = systemDb.prepare("SELECT * FROM workspaces WHERE slug = ?").get(DEFAULT_WORKSPACE_SLUG);
  if (!row) {
    const file = workspaceFilePath(DEFAULT_WORKSPACE_SLUG);
    if (!fs.existsSync(file)) {
      const tmp = new Database(file);
      initWorkspaceSchema(tmp);
      tmp.close();
    }
    systemDb
      .prepare("INSERT INTO workspaces (name, slug) VALUES (?, ?)")
      .run(DEFAULT_WORKSPACE_NAME, DEFAULT_WORKSPACE_SLUG);
    row = systemDb.prepare("SELECT * FROM workspaces WHERE slug = ?").get(DEFAULT_WORKSPACE_SLUG);
  }
  if (!getSetting("active_workspace_id")) {
    setSetting("active_workspace_id", String(row.id));
  }
}

function initDatabases() {
  ensureDataDirs();
  openSystemDb();
  migrateUserRolesArchitectOnSystem();

  if (fs.existsSync(legacyPath) && systemDb.prepare("SELECT COUNT(*) AS c FROM workspaces").get().c === 0) {
    migrateFromLegacyGisSqlite();
  }

  ensureDefaultWorkspace();
  getOrOpenWorkspaceBySlug(getDefaultWorkspaceSlug());
}

function getSystemDb() {
  if (!systemDb) throw new Error("system DB not initialized");
  return systemDb;
}

function getWorkspaceDb() {
  const { getWorkspaceContext } = require("./requestContext");
  const ctx = getWorkspaceContext();
  if (ctx?.db) return ctx.db;
  return getOrOpenWorkspaceBySlug(getDefaultWorkspaceSlug());
}

function resolveWorkspaceForUser(userId) {
  const defaultId = getDefaultWorkspaceId();
  const pref = systemDb
    .prepare("SELECT workspace_id FROM user_workspace_prefs WHERE user_id = ?")
    .get(userId);
  const targetId = pref?.workspace_id ?? defaultId;
  const row = systemDb.prepare("SELECT id, name, slug, created_at FROM workspaces WHERE id = ?").get(targetId);
  if (!row) throw new Error("Рабочая база пользователя не найдена");
  return {
    ...row,
    is_mine: true,
    is_server_default: row.id === defaultId,
    is_active: true,
  };
}

function attachWorkspaceContextForRequest(req) {
  let userId = req.authUser?.id;
  if (req.embedMap) {
    userId = req.embedMap.embedIssuerUserId ?? null;
  }
  if (!userId) {
    const slug = getDefaultWorkspaceSlug();
    const db = getOrOpenWorkspaceBySlug(slug);
    const defaultId = getDefaultWorkspaceId();
    const row = systemDb.prepare("SELECT id, name, slug, created_at FROM workspaces WHERE slug = ?").get(slug);
    return {
      db,
      slug,
      workspaceId: row?.id ?? defaultId,
      workspace: row
        ? { ...row, is_mine: false, is_server_default: true, is_active: true }
        : null,
    };
  }
  const ws = resolveWorkspaceForUser(userId);
  const db = getOrOpenWorkspaceBySlug(ws.slug);
  return { db, slug: ws.slug, workspaceId: ws.id, workspace: ws };
}

function attachWorkspaceMiddleware(req, res, next) {
  if (!req.authUser) return next();
  try {
    const ctx = attachWorkspaceContextForRequest(req);
    req.workspaceDb = ctx.db;
    req.workspaceSlug = ctx.slug;
    req.workspaceMeta = ctx;
    runWithWorkspaceContext(ctx, () => next());
  } catch (err) {
    res.status(500).json({ message: err.message || String(err) });
  }
}

function listWorkspaces() {
  const defaultId = getDefaultWorkspaceId();
  return systemDb
    .prepare("SELECT id, name, slug, created_at FROM workspaces ORDER BY id ASC")
    .all()
    .map((w) => ({
      ...w,
      is_active: w.id === defaultId,
      is_server_default: w.id === defaultId,
    }));
}

function listWorkspacesForUser(userId) {
  const defaultId = getDefaultWorkspaceId();
  const pref = systemDb
    .prepare("SELECT workspace_id FROM user_workspace_prefs WHERE user_id = ?")
    .get(userId);
  const mineId = pref?.workspace_id ?? defaultId;
  return systemDb
    .prepare("SELECT id, name, slug, created_at FROM workspaces ORDER BY id ASC")
    .all()
    .map((w) => ({
      ...w,
      is_mine: w.id === mineId,
      is_server_default: w.id === defaultId,
      is_active: w.id === mineId,
    }));
}

function getActiveWorkspace() {
  const defaultId = getDefaultWorkspaceId();
  const row = systemDb.prepare("SELECT id, name, slug, created_at FROM workspaces WHERE id = ?").get(defaultId);
  if (!row) throw new Error("База по умолчанию не найдена");
  return { ...row, is_active: true, is_server_default: true, is_mine: false };
}

function getUserWorkspace(userId) {
  return resolveWorkspaceForUser(userId);
}

function setActiveWorkspaceByName(displayName) {
  const name = validateWorkspaceName(displayName);
  const row = systemDb.prepare("SELECT * FROM workspaces WHERE name = ? COLLATE NOCASE").get(name);
  if (!row) throw new Error(`База «${name}» не найдена`);
  setSetting("active_workspace_id", String(row.id));
  getOrOpenWorkspaceBySlug(row.slug);
  return getActiveWorkspace();
}

function setUserWorkspaceByName(userId, displayName) {
  const name = validateWorkspaceName(displayName);
  const row = systemDb.prepare("SELECT * FROM workspaces WHERE name = ? COLLATE NOCASE").get(name);
  if (!row) throw new Error(`База «${name}» не найдена`);
  systemDb
    .prepare(
      `INSERT INTO user_workspace_prefs (user_id, workspace_id) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET workspace_id = excluded.workspace_id`,
    )
    .run(userId, row.id);
  getOrOpenWorkspaceBySlug(row.slug);
  return resolveWorkspaceForUser(userId);
}

function createWorkspace(displayName) {
  const name = validateWorkspaceName(displayName);
  const existing = systemDb.prepare("SELECT id FROM workspaces WHERE name = ? COLLATE NOCASE").get(name);
  if (existing) throw new Error(`База «${name}» уже существует`);

  let slug = slugifyDisplayName(name);
  let n = 0;
  while (
    fs.existsSync(workspaceFilePath(slug)) ||
    systemDb.prepare("SELECT id FROM workspaces WHERE slug = ?").get(slug)
  ) {
    n += 1;
    slug = `${slugifyDisplayName(name)}-${n}`;
  }

  const tmp = new Database(workspaceFilePath(slug));
  initWorkspaceSchema(tmp);
  ensureSyncTables(tmp);
  tmp.pragma("busy_timeout = 5000");
  tmp.close();

  const result = systemDb.prepare("INSERT INTO workspaces (name, slug) VALUES (?, ?)").run(name, slug);
  const created = systemDb
    .prepare("SELECT id, name, slug, created_at FROM workspaces WHERE id = ?")
    .get(result.lastInsertRowid);
  const defaultId = getDefaultWorkspaceId();
  return { ...created, is_active: false, is_server_default: created.id === defaultId, is_mine: false };
}

function unlinkWorkspaceFiles(slug) {
  const base = workspaceFilePath(slug);
  for (const file of [`${base}`, `${base}-wal`, `${base}-shm`]) {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    }
  }
}

function deleteWorkspace(displayName) {
  const name = validateWorkspaceName(displayName);
  const count = systemDb.prepare("SELECT COUNT(*) AS c FROM workspaces").get().c;
  if (count <= 1) {
    throw new Error("Нельзя удалить единственную базу данных");
  }

  const row = systemDb.prepare("SELECT * FROM workspaces WHERE name = ? COLLATE NOCASE").get(name);
  if (!row) throw new Error(`База «${name}» не найдена`);

  const defaultId = getDefaultWorkspaceId();
  const wasDefault = row.id === defaultId;

  closeWorkspaceInPool(row.slug);
  systemDb.prepare("DELETE FROM user_workspace_prefs WHERE workspace_id = ?").run(row.id);
  systemDb.prepare("DELETE FROM workspaces WHERE id = ?").run(row.id);
  unlinkWorkspaceFiles(row.slug);

  if (wasDefault) {
    const next = systemDb.prepare("SELECT id, name, slug, created_at FROM workspaces ORDER BY id ASC LIMIT 1").get();
    if (!next) throw new Error("После удаления не осталось баз данных");
    setSetting("active_workspace_id", String(next.id));
    getOrOpenWorkspaceBySlug(next.slug);
    return {
      deleted: { id: row.id, name: row.name, slug: row.slug },
      active: { ...next, is_active: true, is_server_default: true },
    };
  }

  return {
    deleted: { id: row.id, name: row.name, slug: row.slug },
    active: getActiveWorkspace(),
  };
}

function createDbProxy(getDbFn) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        const real = getDbFn();
        const value = real[prop];
        if (typeof value === "function") return value.bind(real);
        return value;
      },
    },
  );
}

/** @deprecated use getOrOpenWorkspaceBySlug */
function loadActiveWorkspaceDb() {
  return getOrOpenWorkspaceBySlug(getDefaultWorkspaceSlug());
}

module.exports = {
  initDatabases,
  getSystemDb,
  getWorkspaceDb,
  getOrOpenWorkspaceBySlug,
  getDefaultWorkspaceSlug,
  listWorkspaces,
  listWorkspacesForUser,
  getActiveWorkspace,
  getUserWorkspace,
  setActiveWorkspaceByName,
  setUserWorkspaceByName,
  createWorkspace,
  deleteWorkspace,
  validateWorkspaceName,
  attachWorkspaceMiddleware,
  attachWorkspaceContextForRequest,
  resolveWorkspaceForUser,
  NETWORK_TABLES,
  dataDir,
  workspacesDir,
  createDbProxy,
  loadActiveWorkspaceDb,
  closeWorkspaceInPool,
};
