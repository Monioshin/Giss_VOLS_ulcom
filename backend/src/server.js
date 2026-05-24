const express = require("express");
const cors = require("cors");
const compression = require("compression");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { db, systemDb, parseRow, seedIfEmpty } = require("./db");
const {
  listWorkspaces,
  listWorkspacesForUser,
  getActiveWorkspace,
  getUserWorkspace,
  setActiveWorkspaceByName,
  setUserWorkspaceByName,
  createWorkspace,
  deleteWorkspace,
  attachWorkspaceMiddleware,
  getOrOpenWorkspaceBySlug,
} = require("./workspaces");
const { bumpDataRevision, getDataRevision } = require("./syncRevision");
const { listActivityEvents } = require("./activityLog");
const {
  checkExpectedUpdatedAt,
  afterWorkspaceMutation,
  requireDataWrite,
} = require("./workspaceMutations");
const { getWorkspaceContext } = require("./requestContext");
const { buildKml } = require("./kml");
const { syncEdgeGeomBbox, backfillEdgeBboxes } = require("./geomBbox");
const {
  readConfig: readBackupConfig,
  writeConfig: writeBackupConfig,
  listBackupFiles,
  runBackup,
  restoreBackup,
  deleteBackup,
  getBackupInfo,
  getBackupFilePath,
  initBackupScheduler,
} = require("./backup");
const { readAppConfig, writeAppConfig } = require("./appConfig");
const { exportNodesGeoJson, parseGeoJsonImport } = require("./geojson");
const { findOpticalRoutes, isOpticalEndpointNodeType } = require("./routesEngine");
const {
  rebalanceMuftasOnTk,
  rebalanceMuftasAfterImport,
  rebalanceAllMuftaTk,
  isNearTkCenter,
  muftaAttachDistanceError,
} = require("./muftaTkLayout");
const { registerBitrixRoutes } = require("./integrations/bitrix/routes");
const { createKanalLink, createKanalLinksBulk } = require("./kanalLink");
const { notifyBitrixAccident, notifyBitrixDealFiberOrder } = require("./integrations/bitrix/outbound");
const PORT = process.env.PORT || 4000;
/** 0.0.0.0 — доступ с других ПК в LAN; 127.0.0.1 — только с этого Mac. */
const HOST = process.env.HOST || "0.0.0.0";
const MUFTA_ATTACH_MAX_METERS = 2;

const JWT_SECRET = process.env.JWT_SECRET || "gis-local-dev-secret-change-in-production";
const API_VERSION = "mvp-2026-05-14-auth-users";

const fiberCableStatusSchema = z.enum(["READY", "IN_WORK", "OFFLINE", "ACCIDENT", "CONSTRUCTION"]);

const app = express();
const { installRouteSafety } = require("./routeSafety");
installRouteSafety(app);
const { requireEditor, requireAdmin } = require("./roles");

app.use(cors());
app.use(compression({ threshold: 1024 }));
/** Импорт JSON/Excel через /database/import* — большие базы (десятки МБ). */
const BODY_LIMIT = process.env.BODY_LIMIT || "50mb";
app.use(express.json({ limit: BODY_LIMIT }));
seedIfEmpty();
try {
  rebalanceAllMuftaTk(db, MUFTA_ATTACH_MAX_METERS);
} catch (e) {
  console.warn("mufta layout startup:", e.message || e);
}

function requireAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Нужен вход в систему" });
  }
  const token = h.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.typ === "embed_map" && payload.scope === "read") {
      req.authUser = { id: 0, username: "embed", role: "USER" };
      req.embedMap = {
        highlightEdgeId: payload.edgeId ?? null,
        highlightNodeId: payload.nodeId ?? null,
        highlightProjectId: payload.projectId ?? null,
        embedIssuerUserId:
          typeof payload.sub === "number"
            ? payload.sub
            : typeof payload.sub === "string" && /^\d+$/.test(payload.sub)
              ? Number(payload.sub)
              : null,
      };
      return attachWorkspaceMiddleware(req, res, next);
    }
    const user = systemDb.prepare("SELECT id, username, role FROM users WHERE id = ?").get(payload.sub);
    if (!user) return res.status(401).json({ message: "Пользователь не найден" });
    req.authUser = user;
    return attachWorkspaceMiddleware(req, res, next);
  } catch {
    return res.status(401).json({ message: "Недействительный или просроченный токен" });
  }
}

function signUserToken(userRow) {
  return jwt.sign({ sub: userRow.id, role: userRow.role }, JWT_SECRET, { expiresIn: "30d" });
}

const nodeSchema = z.object({
  type: z.enum(["TK", "MUFTA", "PIKET", "KROSS"]),
  name: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  parent_tk_id: z.number().int().positive().nullable().optional(),
  passport_data: z.record(z.string(), z.unknown()).optional(),
});

const projectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

const edgeSchema = z.object({
  type: z.enum(["KANALIZACIYA", "OPTOVOLOKNO"]),
  start_node_id: z.number().int().positive(),
  end_node_id: z.number().int().positive(),
  length_m: z.number().positive(),
  geometry: z.array(z.tuple([z.number(), z.number()])).min(2),
  project_id: z.number().int().positive().nullable().optional(),
  cable_name: z.string().optional().nullable(),
  total_fibers: z.number().int().nonnegative().optional().nullable(),
  used_fibers: z.number().int().nonnegative().optional().nullable(),
  cable_status: fiberCableStatusSchema.optional().nullable(),
  passport_data: z.record(z.string(), z.unknown()).optional(),
});

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, version: API_VERSION });
});

const registerSchema = z.object({
  username: z.string().min(2).max(64).trim(),
  password: z.string().min(4).max(128),
});

app.post("/auth/register", (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const { username, password } = parsed.data;
  const taken = systemDb.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (taken) return res.status(400).json({ message: "Такой логин уже занят" });
  const hash = bcrypt.hashSync(password, 10);
  const result = systemDb.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'USER')").run(username, hash);
  const user = systemDb.prepare("SELECT id, username, role FROM users WHERE id = ?").get(result.lastInsertRowid);
  const token = signUserToken(user);
  res.status(201).json({ token, user });
});

app.post("/auth/login", (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const { username, password } = parsed.data;
  const row = systemDb.prepare("SELECT id, username, role, password_hash FROM users WHERE username = ?").get(username);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ message: "Неверный логин или пароль" });
  }
  const user = { id: row.id, username: row.username, role: row.role };
  res.json({ token: signUserToken(user), user });
});

app.get("/auth/me", (req, res) => {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return res.json({ user: null });
  try {
    const payload = jwt.verify(h.slice(7), JWT_SECRET);
    if (payload.typ === "embed_map" && payload.scope === "read") {
      return res.json({
        user: {
          id: 0,
          username: "embed",
          role: "USER",
          embed: true,
          embedIssuerUserId:
            typeof payload.sub === "number"
              ? payload.sub
              : typeof payload.sub === "string" && /^\d+$/.test(payload.sub)
                ? Number(payload.sub)
                : null,
        },
        embed: {
          highlightEdgeId: payload.edgeId ?? null,
          highlightNodeId: payload.nodeId ?? null,
          highlightProjectId: payload.projectId ?? null,
        },
      });
    }
    const user = systemDb.prepare("SELECT id, username, role FROM users WHERE id = ?").get(payload.sub);
    return res.json({ user: user || null });
  } catch {
    return res.json({ user: null });
  }
});

app.get("/users", requireAuth, (_req, res) => {
  const rows = systemDb.prepare("SELECT id, username, role, created_at FROM users ORDER BY id ASC").all();
  res.json(rows);
});

const userRolePatchSchema = z.object({
  role: z.enum(["ADMIN", "ARCHITECT", "USER"]),
});

app.patch("/users/:id", requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid ID" });
  const parsed = userRolePatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const target = systemDb.prepare("SELECT id, username, role FROM users WHERE id = ?").get(id);
  if (!target) return res.status(404).json({ message: "Пользователь не найден" });
  if (id === req.authUser.id && parsed.data.role !== "ADMIN") {
    return res.status(400).json({ message: "Нельзя снять с себя роль администратора" });
  }
  systemDb.prepare("UPDATE users SET role = ? WHERE id = ?").run(parsed.data.role, id);
  const updated = systemDb.prepare("SELECT id, username, role, created_at FROM users WHERE id = ?").get(id);
  res.json(updated);
});

const userCreateSchema = z.object({
  username: z.string().min(2).max(64).trim(),
  password: z.string().min(4).max(128),
  role: z.enum(["ADMIN", "ARCHITECT", "USER"]).optional(),
});

app.post("/users", requireAuth, requireAdmin, (req, res) => {
  const parsed = userCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const { username, password, role = "USER" } = parsed.data;
  const taken = systemDb.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (taken) return res.status(400).json({ message: "Такой логин уже занят" });
  const hash = bcrypt.hashSync(password, 10);
  const result = systemDb
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
    .run(username, hash, role);
  const created = systemDb.prepare("SELECT id, username, role, created_at FROM users WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(created);
});

app.delete("/users/:id", requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid ID" });
  if (id === req.authUser.id) return res.status(400).json({ message: "Нельзя удалить свою учётную запись" });
  const target = systemDb.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!target) return res.status(404).json({ message: "Пользователь не найден" });
  systemDb.prepare("DELETE FROM users WHERE id = ?").run(id);
  res.status(204).send();
});

const userResetPasswordSchema = z.object({
  password: z.string().min(4).max(128),
});

app.post("/users/:id/reset-password", requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid ID" });
  const parsed = userResetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const target = systemDb.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!target) return res.status(404).json({ message: "Пользователь не найден" });
  const hash = bcrypt.hashSync(parsed.data.password, 10);
  systemDb.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
  res.json({ ok: true });
});

app.get("/routes", requireAuth, (req, res) => {
  const startId = Number(req.query.start_node_id);
  const endId = Number(req.query.end_node_id);
  const requiredFreeFibers = Number(req.query.required_free_fibers || 1);
  if (!Number.isInteger(startId) || !Number.isInteger(endId) || !Number.isInteger(requiredFreeFibers)) {
    return res.status(400).json({ message: "Invalid route query" });
  }
  const r = findOpticalRoutes(db, parseRow, startId, endId, requiredFreeFibers);
  if (!r.ok) return res.status(400).json({ message: r.message });
  res.json({ routes: r.routes });
});

app.get("/projects", requireAuth, (_req, res) => {
  const rows = db
    .prepare("SELECT id, name, description, created_at, passport_data, updated_at FROM projects ORDER BY id DESC")
    .all()
    .map((row) => parseRow(row));
  res.json(rows);
});

app.delete("/projects/:id", requireAuth, requireDataWrite, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid ID" });
  const existing = db.prepare("SELECT id FROM projects WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ message: "Project not found" });

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM edges WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  });
  tx();
  afterWorkspaceMutation(req, "project", id, "delete");
  res.status(204).send();
});

const projectUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  passport_data: z.record(z.unknown()).optional(),
});

app.put("/projects/:id", requireAuth, requireDataWrite, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid ID" });
  const parsed = projectUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ message: "Project not found" });

  const conflict = checkExpectedUpdatedAt(existing, req.body.expected_updated_at);
  if (conflict) return res.status(conflict.status).json(conflict.body);

  const nextName = parsed.data.name ?? existing.name;
  const nextDesc = parsed.data.description ?? existing.description;
  const nextPassport =
    parsed.data.passport_data !== undefined
      ? JSON.stringify(parsed.data.passport_data)
      : existing.passport_data ?? "{}";
  db.prepare(
    "UPDATE projects SET name = ?, description = ?, passport_data = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(nextName, nextDesc, nextPassport, id);
  const updated = parseRow(
    db.prepare("SELECT id, name, description, created_at, passport_data, updated_at FROM projects WHERE id = ?").get(id),
  );
  afterWorkspaceMutation(req, "project", id, "update");
  res.json(updated);
});

app.post("/projects", requireAuth, requireDataWrite, (req, res) => {
  const parsed = projectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const { name, description = "" } = parsed.data;
  const result = db
    .prepare("INSERT INTO projects (name, description) VALUES (?, ?)")
    .run(name, description);
  const project = parseRow(
    db.prepare("SELECT id, name, description, created_at, passport_data, updated_at FROM projects WHERE id = ?").get(
      result.lastInsertRowid,
    ),
  );
  afterWorkspaceMutation(req, "project", project.id, "create");
  res.status(201).json(project);
});

function parseNodesQuery(req) {
  const typesRaw = req.query.types;
  const types =
    typeof typesRaw === "string" && typesRaw.trim()
      ? typesRaw
          .split(",")
          .map((t) => t.trim().toUpperCase())
          .filter((t) => ["TK", "MUFTA", "PIKET", "KROSS"].includes(t))
      : null;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  let bbox = null;
  if (typeof req.query.bbox === "string" && req.query.bbox.trim()) {
    const parts = req.query.bbox.split(",").map((x) => Number(x.trim()));
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const [minLat, minLng, maxLat, maxLng] = parts;
      bbox = {
        minLat: Math.min(minLat, maxLat),
        maxLat: Math.max(minLat, maxLat),
        minLng: Math.min(minLng, maxLng),
        maxLng: Math.max(minLng, maxLng),
      };
    }
  }
  const limit = Math.min(10000, Math.max(1, Number(req.query.limit) || 10000));
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * limit;
  const sortRaw = typeof req.query.sort === "string" ? req.query.sort.trim().toLowerCase() : "id";
  const sort = sortRaw === "name" ? "name" : "id";
  return { types, q, bbox, limit, offset, page, sort };
}

function parseBboxFromQuery(req) {
  if (typeof req.query.bbox !== "string" || !req.query.bbox.trim()) return null;
  const parts = req.query.bbox.split(",").map((x) => Number(x.trim()));
  if (parts.length !== 4 || !parts.every((n) => Number.isFinite(n))) return null;
  const [minLat, minLng, maxLat, maxLng] = parts;
  return {
    minLat: Math.min(minLat, maxLat),
    maxLat: Math.max(minLat, maxLat),
    minLng: Math.min(minLng, maxLng),
    maxLng: Math.max(minLng, maxLng),
  };
}

function simplifyEdgeGeometry(geometry, zoom, detailZoom = 15, edgeType = null) {
  if (!Array.isArray(geometry) || geometry.length <= 2) return geometry;
  if (edgeType === "KANALIZACIYA") return geometry;
  const z = Number(zoom);
  if (!Number.isFinite(z) || z >= detailZoom) return geometry;
  let step;
  if (z <= 9) step = 16;
  else if (z <= 11) step = 8;
  else if (z <= 13) step = 4;
  else step = 2;
  if (step <= 1) return geometry;
  const out = [geometry[0]];
  for (let i = step; i < geometry.length - 1; i += step) out.push(geometry[i]);
  out.push(geometry[geometry.length - 1]);
  return out;
}

const EDGE_SELECT_SQL = `
  SELECT
    e.*,
    p.name AS project_name,
    sn.name AS start_node_name,
    en.name AS end_node_name
  FROM edges e
  LEFT JOIN projects p ON p.id = e.project_id
  JOIN nodes sn ON sn.id = e.start_node_id
  JOIN nodes en ON en.id = e.end_node_id
`;

app.get("/nodes", requireAuth, (req, res) => {
  const hasFilter =
    req.query.bbox != null ||
    req.query.types != null ||
    req.query.q != null ||
    req.query.page != null ||
    (req.query.limit != null && Number(req.query.limit) > 0);
  if (!hasFilter) {
    const rows = db.prepare("SELECT * FROM nodes ORDER BY id DESC").all().map(parseRow);
    return res.json(rows);
  }
  const { types, q, bbox, limit, offset, page, sort } = parseNodesQuery(req);
  const where = [];
  const params = [];
  if (types?.length) {
    where.push(`type IN (${types.map(() => "?").join(",")})`);
    params.push(...types);
  }
  if (bbox) {
    where.push("lat >= ? AND lat <= ? AND lng >= ? AND lng <= ?");
    params.push(bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng);
  }
  if (q) {
    where.push("(name LIKE ? OR CAST(id AS TEXT) LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql = sort === "name" ? "ORDER BY name COLLATE NOCASE ASC, id ASC" : "ORDER BY id DESC";
  const total = db.prepare(`SELECT COUNT(*) AS c FROM nodes ${whereSql}`).get(...params).c;
  const rows = db
    .prepare(`SELECT * FROM nodes ${whereSql} ${orderSql} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)
    .map(parseRow);
  res.json({ items: rows, total, page, limit });
});

app.get("/analytics/summary", requireAuth, (_req, res) => {
  const byType = db.prepare("SELECT type, COUNT(*) AS count FROM nodes GROUP BY type").all();
  const nodesByType = Object.fromEntries(byType.map((r) => [r.type, r.count]));
  const totalNodes = byType.reduce((s, r) => s + r.count, 0);
  const totalEdges = db.prepare("SELECT COUNT(*) AS c FROM edges").get().c;
  const projectCount = db.prepare("SELECT COUNT(*) AS c FROM projects").get().c;
  const kanalLengthM =
    db.prepare("SELECT COALESCE(SUM(length_m), 0) AS s FROM edges WHERE type = 'KANALIZACIYA'").get().s ?? 0;
  const opticalAgg = db
    .prepare(
      `SELECT
         COUNT(*) AS opticalCount,
         COALESCE(SUM(length_m), 0) AS lengthM,
         COALESCE(SUM(COALESCE(total_fibers, 0)), 0) AS sumTotalFibers,
         COALESCE(SUM(COALESCE(used_fibers, 0)), 0) AS sumUsedFibers
       FROM edges WHERE type = 'OPTOVOLOKNO'`,
    )
    .get();
  const statusRows = db
    .prepare(
      `SELECT COALESCE(cable_status, 'READY') AS status, COUNT(*) AS count
       FROM edges WHERE type = 'OPTOVOLOKNO' GROUP BY COALESCE(cable_status, 'READY')`,
    )
    .all();
  const opticalCount = opticalAgg.opticalCount ?? 0;
  const statusSlices = statusRows.map((r) => ({
    status: r.status,
    count: r.count,
    pct: opticalCount ? (100 * r.count) / opticalCount : 0,
  }));
  const accidentsByProject = db
    .prepare(
      `SELECT COALESCE(p.name, 'Без проекта') AS projectName, COUNT(*) AS count
       FROM edges e
       LEFT JOIN projects p ON p.id = e.project_id
       WHERE e.type = 'OPTOVOLOKNO' AND COALESCE(e.cable_status, 'READY') = 'ACCIDENT'
       GROUP BY e.project_id
       ORDER BY count DESC`,
    )
    .all();
  const fiberLoadRows = db
    .prepare(
      `SELECT
         SUM(CASE WHEN COALESCE(total_fibers, 0) <= 0 OR COALESCE(used_fibers, 0) <= 0 THEN 1 ELSE 0 END) AS idle,
         SUM(CASE WHEN COALESCE(total_fibers, 0) > 0 AND COALESCE(used_fibers, 0) > 0 AND COALESCE(used_fibers, 0) < COALESCE(total_fibers, 0) THEN 1 ELSE 0 END) AS partial,
         SUM(CASE WHEN COALESCE(total_fibers, 0) > 0 AND COALESCE(used_fibers, 0) >= COALESCE(total_fibers, 0) THEN 1 ELSE 0 END) AS full
       FROM edges WHERE type = 'OPTOVOLOKNO'`,
    )
    .get();
  const accidentsOpen = statusRows.find((r) => r.status === "ACCIDENT")?.count ?? 0;
  const fiberUtilPct = opticalAgg.sumTotalFibers
    ? Math.round((100 * opticalAgg.sumUsedFibers) / opticalAgg.sumTotalFibers)
    : 0;
  res.json({
    kpi: {
      opticalCount,
      lengthKm: (opticalAgg.lengthM ?? 0) / 1000,
      kanalLengthKm: kanalLengthM / 1000,
      projectCount,
      nodeTk: nodesByType.TK ?? 0,
      nodeMufta: nodesByType.MUFTA ?? 0,
      nodeKross: nodesByType.KROSS ?? 0,
      nodePiket: nodesByType.PIKET ?? 0,
      spliceLinks: 0,
      accidentsOpen,
      fiberUtilPct,
      mapObjects: totalNodes + totalEdges,
    },
    fiberLoad: {
      idle: fiberLoadRows.idle ?? 0,
      partial: fiberLoadRows.partial ?? 0,
      full: fiberLoadRows.full ?? 0,
      total: opticalCount,
    },
    statusSlices,
    accidentsByProject,
    totalNodes,
    totalEdges,
  });
});

app.get("/map/summary", requireAuth, (_req, res) => {
  const byType = db.prepare("SELECT type, COUNT(*) AS count FROM nodes GROUP BY type").all();
  const bounds = db.prepare("SELECT MIN(lat) AS minLat, MAX(lat) AS maxLat, MIN(lng) AS minLng, MAX(lng) AS maxLng FROM nodes").get();
  const totalNodes = byType.reduce((s, r) => s + r.count, 0);
  const totalEdges = db.prepare("SELECT COUNT(*) AS c FROM edges").get().c;
  const totalProjects = db.prepare("SELECT COUNT(*) AS c FROM projects").get().c;
  res.json({
    totalNodes,
    totalEdges,
    totalProjects,
    nodesByType: Object.fromEntries(byType.map((r) => [r.type, r.count])),
    bounds:
      bounds?.minLat != null
        ? { minLat: bounds.minLat, maxLat: bounds.maxLat, minLng: bounds.minLng, maxLng: bounds.maxLng }
        : null,
  });
});

function queryEdgesInBbox(bbox, edgeType, zoom, page, limit) {
  const edgeWhere = [];
  const edgeParams = [];
  if (bbox) {
    edgeWhere.push(
      `(
          (e.bbox_max_lat IS NOT NULL AND e.bbox_max_lat >= ? AND e.bbox_min_lat <= ? AND e.bbox_max_lng >= ? AND e.bbox_min_lng <= ?)
          OR (sn.lat >= ? AND sn.lat <= ? AND sn.lng >= ? AND sn.lng <= ?)
          OR (en.lat >= ? AND en.lat <= ? AND en.lng >= ? AND en.lng <= ?)
        )`,
    );
    edgeParams.push(
      bbox.minLat,
      bbox.maxLat,
      bbox.minLng,
      bbox.maxLng,
      bbox.minLat,
      bbox.maxLat,
      bbox.minLng,
      bbox.maxLng,
      bbox.minLat,
      bbox.maxLat,
      bbox.minLng,
      bbox.maxLng,
    );
  }
  if (edgeType) {
    edgeWhere.push("e.type = ?");
    edgeParams.push(edgeType);
  }
  const edgeWhereSql = edgeWhere.length ? `WHERE ${edgeWhere.join(" AND ")}` : "";
  const edgePage = Math.max(1, Number(page) || 1);
  const edgeLimit = Math.min(2000, Math.max(1, Number(limit) || 1500));
  const edgeOffset = (edgePage - 1) * edgeLimit;
  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM edges e
         JOIN nodes sn ON sn.id = e.start_node_id
         JOIN nodes en ON en.id = e.end_node_id
         ${edgeWhereSql}`,
    )
    .get(...edgeParams).c;
  const rows = db
    .prepare(`${EDGE_SELECT_SQL} ${edgeWhereSql} ORDER BY e.id DESC LIMIT ? OFFSET ?`)
    .all(...edgeParams, edgeLimit, edgeOffset)
    .map((row) => {
      const parsed = parseRow(row);
      if (parsed.geometry) parsed.geometry = simplifyEdgeGeometry(parsed.geometry, zoom, 15, parsed.type);
      return parsed;
    });
  const hasMore = edgeOffset + rows.length < total && rows.length >= edgeLimit;
  return { rows, total, hasMore, page: edgePage, limit: edgeLimit };
}

app.get("/map/viewport", requireAuth, (req, res) => {
  const bbox = parseBboxFromQuery(req);
  const { types } = parseNodesQuery(req);
  const zoom = Number(req.query.zoom);
  const TK_DETAIL_ZOOM = 16;
  let nodeTypes = types;
  let limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 1500));
  if (Number.isFinite(zoom) && zoom < TK_DETAIL_ZOOM) {
    nodeTypes = ["TK"];
    limit = Math.min(limit, 800);
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * limit;
  const includeEdgesParam = req.query.includeEdges;
  const edgeSplit = includeEdgesParam === "split";
  const includeEdges =
    includeEdgesParam === "1" || includeEdgesParam === "true" || edgeSplit;

  const nodeWhere = [];
  const nodeParams = [];
  if (bbox) {
    nodeWhere.push("lat >= ? AND lat <= ? AND lng >= ? AND lng <= ?");
    nodeParams.push(bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng);
  }
  if (nodeTypes?.length) {
    nodeWhere.push(`type IN (${nodeTypes.map(() => "?").join(",")})`);
    nodeParams.push(...nodeTypes);
  }
  const nodeWhereSql = nodeWhere.length ? `WHERE ${nodeWhere.join(" AND ")}` : "";
  const totalNodes = db.prepare(`SELECT COUNT(*) AS c FROM nodes ${nodeWhereSql}`).get(...nodeParams).c;
  const nodeRows = db
    .prepare(
      `SELECT id, type, name, lat, lng, parent_tk_id FROM nodes ${nodeWhereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...nodeParams, limit, offset)
    .map(parseRow);

  const loadedSoFar = offset + nodeRows.length;
  const hasMore = loadedSoFar < totalNodes && nodeRows.length === limit;

  let edgeRows = [];
  let totalEdges = 0;
  const edgePage = Math.max(1, Number(req.query.edgePage) || 1);
  const edgeLimit = Math.min(2000, Math.max(1, Number(req.query.edgeLimit) || limit));
  let edgeHasMore = false;
  let kanalEdges = [];
  let volsEdges = [];
  let kanalTotal = 0;
  let volsTotal = 0;
  let kanalHasMore = false;
  let volsHasMore = false;

  if (includeEdges && edgeSplit) {
    const kanal = queryEdgesInBbox(bbox, "KANALIZACIYA", zoom, edgePage, edgeLimit);
    const vols = queryEdgesInBbox(bbox, "OPTOVOLOKNO", zoom, edgePage, edgeLimit);
    kanalEdges = kanal.rows;
    volsEdges = vols.rows;
    kanalTotal = kanal.total;
    volsTotal = vols.total;
    kanalHasMore = kanal.hasMore;
    volsHasMore = vols.hasMore;
    totalEdges = Math.max(kanalTotal, volsTotal);
    edgeHasMore = kanalHasMore || volsHasMore;
  } else if (includeEdges) {
    const merged = queryEdgesInBbox(bbox, null, zoom, edgePage, edgeLimit);
    edgeRows = merged.rows;
    totalEdges = merged.total;
    edgeHasMore = merged.hasMore;
  }

  const payload = {
    nodes: nodeRows,
    edges: edgeRows,
    totalNodes,
    totalEdges,
    page,
    limit,
    hasMore,
    edgePage,
    edgeLimit,
    edgeHasMore,
    truncated: hasMore || edgeHasMore,
  };
  if (edgeSplit) {
    payload.kanalEdges = kanalEdges;
    payload.volsEdges = volsEdges;
    payload.kanalTotal = kanalTotal;
    payload.volsTotal = volsTotal;
    payload.kanalHasMore = kanalHasMore;
    payload.volsHasMore = volsHasMore;
  }
  res.json(payload);
});

app.post("/nodes", requireAuth, requireDataWrite, (req, res) => {
  const parsed = nodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const { type, name, lat, lng, parent_tk_id = null, passport_data = {} } = parsed.data;
  if (type === "MUFTA") {
    if (!parent_tk_id) return res.status(400).json({ message: "MUFTA must reference parent TK" });
    const tk = db.prepare("SELECT id, type, lat, lng FROM nodes WHERE id = ?").get(parent_tk_id);
    if (!tk || tk.type !== "TK") return res.status(400).json({ message: "parent_tk_id must reference TK node" });
    const distance = haversineMeters([lat, lng], [tk.lat, tk.lng]);
    if (distance > MUFTA_ATTACH_MAX_METERS) {
      return res.status(400).json({ message: muftaAttachDistanceError(MUFTA_ATTACH_MAX_METERS) });
    }
  }
  if (type !== "MUFTA" && parent_tk_id) {
    return res.status(400).json({ message: "Only MUFTA can have parent_tk_id" });
  }
  let newId;
  try {
    const tx = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO nodes (type, name, lat, lng, parent_tk_id, passport_data)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(type, name, lat, lng, parent_tk_id, JSON.stringify(passport_data));
      newId = result.lastInsertRowid;
      if (type === "MUFTA" && parent_tk_id) {
        const rb = rebalanceMuftasOnTk(db, parent_tk_id, MUFTA_ATTACH_MAX_METERS);
        if (!rb.ok) throw new Error(rb.message);
      }
    });
    tx();
  } catch (err) {
    return res.status(400).json({ message: err.message || String(err) });
  }
  const row = db.prepare("SELECT * FROM nodes WHERE id = ?").get(newId);
  afterWorkspaceMutation(req, "node", Number(newId), "create");
  res.status(201).json(parseRow(row));
});

app.get("/nodes/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid ID" });
  const row = db.prepare("SELECT * FROM nodes WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ message: "Node not found" });
  res.json(parseRow(row));
});

app.put("/nodes/:id", requireAuth, requireDataWrite, (req, res) => {
  const id = Number(req.params.id);
  const parsed = nodeSchema.partial().safeParse(req.body);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid ID" });
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const existing = db.prepare("SELECT * FROM nodes WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ message: "Node not found" });

  const conflict = checkExpectedUpdatedAt(existing, req.body.expected_updated_at);
  if (conflict) return res.status(conflict.status).json(conflict.body);

  const patch = parsed.data;
  const nextType = patch.type ?? existing.type;
  const nextLat = patch.lat ?? existing.lat;
  const nextLng = patch.lng ?? existing.lng;
  const nextParentTkId = patch.parent_tk_id ?? existing.parent_tk_id ?? null;
  if (nextType === "MUFTA") {
    if (!nextParentTkId) return res.status(400).json({ message: "MUFTA must reference parent TK" });
    const tk = db.prepare("SELECT id, type, lat, lng FROM nodes WHERE id = ?").get(nextParentTkId);
    if (!tk || tk.type !== "TK") return res.status(400).json({ message: "parent_tk_id must reference TK node" });
    const distance = haversineMeters([nextLat, nextLng], [tk.lat, tk.lng]);
    if (distance > MUFTA_ATTACH_MAX_METERS) {
      return res.status(400).json({ message: muftaAttachDistanceError(MUFTA_ATTACH_MAX_METERS) });
    }
  }
  if (nextType !== "MUFTA" && nextParentTkId) {
    return res.status(400).json({ message: "Only MUFTA can have parent_tk_id" });
  }
  const prevParentTkId = existing.type === "MUFTA" ? existing.parent_tk_id : null;
  try {
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE nodes
         SET type = ?, name = ?, lat = ?, lng = ?, parent_tk_id = ?, passport_data = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        nextType,
        patch.name ?? existing.name,
        nextLat,
        nextLng,
        nextParentTkId,
        JSON.stringify(patch.passport_data ?? JSON.parse(existing.passport_data || "{}")),
        id
      );
      if (nextType === "MUFTA" && nextParentTkId) {
        const tk = db.prepare("SELECT lat, lng FROM nodes WHERE id = ?").get(nextParentTkId);
        if (tk && isNearTkCenter(nextLat, nextLng, tk)) {
          const rb = rebalanceMuftasOnTk(db, nextParentTkId, MUFTA_ATTACH_MAX_METERS);
          if (!rb.ok) throw new Error(rb.message);
        }
      }
      if (prevParentTkId && prevParentTkId !== nextParentTkId) {
        const rbOld = rebalanceMuftasOnTk(db, prevParentTkId, MUFTA_ATTACH_MAX_METERS);
        if (!rbOld.ok) throw new Error(rbOld.message);
      }
    });
    tx();
  } catch (err) {
    return res.status(400).json({ message: err.message || String(err) });
  }

  const updated = db.prepare("SELECT * FROM nodes WHERE id = ?").get(id);
  afterWorkspaceMutation(req, "node", id, "update");
  res.json(parseRow(updated));
});

app.delete("/nodes/:id", requireAuth, requireDataWrite, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid ID" });

  const existing = db.prepare("SELECT * FROM nodes WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ message: "Node not found" });

  const parentTkToRebalance =
    existing.type === "MUFTA" && existing.parent_tk_id ? Number(existing.parent_tk_id) : null;

  try {
  const tx = db.transaction(() => {
    if (existing.type === "TK") {
      const childMuftas = db
        .prepare("SELECT id FROM nodes WHERE type = 'MUFTA' AND parent_tk_id = ?")
        .all(id)
        .map((row) => row.id);
      if (childMuftas.length > 0) {
        const childPlaceholders = childMuftas.map(() => "?").join(",");
        db.prepare(
          `DELETE FROM edges WHERE start_node_id IN (${childPlaceholders}) OR end_node_id IN (${childPlaceholders})`
        ).run(...childMuftas, ...childMuftas);
        db.prepare(`DELETE FROM nodes WHERE id IN (${childPlaceholders})`).run(...childMuftas);
      }
      db.prepare("DELETE FROM edges WHERE start_node_id = ? OR end_node_id = ?").run(id, id);
      db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
      return;
    }

    db.prepare("DELETE FROM edges WHERE start_node_id = ? OR end_node_id = ?").run(id, id);
    db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
    if (parentTkToRebalance) {
      const rb = rebalanceMuftasOnTk(db, parentTkToRebalance, MUFTA_ATTACH_MAX_METERS);
      if (!rb.ok) throw new Error(rb.message);
    }
  });
  tx();
  } catch (err) {
    return res.status(400).json({ message: err.message || String(err) });
  }
  afterWorkspaceMutation(req, "node", id, "delete");
  res.status(204).send();
});

function parseFiberOrderRow(row) {
  if (!row) return row;
  return { ...row, edge_ids: JSON.parse(row.edge_ids || "[]") };
}

app.get("/fiber-orders", requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT fo.*, sn.name AS start_mufta_name, en.name AS end_mufta_name
       FROM fiber_orders fo
       JOIN nodes sn ON sn.id = fo.start_mufta_id
       JOIN nodes en ON en.id = fo.end_mufta_id
       ORDER BY fo.id DESC`
    )
    .all()
    .map(parseFiberOrderRow);
  res.json(rows);
});

const fiberOrderCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  fiber_count: z.number().int().positive(),
  start_mufta_id: z.number().int().positive(),
  end_mufta_id: z.number().int().positive(),
  edge_ids: z.array(z.number().int().positive()).min(1),
  total_length_m: z.number().int().nonnegative().optional(),
  bitrix_deal_id: z.number().int().positive().optional().nullable(),
});

app.post("/fiber-orders", requireAuth, requireDataWrite, (req, res) => {
  const parsed = fiberOrderCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const { name, description, fiber_count, start_mufta_id, end_mufta_id, edge_ids, total_length_m, bitrix_deal_id } =
    parsed.data;
  const startN = db.prepare("SELECT id, type FROM nodes WHERE id = ?").get(start_mufta_id);
  const endN = db.prepare("SELECT id, type FROM nodes WHERE id = ?").get(end_mufta_id);
  if (!startN || !endN || !isOpticalEndpointNodeType(startN.type) || !isOpticalEndpointNodeType(endN.type)) {
    return res.status(400).json({ message: "Заказ: начало и конец маршрута — муфта или кросс" });
  }

  const edgeRows = edge_ids.map((id) => parseRow(db.prepare("SELECT * FROM edges WHERE id = ?").get(id)));
  if (edgeRows.some((e) => !e || e.type !== "OPTOVOLOKNO")) {
    return res.status(400).json({ message: "Маршрут должен состоять только из оптических участков" });
  }
  for (const e of edgeRows) {
    const free = (e.total_fibers || 0) - (e.used_fibers || 0);
    if (free < fiber_count) {
      return res.status(400).json({ message: `Недостаточно свободных волокон на участке «${e.cable_name || e.id}» (свободно ${free}, нужно ${fiber_count})` });
    }
  }

  const totalLen =
    total_length_m != null ? total_length_m : Math.round(edgeRows.reduce((sum, e) => sum + (e.length_m || 0), 0));

  try {
    const orderId = db.transaction(() => {
      for (const e of edgeRows) {
        const fresh = db.prepare("SELECT total_fibers, used_fibers FROM edges WHERE id = ?").get(e.id);
        const free = (fresh?.total_fibers || 0) - (fresh?.used_fibers || 0);
        if (free < fiber_count) {
          throw new Error(
            `Недостаточно свободных волокон на участке id=${e.id} (свободно ${free}, нужно ${fiber_count})`,
          );
        }
      }
      const ins = db
        .prepare(
          `INSERT INTO fiber_orders (name, description, fiber_count, start_mufta_id, end_mufta_id, edge_ids, total_length_m)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(name, description ?? "", fiber_count, start_mufta_id, end_mufta_id, JSON.stringify(edge_ids), totalLen);
      const id = Number(ins.lastInsertRowid);
      for (const e of edgeRows) {
        const fresh = db.prepare("SELECT used_fibers FROM edges WHERE id = ?").get(e.id);
        const newUsed = (fresh?.used_fibers || 0) + fiber_count;
        db.prepare("UPDATE edges SET used_fibers = ?, updated_at = datetime('now') WHERE id = ?").run(newUsed, e.id);
      }
      return id;
    })();

    const row = db
      .prepare(
        `SELECT fo.*, sn.name AS start_mufta_name, en.name AS end_mufta_name
         FROM fiber_orders fo
         JOIN nodes sn ON sn.id = fo.start_mufta_id
         JOIN nodes en ON en.id = fo.end_mufta_id
         WHERE fo.id = ?`
      )
      .get(orderId);
    const out = parseFiberOrderRow(row);
    if (bitrix_deal_id) {
      try {
        void notifyBitrixDealFiberOrder(bitrix_deal_id, out);
      } catch (e) {
        console.error("Bitrix fiber order notify:", e);
      }
    }
    afterWorkspaceMutation(req, "fiber_order", orderId, "create");
    res.status(201).json(out);
  } catch (err) {
    res.status(500).json({ message: err.message || String(err) });
  }
});

app.get("/edges", requireAuth, (req, res) => {
  const bbox = parseBboxFromQuery(req);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const edgeTypeRaw = typeof req.query.type === "string" ? req.query.type.trim().toUpperCase() : "";
  const edgeType =
    edgeTypeRaw === "OPTOVOLOKNO" || edgeTypeRaw === "KANALIZACIYA" ? edgeTypeRaw : null;
  const hasFilter =
    bbox != null || q.length > 0 || edgeType != null || (req.query.limit != null && Number(req.query.limit) > 0);
  if (!hasFilter) {
    const rows = db.prepare(`${EDGE_SELECT_SQL} ORDER BY e.id DESC`).all().map(parseRow);
    return res.json(rows);
  }
  const limit = Math.min(8000, Math.max(1, Number(req.query.limit) || 8000));
  const zoom = Number(req.query.zoom);
  const edgeWhere = [];
  const edgeParams = [];
  if (bbox) {
    edgeWhere.push(
      `(
        (e.bbox_max_lat IS NOT NULL AND e.bbox_max_lat >= ? AND e.bbox_min_lat <= ? AND e.bbox_max_lng >= ? AND e.bbox_min_lng <= ?)
        OR (sn.lat >= ? AND sn.lat <= ? AND sn.lng >= ? AND sn.lng <= ?)
        OR (en.lat >= ? AND en.lat <= ? AND en.lng >= ? AND en.lng <= ?)
      )`,
    );
    edgeParams.push(
      bbox.minLat,
      bbox.maxLat,
      bbox.minLng,
      bbox.maxLng,
      bbox.minLat,
      bbox.maxLat,
      bbox.minLng,
      bbox.maxLng,
      bbox.minLat,
      bbox.maxLat,
      bbox.minLng,
      bbox.maxLng,
    );
  }
  if (q) {
    edgeWhere.push(
      "(e.cable_name LIKE ? OR CAST(e.id AS TEXT) LIKE ? OR sn.name LIKE ? OR en.name LIKE ? OR p.name LIKE ?)",
    );
    edgeParams.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (edgeType) {
    edgeWhere.push("e.type = ?");
    edgeParams.push(edgeType);
  }
  const edgeWhereSql = edgeWhere.length ? `WHERE ${edgeWhere.join(" AND ")}` : "";
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * limit;
  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM edges e
       JOIN nodes sn ON sn.id = e.start_node_id
       JOIN nodes en ON en.id = e.end_node_id
       LEFT JOIN projects p ON p.id = e.project_id
       ${edgeWhereSql}`,
    )
    .get(...edgeParams).c;
  const rows = db
    .prepare(
      `${EDGE_SELECT_SQL} ${edgeWhereSql} ORDER BY CASE WHEN e.type = 'KANALIZACIYA' THEN 0 ELSE 1 END, e.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...edgeParams, limit, offset)
    .map((row) => {
      const parsed = parseRow(row);
      if (parsed.geometry) parsed.geometry = simplifyEdgeGeometry(parsed.geometry, zoom, 15, parsed.type);
      return parsed;
    });
  res.json({ items: rows, total, page, limit });
});

const kanalLinkSchema = z.object({
  start_tk_name: z.string().min(1),
  end_tk_name: z.string().min(1),
  length_m: z.number().positive(),
  passport_data: z.record(z.string(), z.unknown()).optional(),
});

app.post("/edges/kanal/link", requireAuth, requireDataWrite, (req, res) => {
  const parsed = kanalLinkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const result = createKanalLink(db, parseRow, syncEdgeGeomBbox, parsed.data);
  if (!result.ok) {
    const status = result.code === "ambiguous" ? 409 : 400;
    return res.status(status).json({
      message: result.message,
      code: result.code,
      candidates: result.candidates,
    });
  }

  afterWorkspaceMutation(req, "edge", Number(result.edge.id), "create");
  res.status(201).json(result.edge);
});

const kanalLinkBulkRowSchema = z.object({
  row: z.number().int().positive().optional(),
  start_tk_name: z.string().min(1),
  end_tk_name: z.string().min(1),
  length_m: z.number().positive(),
  passport_data: z.record(z.string(), z.unknown()).optional(),
});

const kanalLinkBulkSchema = z.object({
  rows: z.array(kanalLinkBulkRowSchema).min(1).max(2000),
});

const KANAL_BULK_ERRORS_CAP = 200;

app.post("/edges/kanal/link/bulk", requireAuth, requireDataWrite, (req, res) => {
  const parsed = kanalLinkBulkSchema.safeParse(req.body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const msg =
      flat.fieldErrors?.rows?.[0] ||
      "Неверный запрос (не более 2000 строк за один запрос — большие файлы загружаются частями)";
    return res.status(400).json({ message: msg, ...flat });
  }

  const { created, errors } = createKanalLinksBulk(db, parseRow, syncEdgeGeomBbox, parsed.data.rows);
  if (created.length > 0) {
    afterWorkspaceMutation(req, "import", null, "kanal_bulk");
  }

  const errorsCap = errors.slice(0, KANAL_BULK_ERRORS_CAP);
  const body = {
    created_ids: created.map((c) => c.edge.id),
    errors: errorsCap,
    errors_truncated: errors.length > KANAL_BULK_ERRORS_CAP,
    summary: { ok: created.length, failed: errors.length, total: parsed.data.rows.length },
  };
  res.status(201).json(body);
});

app.post("/edges", requireAuth, requireDataWrite, (req, res) => {
  const parsed = edgeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const payload = parsed.data;
  if (payload.type === "KANALIZACIYA" && payload.project_id != null) {
    return res.status(400).json({ message: "Канализация не привязывается к проекту (project_id = null)" });
  }
  if (payload.type === "OPTOVOLOKNO" && payload.project_id == null) {
    return res.status(400).json({ message: "Оптика требует project_id" });
  }
  const startExists = db.prepare("SELECT id, type FROM nodes WHERE id = ?").get(payload.start_node_id);
  const endExists = db.prepare("SELECT id, type FROM nodes WHERE id = ?").get(payload.end_node_id);
  if (!startExists || !endExists) {
    return res.status(400).json({ message: "Invalid node reference" });
  }

  if (payload.type === "KANALIZACIYA") {
    if (startExists.type !== "TK" || endExists.type !== "TK") {
      return res.status(400).json({ message: "Канализация только от ТК до ТК" });
    }
    if (payload.project_id != null) {
      return res.status(400).json({ message: "Канализация не привязывается к проекту" });
    }
  } else {
    const projectExists = db.prepare("SELECT id FROM projects WHERE id = ?").get(payload.project_id);
    if (!projectExists) return res.status(400).json({ message: "Укажите существующий проект для оптики" });
    if (!isOpticalEndpointNodeType(startExists.type) || !isOpticalEndpointNodeType(endExists.type)) {
      return res.status(400).json({
        message: `ВОЛС: начало и конец — только муфта или кросс (сейчас: «${startExists.type}» → «${endExists.type}»). Допустимо: муфта–муфта, муфта–кросс, кросс–кросс.`,
      });
    }
    if (!payload.cable_name || payload.total_fibers == null || payload.used_fibers == null) {
      return res.status(400).json({ message: "OPTOVOLOKNO requires cable_name, total_fibers, used_fibers" });
    }
    if (payload.used_fibers > payload.total_fibers) {
      return res.status(400).json({ message: "used_fibers cannot exceed total_fibers" });
    }
  }

  const projectIdForInsert = payload.type === "KANALIZACIYA" ? null : payload.project_id;
  const cableStatusForInsert =
    payload.type === "OPTOVOLOKNO" ? payload.cable_status ?? "READY" : null;

  const result = db
    .prepare(
      `INSERT INTO edges
      (type, start_node_id, end_node_id, length_m, geometry, cable_name, total_fibers, used_fibers, project_id, passport_data, cable_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      payload.type,
      payload.start_node_id,
      payload.end_node_id,
      payload.length_m,
      JSON.stringify(payload.geometry),
      payload.cable_name ?? null,
      payload.total_fibers ?? null,
      payload.used_fibers ?? null,
      projectIdForInsert,
      JSON.stringify(payload.passport_data || {}),
      cableStatusForInsert
    );

  const row = db
    .prepare(
      `SELECT
        e.*,
        p.name AS project_name,
        sn.name AS start_node_name,
        en.name AS end_node_name
      FROM edges e
      LEFT JOIN projects p ON p.id = e.project_id
      JOIN nodes sn ON sn.id = e.start_node_id
      JOIN nodes en ON en.id = e.end_node_id
      WHERE e.id = ?`
    )
    .get(result.lastInsertRowid);
  syncEdgeGeomBbox(db, row.id, payload.geometry);
  afterWorkspaceMutation(req, "edge", Number(row.id), "create");
  res.status(201).json(parseRow(row));
});

app.get("/edges/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid ID" });
  const row = db
    .prepare(
      `${EDGE_SELECT_SQL} WHERE e.id = ?`,
    )
    .get(id);
  if (!row) return res.status(404).json({ message: "Edge not found" });
  res.json(parseRow(row));
});

app.put("/edges/:id", requireAuth, requireDataWrite, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid ID" });

  const parsed = edgeSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const existing = db.prepare("SELECT * FROM edges WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ message: "Edge not found" });

  const conflict = checkExpectedUpdatedAt(existing, req.body.expected_updated_at);
  if (conflict) return res.status(conflict.status).json(conflict.body);

  const oldGeometry = JSON.parse(existing.geometry || "[]");
  const oldPassport = JSON.parse(existing.passport_data || "{}");
  const patch = parsed.data;
  const nextStartNodeId = patch.start_node_id ?? existing.start_node_id;
  const nextEndNodeId = patch.end_node_id ?? existing.end_node_id;
  const nextStart = db.prepare("SELECT id, type FROM nodes WHERE id = ?").get(nextStartNodeId);
  const nextEnd = db.prepare("SELECT id, type FROM nodes WHERE id = ?").get(nextEndNodeId);
  if (!nextStart || !nextEnd) return res.status(400).json({ message: "Invalid node reference" });
  const nextType = patch.type ?? existing.type;
  if (nextType === "KANALIZACIYA") {
    if (nextStart.type !== "TK" || nextEnd.type !== "TK") {
      return res.status(400).json({ message: "Канализация только от ТК до ТК" });
    }
  } else if (!isOpticalEndpointNodeType(nextStart.type) || !isOpticalEndpointNodeType(nextEnd.type)) {
    return res.status(400).json({
      message: `ВОЛС: начало и конец — только муфта или кросс (сейчас: «${nextStart.type}» → «${nextEnd.type}»).`,
    });
  }

  const nextTotalFibers = patch.total_fibers ?? existing.total_fibers;
  const nextUsedFibers = patch.used_fibers ?? existing.used_fibers;
  if (nextType === "OPTOVOLOKNO") {
    if (!((patch.cable_name ?? existing.cable_name) && nextTotalFibers != null && nextUsedFibers != null)) {
      return res.status(400).json({ message: "OPTOVOLOKNO requires cable_name, total_fibers, used_fibers" });
    }
    if (Number(nextUsedFibers) > Number(nextTotalFibers)) {
      return res.status(400).json({ message: "used_fibers cannot exceed total_fibers" });
    }
  }

  const nextProjectId =
    nextType === "KANALIZACIYA" ? null : patch.project_id !== undefined ? patch.project_id : existing.project_id;
  if (nextType === "OPTOVOLOKNO" && (nextProjectId == null || !Number.isInteger(Number(nextProjectId)))) {
    return res.status(400).json({ message: "Оптика требует project_id" });
  }
  if (nextType === "OPTOVOLOKNO") {
    const pn = db.prepare("SELECT id FROM projects WHERE id = ?").get(nextProjectId);
    if (!pn) return res.status(400).json({ message: "Invalid project" });
  }

  const nextCableStatus =
    nextType === "OPTOVOLOKNO"
      ? patch.cable_status !== undefined
        ? patch.cable_status
        : existing.cable_status ?? "READY"
      : null;

  const prevCableStatus = existing.cable_status ?? "READY";

  db.prepare(
    `UPDATE edges
     SET type = ?, start_node_id = ?, end_node_id = ?, length_m = ?, geometry = ?, cable_name = ?, total_fibers = ?, used_fibers = ?, project_id = ?, passport_data = ?, cable_status = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    nextType,
    nextStartNodeId,
    nextEndNodeId,
    patch.length_m ?? existing.length_m,
    JSON.stringify(patch.geometry ?? oldGeometry),
    patch.cable_name ?? existing.cable_name,
    patch.total_fibers ?? existing.total_fibers,
    patch.used_fibers ?? existing.used_fibers,
    nextProjectId,
    JSON.stringify(patch.passport_data ?? oldPassport),
    nextCableStatus,
    id
  );

  const nextGeometry = patch.geometry ?? oldGeometry;
  syncEdgeGeomBbox(db, id, nextGeometry);

  const row = db
    .prepare(
      `SELECT
        e.*,
        p.name AS project_name,
        sn.name AS start_node_name,
        en.name AS end_node_name
      FROM edges e
      LEFT JOIN projects p ON p.id = e.project_id
      JOIN nodes sn ON sn.id = e.start_node_id
      JOIN nodes en ON en.id = e.end_node_id
      WHERE e.id = ?`
    )
    .get(id);
  const parsedRow = parseRow(row);
  if (
    parsedRow.type === "OPTOVOLOKNO" &&
    parsedRow.cable_status === "ACCIDENT" &&
    String(prevCableStatus).toUpperCase() !== "ACCIDENT"
  ) {
    try {
      const wsSlug = req.workspaceSlug || getWorkspaceContext()?.slug;
      void notifyBitrixAccident(systemDb, wsSlug, id, parsedRow, null);
    } catch (e) {
      console.error("Bitrix accident notify:", e);
    }
  }
  afterWorkspaceMutation(req, "edge", id, "update");
  res.json(parsedRow);
});

app.delete("/edges/:id", requireAuth, requireDataWrite, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid ID" });
  const existing = db.prepare("SELECT id FROM edges WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ message: "Edge not found" });
  db.prepare("DELETE FROM edges WHERE id = ?").run(id);
  afterWorkspaceMutation(req, "edge", id, "delete");
  res.status(204).send();
});

const importProjectRow = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  created_at: z.string().optional().nullable(),
});

const importNodeRow = z.object({
  id: z.number().int().positive(),
  type: z.enum(["TK", "MUFTA", "PIKET", "KROSS"]),
  name: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  parent_tk_id: z.number().int().positive().nullable().optional(),
  passport_data: z.record(z.string(), z.unknown()).optional(),
  created_at: z.string().optional().nullable(),
  updated_at: z.string().optional().nullable(),
});

const importEdgeRow = z.object({
  id: z.number().int().positive(),
  type: z.enum(["KANALIZACIYA", "OPTOVOLOKNO"]),
  start_node_id: z.number().int().positive(),
  end_node_id: z.number().int().positive(),
  length_m: z.number().nonnegative(),
  geometry: z.array(z.tuple([z.number(), z.number()])).min(2),
  cable_name: z.string().nullable().optional(),
  total_fibers: z.number().int().nonnegative().nullable().optional(),
  used_fibers: z.number().int().nonnegative().nullable().optional(),
  project_id: z.number().int().positive().nullable().optional(),
  cable_status: fiberCableStatusSchema.optional().nullable(),
  passport_data: z.record(z.string(), z.unknown()).optional(),
  created_at: z.string().optional().nullable(),
  updated_at: z.string().optional().nullable(),
});

const importDatabaseBody = z.object({
  format: z.literal("gis-database").optional(),
  version: z.number().optional(),
  projects: z.array(importProjectRow),
  nodes: z.array(importNodeRow),
  edges: z.array(importEdgeRow),
});

const importProjectRowIn = importProjectRow.extend({ id: z.number().int().positive().optional() });
const importNodeRowIn = importNodeRow.extend({ id: z.number().int().positive().optional() });
const importEdgeRowIn = importEdgeRow.extend({ id: z.number().int().positive().optional() });

const importDatabaseAppendBody = z.object({
  format: z.literal("gis-database").optional(),
  version: z.number().optional(),
  remapTakenIds: z.boolean().optional().default(false),
  projects: z.array(importProjectRowIn).default([]),
  nodes: z.array(importNodeRowIn).default([]),
  edges: z.array(importEdgeRowIn).default([]),
});

function syncSqliteSequences() {
  for (const table of ["projects", "nodes", "edges", "fiber_orders"]) {
    const { m } = db.prepare(`SELECT IFNULL(MAX(id), 0) AS m FROM ${table}`).get();
    db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(table);
    if (m > 0) db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run(table, m);
  }
}

function validateImportGraph(projects, nodes, edges) {
  const errors = [];
  const projectIds = new Set(projects.map((p) => p.id));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  if (projectIds.size !== projects.length) errors.push("Дублируются id проектов");
  if (nodeById.size !== nodes.length) errors.push("Дублируются id узлов");

  for (const n of nodes) {
    if (n.type === "MUFTA") {
      if (n.parent_tk_id != null) {
        const tk = nodeById.get(n.parent_tk_id);
        if (!tk || tk.type !== "TK") errors.push(`Муфта id=${n.id}: parent_tk_id должен указывать на узел типа TK`);
        else {
          const d = haversineMeters([n.lat, n.lng], [tk.lat, tk.lng]);
          if (d > MUFTA_ATTACH_MAX_METERS) errors.push(`Муфта id=${n.id}: слишком далеко от ТК (${d.toFixed(1)} м > ${MUFTA_ATTACH_MAX_METERS} м)`);
        }
      }
    } else if (n.parent_tk_id != null) {
      errors.push(`Узел id=${n.id}: только MUFTA может иметь parent_tk_id`);
    }
  }

  for (const e of edges) {
    const a = nodeById.get(e.start_node_id);
    const b = nodeById.get(e.end_node_id);
    if (!a || !b) errors.push(`Участок id=${e.id}: неверные start_node_id / end_node_id`);
    else if (e.type === "KANALIZACIYA") {
      if (a.type !== "TK" || b.type !== "TK") errors.push(`Канализация id=${e.id}: только от ТК до ТК`);
      if (e.project_id != null) errors.push(`Канализация id=${e.id}: project_id должен быть null`);
    } else {
      if (!isOpticalEndpointNodeType(a.type) || !isOpticalEndpointNodeType(b.type)) {
        errors.push(`Оптика id=${e.id}: только между муфтами и/или кроссами`);
      }
      if (e.project_id == null || !projectIds.has(e.project_id)) {
        errors.push(`Оптика id=${e.id}: нужен существующий project_id`);
      }
    }
    if (e.type === "OPTOVOLOKNO") {
      if (!e.cable_name || e.total_fibers == null || e.used_fibers == null) {
        errors.push(`Оптика id=${e.id}: нужны cable_name, total_fibers, used_fibers`);
      } else if (e.used_fibers > e.total_fibers) {
        errors.push(`Оптика id=${e.id}: used_fibers не может быть больше total_fibers`);
      }
    }
  }
  return errors;
}

/** Append: проверяем только новые строки; уже лежащие в БД участки не пересматриваем. */
function validateImportAppend(newProjects, newNodes, newEdges) {
  const errors = [];
  const existingProjects = loadProjectsForImport();
  const existingNodes = loadNodesForImport();

  const projectIds = new Set(existingProjects.map((p) => p.id));
  for (const p of newProjects) {
    if (projectIds.has(p.id)) errors.push(`Проект id=${p.id}: id уже в базе`);
    projectIds.add(p.id);
  }
  if (new Set(newProjects.map((p) => p.id)).size !== newProjects.length) {
    errors.push("Дублируются id в импортируемых проектах");
  }

  const nodeById = new Map(existingNodes.map((n) => [n.id, n]));
  const newNodeIdSet = new Set();
  for (const n of newNodes) {
    if (newNodeIdSet.has(n.id)) errors.push(`Дублируется id узла ${n.id} в файле`);
    newNodeIdSet.add(n.id);
    if (nodeById.has(n.id)) errors.push(`Узел id=${n.id}: id уже в базе`);
    nodeById.set(n.id, n);

    if (n.type === "MUFTA") {
      if (n.parent_tk_id != null) {
        const tk = nodeById.get(n.parent_tk_id);
        if (!tk || tk.type !== "TK") errors.push(`Муфта id=${n.id}: parent_tk_id должен указывать на узел типа TK`);
        else {
          const d = haversineMeters([n.lat, n.lng], [tk.lat, tk.lng]);
          if (d > MUFTA_ATTACH_MAX_METERS) {
            errors.push(`Муфта id=${n.id}: слишком далеко от ТК (${d.toFixed(1)} м > ${MUFTA_ATTACH_MAX_METERS} м)`);
          }
        }
      }
    } else if (n.parent_tk_id != null) {
      errors.push(`Узел id=${n.id}: только MUFTA может иметь parent_tk_id`);
    }
  }

  for (const e of newEdges) {
    const a = nodeById.get(e.start_node_id);
    const b = nodeById.get(e.end_node_id);
    if (!a || !b) errors.push(`Участок id=${e.id}: неверные start_node_id / end_node_id`);
    else if (e.type === "KANALIZACIYA") {
      if (a.type !== "TK" || b.type !== "TK") errors.push(`Канализация id=${e.id}: только от ТК до ТК`);
      if (e.project_id != null) errors.push(`Канализация id=${e.id}: project_id должен быть null`);
    } else {
      if (!isOpticalEndpointNodeType(a.type) || !isOpticalEndpointNodeType(b.type)) {
        errors.push(`Оптика id=${e.id}: только между муфтами и/или кроссами`);
      }
      if (e.project_id == null || !projectIds.has(e.project_id)) {
        errors.push(`Оптика id=${e.id}: нужен существующий project_id`);
      }
    }
    if (e.type === "OPTOVOLOKNO") {
      if (!e.cable_name || e.total_fibers == null || e.used_fibers == null) {
        errors.push(`Оптика id=${e.id}: нужны cable_name, total_fibers, used_fibers`);
      } else if (e.used_fibers > e.total_fibers) {
        errors.push(`Оптика id=${e.id}: used_fibers не может быть больше total_fibers`);
      }
    }
  }

  return errors;
}

function existingIds(table) {
  return new Set(db.prepare(`SELECT id FROM ${table}`).all().map((r) => r.id));
}

function allocateImportIds(rows, table, opts = {}) {
  const remapTakenIds = Boolean(opts.remapTakenIds);
  const taken = existingIds(table);
  let maxId = db.prepare(`SELECT IFNULL(MAX(id), 0) AS m FROM ${table}`).get().m;
  const out = [];
  const remapped = [];
  for (const row of rows) {
    const copy = { ...row };
    const requestedId = copy.id != null ? copy.id : null;
    if (copy.id != null && taken.has(copy.id)) {
      if (remapTakenIds) {
        remapped.push({ table, from: copy.id, name: copy.name ?? "" });
        delete copy.id;
      } else {
        const err = new Error(`id ${copy.id} уже занят (${table})`);
        err.status = 409;
        throw err;
      }
    }
    if (copy.id == null) {
      do {
        maxId += 1;
      } while (taken.has(maxId));
      copy.id = maxId;
      taken.add(maxId);
      if (requestedId != null && remapTakenIds) {
        remapped[remapped.length - 1].to = copy.id;
      }
    } else {
      taken.add(copy.id);
    }
    out.push(copy);
  }
  return { rows: out, remapped };
}

function loadProjectsForImport() {
  return db.prepare("SELECT id, name, description, created_at FROM projects ORDER BY id ASC").all();
}

function loadNodesForImport() {
  return db
    .prepare("SELECT id, type, name, lat, lng, parent_tk_id, passport_data, created_at, updated_at FROM nodes ORDER BY id ASC")
    .all()
    .map((n) => ({
      id: n.id,
      type: n.type,
      name: n.name,
      lat: n.lat,
      lng: n.lng,
      parent_tk_id: n.parent_tk_id ?? null,
      passport_data: typeof n.passport_data === "string" ? JSON.parse(n.passport_data || "{}") : n.passport_data ?? {},
      created_at: n.created_at,
      updated_at: n.updated_at,
    }));
}

function loadEdgesForImport() {
  return db
    .prepare(
      `SELECT id, type, start_node_id, end_node_id, length_m, geometry, cable_name, total_fibers, used_fibers, project_id, passport_data, cable_status, created_at, updated_at
       FROM edges ORDER BY id ASC`
    )
    .all()
    .map((e) => ({
      id: e.id,
      type: e.type,
      start_node_id: e.start_node_id,
      end_node_id: e.end_node_id,
      length_m: e.length_m,
      geometry: typeof e.geometry === "string" ? JSON.parse(e.geometry) : e.geometry,
      cable_name: e.cable_name ?? null,
      total_fibers: e.total_fibers ?? null,
      used_fibers: e.used_fibers ?? null,
      project_id: e.project_id ?? null,
      cable_status: e.cable_status ?? null,
      passport_data: typeof e.passport_data === "string" ? JSON.parse(e.passport_data || "{}") : e.passport_data ?? {},
      created_at: e.created_at,
      updated_at: e.updated_at,
    }));
}

app.get("/database/export", requireAuth, requireAdmin, (_req, res) => {
  const projects = db.prepare("SELECT id, name, description, created_at FROM projects ORDER BY id ASC").all();
  const nodesAll = db.prepare("SELECT * FROM nodes ORDER BY id ASC").all().map(parseRow);
  const nodesOrdered = [...nodesAll.filter((n) => n.type !== "MUFTA"), ...nodesAll.filter((n) => n.type === "MUFTA")];
  const edgesRaw = db
    .prepare(
      `SELECT id, type, start_node_id, end_node_id, length_m, geometry, cable_name, total_fibers, used_fibers, project_id, passport_data, cable_status, created_at, updated_at
       FROM edges ORDER BY id ASC`
    )
    .all()
    .map(parseRow);

  res.json({
    format: "gis-database",
    version: 1,
    exported_at: new Date().toISOString(),
    projects,
    nodes: nodesOrdered.map((n) => ({
      id: n.id,
      type: n.type,
      name: n.name,
      lat: n.lat,
      lng: n.lng,
      parent_tk_id: n.parent_tk_id ?? null,
      passport_data: n.passport_data ?? {},
      created_at: n.created_at,
      updated_at: n.updated_at,
    })),
    edges: edgesRaw.map((e) => ({
      id: e.id,
      type: e.type,
      start_node_id: e.start_node_id,
      end_node_id: e.end_node_id,
      length_m: e.length_m,
      geometry: e.geometry,
      cable_name: e.cable_name ?? null,
      total_fibers: e.total_fibers ?? null,
      used_fibers: e.used_fibers ?? null,
      project_id: e.project_id,
      cable_status: e.cable_status ?? null,
      passport_data: e.passport_data ?? {},
      created_at: e.created_at,
      updated_at: e.updated_at,
    })),
  });
});

app.post("/database/import", requireAuth, requireAdmin, (req, res) => {
  const parsed = importDatabaseBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Неверный JSON импорта", issues: parsed.error.flatten() });

  const { projects, nodes, edges } = parsed.data;
  const graphErrors = validateImportGraph(projects, nodes, edges);
  if (graphErrors.length) return res.status(400).json({ message: graphErrors.join("; ") });

  const tx = db.transaction(() => {
    db.pragma("foreign_keys", "OFF");
    db.prepare("DELETE FROM fiber_orders").run();
    db.prepare("DELETE FROM edges").run();
    db.prepare("DELETE FROM nodes").run();
    db.prepare("DELETE FROM projects").run();

    for (const p of projects) {
      db.prepare(
        "INSERT INTO projects (id, name, description, created_at) VALUES (?, ?, ?, COALESCE(?, datetime('now')))"
      ).run(p.id, p.name, p.description ?? "", p.created_at ?? null);
    }
    const nodeInsert = db.prepare(
      `INSERT INTO nodes (id, type, name, lat, lng, parent_tk_id, passport_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`
    );
    for (const n of nodes) {
      nodeInsert.run(
        n.id,
        n.type,
        n.name,
        n.lat,
        n.lng,
        n.parent_tk_id ?? null,
        JSON.stringify(n.passport_data ?? {}),
        n.created_at ?? null,
        n.updated_at ?? null
      );
    }
    const edgeInsert = db.prepare(
      `INSERT INTO edges (id, type, start_node_id, end_node_id, length_m, geometry, cable_name, total_fibers, used_fibers, project_id, passport_data, cable_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`
    );
    for (const e of edges) {
      const cableStatus =
        e.type === "OPTOVOLOKNO" ? e.cable_status ?? "READY" : null;
      edgeInsert.run(
        e.id,
        e.type,
        e.start_node_id,
        e.end_node_id,
        e.length_m,
        JSON.stringify(e.geometry),
        e.cable_name ?? null,
        e.total_fibers ?? null,
        e.used_fibers ?? null,
        e.project_id ?? null,
        JSON.stringify(e.passport_data ?? {}),
        cableStatus,
        e.created_at ?? null,
        e.updated_at ?? null
      );
    }
    db.pragma("foreign_keys", "ON");
    syncSqliteSequences();
    rebalanceMuftasAfterImport(db, nodes, MUFTA_ATTACH_MAX_METERS);
  });

  try {
    tx();
  } catch (err) {
    return res.status(400).json({ message: err.message || String(err) });
  }
  afterWorkspaceMutation(req, "import", null, "replace");
  res.json({ ok: true });
});

function buildDatabaseHealthReport() {
  const issues = [];
  const nodes = loadNodesForImport();
  const edges = loadEdgesForImport();
  const projects = loadProjectsForImport();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const projectIds = new Set(projects.map((p) => p.id));

  for (const n of nodes) {
    if (n.type === "MUFTA" && n.parent_tk_id == null) {
      issues.push({ severity: "warn", code: "mufta_no_parent", message: `Муфта id=${n.id}: нет parent_tk_id`, entity: "node", id: n.id });
    }
  }
  for (const e of edges) {
    const a = nodeById.get(e.start_node_id);
    const b = nodeById.get(e.end_node_id);
    if (!a || !b) {
      issues.push({ severity: "error", code: "edge_bad_nodes", message: `Участок id=${e.id}: неверные узлы`, entity: "edge", id: e.id });
      continue;
    }
    if (e.type === "KANALIZACIYA" && (a.type !== "TK" || b.type !== "TK")) {
      issues.push({ severity: "error", code: "kanal_not_tk", message: `Канализация id=${e.id}: только ТК–ТК`, entity: "edge", id: e.id });
    }
    if (e.type === "OPTOVOLOKNO") {
      if (!isOpticalEndpointNodeType(a.type) || !isOpticalEndpointNodeType(b.type)) {
        issues.push({ severity: "error", code: "optical_bad_endpoints", message: `Оптика id=${e.id}: только муфта/кросс`, entity: "edge", id: e.id });
      }
      if (!e.cable_name || e.total_fibers == null || e.used_fibers == null) {
        issues.push({ severity: "warn", code: "optical_missing_cable", message: `Оптика id=${e.id}: нет cable_name / fibers`, entity: "edge", id: e.id });
      }
      if (e.project_id == null || !projectIds.has(e.project_id)) {
        issues.push({ severity: "error", code: "optical_bad_project", message: `Оптика id=${e.id}: нет project_id`, entity: "edge", id: e.id });
      }
    }
  }
  return {
    ok: issues.filter((i) => i.severity === "error").length === 0,
    summary: {
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warn").length,
    },
    issues,
  };
}

const workspaceNameSchema = z.object({
  name: z.string().min(2).max(64).trim(),
});

app.get("/database/workspaces", requireAuth, (_req, res) => {
  res.json(listWorkspaces());
});

app.get("/database/workspaces/active", requireAuth, (_req, res) => {
  try {
    res.json(getActiveWorkspace());
  } catch (err) {
    res.status(500).json({ message: err.message || String(err) });
  }
});

app.get("/database/workspaces/mine", requireAuth, (req, res) => {
  try {
    res.json({
      workspaces: listWorkspacesForUser(req.authUser.id),
      active: getUserWorkspace(req.authUser.id),
    });
  } catch (err) {
    res.status(500).json({ message: err.message || String(err) });
  }
});

app.put("/database/workspaces/mine", requireAuth, (req, res) => {
  const parsed = workspaceNameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  try {
    res.json(setUserWorkspaceByName(req.authUser.id, parsed.data.name));
  } catch (err) {
    res.status(400).json({ message: err.message || String(err) });
  }
});

app.put("/database/workspaces/active", requireAuth, requireAdmin, (req, res) => {
  const parsed = workspaceNameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  try {
    res.json(setActiveWorkspaceByName(parsed.data.name));
  } catch (err) {
    res.status(400).json({ message: err.message || String(err) });
  }
});

app.get("/sync/summary", requireAuth, (req, res) => {
  const db = req.workspaceDb;
  const revision = getDataRevision(db);
  let activeWorkspace;
  try {
    activeWorkspace = getUserWorkspace(req.authUser.id);
  } catch {
    activeWorkspace = { slug: req.workspaceSlug };
  }
  res.json({
    revision,
    activeWorkspace,
    workspaceSlug: req.workspaceSlug,
    serverTime: new Date().toISOString(),
  });
});

app.get("/activity", requireAuth, requireAdmin, (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  res.json(listActivityEvents(systemDb, limit));
});

app.post("/database/workspaces", requireAuth, requireAdmin, (req, res) => {
  const parsed = workspaceNameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  try {
    const created = createWorkspace(parsed.data.name);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ message: err.message || String(err) });
  }
});

app.delete("/database/workspaces", requireAuth, requireAdmin, (req, res) => {
  const parsed = workspaceNameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  try {
    res.json(deleteWorkspace(parsed.data.name));
  } catch (err) {
    res.status(400).json({ message: err.message || String(err) });
  }
});

app.get("/database/health-report", requireAuth, requireAdmin, (_req, res) => {
  res.json(buildDatabaseHealthReport());
});

app.post("/database/repair-edge-bbox", requireAuth, requireAdmin, (_req, res) => {
  const { updated } = backfillEdgeBboxes(db);
  res.json({ ok: true, updated });
});

app.post("/database/import/append", requireAuth, requireAdmin, (req, res) => {
  try {
  const parsed = importDatabaseAppendBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Неверный JSON импорта", issues: parsed.error.flatten() });

  const remapTakenIds = Boolean(parsed.data.remapTakenIds);
  let projects;
  let nodes;
  let edges;
  const allRemapped = [];
  try {
    const p = allocateImportIds(parsed.data.projects, "projects", { remapTakenIds });
    const n = allocateImportIds(parsed.data.nodes, "nodes", { remapTakenIds });
    const e = allocateImportIds(parsed.data.edges, "edges", { remapTakenIds });
    projects = p.rows;
    nodes = n.rows;
    edges = e.rows;
    allRemapped.push(...p.remapped, ...n.remapped, ...e.remapped);
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ message: err.message });
    return res.status(500).json({ message: err.message || String(err) });
  }

  const graphErrors = validateImportAppend(projects, nodes, edges);
  if (graphErrors.length) return res.status(400).json({ message: graphErrors.join("; ") });

  const tx = db.transaction(() => {
    for (const p of projects) {
      db.prepare(
        "INSERT INTO projects (id, name, description, created_at) VALUES (?, ?, ?, COALESCE(?, datetime('now')))"
      ).run(p.id, p.name, p.description ?? "", p.created_at ?? null);
    }
    const nodeInsert = db.prepare(
      `INSERT INTO nodes (id, type, name, lat, lng, parent_tk_id, passport_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`
    );
    for (const n of nodes) {
      nodeInsert.run(
        n.id,
        n.type,
        n.name,
        n.lat,
        n.lng,
        n.parent_tk_id ?? null,
        JSON.stringify(n.passport_data ?? {}),
        n.created_at ?? null,
        n.updated_at ?? null
      );
    }
    const edgeInsert = db.prepare(
      `INSERT INTO edges (id, type, start_node_id, end_node_id, length_m, geometry, cable_name, total_fibers, used_fibers, project_id, passport_data, cable_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`
    );
    for (const e of edges) {
      const cableStatus = e.type === "OPTOVOLOKNO" ? e.cable_status ?? "READY" : null;
      edgeInsert.run(
        e.id,
        e.type,
        e.start_node_id,
        e.end_node_id,
        e.length_m,
        JSON.stringify(e.geometry),
        e.cable_name ?? null,
        e.total_fibers ?? null,
        e.used_fibers ?? null,
        e.project_id ?? null,
        JSON.stringify(e.passport_data ?? {}),
        cableStatus,
        e.created_at ?? null,
        e.updated_at ?? null
      );
    }
    syncSqliteSequences();
    rebalanceMuftasAfterImport(db, nodes, MUFTA_ATTACH_MAX_METERS);
  });

  try {
    tx();
  } catch (err) {
    return res.status(400).json({ message: err.message || String(err) });
  }
  afterWorkspaceMutation(req, "import", null, "append");
  res.json({
    ok: true,
    added: { projects: projects.length, nodes: nodes.length, edges: edges.length },
    remapped: allRemapped,
  });
  } catch (err) {
    res.status(500).json({ message: err.message || String(err) });
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(4).max(128),
});

app.post("/auth/change-password", requireAuth, (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const row = systemDb.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.authUser.id);
  if (!row || !bcrypt.compareSync(parsed.data.currentPassword, row.password_hash)) {
    return res.status(401).json({ message: "Неверный текущий пароль" });
  }
  const hash = bcrypt.hashSync(parsed.data.newPassword, 10);
  systemDb.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, req.authUser.id);
  res.json({ ok: true });
});

app.get("/app/config", requireAuth, (_req, res) => {
  res.json(readAppConfig());
});

app.put("/app/config", requireAuth, requireAdmin, (req, res) => {
  const config = writeAppConfig({ userDataReadOnly: Boolean(req.body?.userDataReadOnly) });
  res.json(config);
});

app.get("/export/kml", requireAuth, (req, res) => {
  const projectId = req.query.project_id != null && req.query.project_id !== "" ? Number(req.query.project_id) : null;
  const includeNodes = req.query.nodes !== "0";
  const volsOnly = req.query.vols_only === "1" || req.query.vols_only === "true";
  const kml = buildKml({
    projectId: Number.isFinite(projectId) ? projectId : null,
    includeNodes,
    volsOnly,
  });
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="gis-trassy-${stamp}.kml"`);
  res.send(kml);
});

app.get("/export/geojson", requireAuth, requireAdmin, (req, res) => {
  const typesRaw = typeof req.query.types === "string" ? req.query.types : "TK";
  const types = typesRaw
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => ["TK", "MUFTA", "PIKET", "KROSS"].includes(t));
  const { bbox } = parseNodesQuery(req);
  const where = [];
  const params = [];
  if (types.length) {
    where.push(`type IN (${types.map(() => "?").join(",")})`);
    params.push(...types);
  }
  if (bbox) {
    where.push("lat >= ? AND lat <= ? AND lng >= ? AND lng <= ?");
    params.push(bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM nodes ${whereSql} ORDER BY id ASC`).all(...params).map(parseRow);
  const fc = exportNodesGeoJson(rows, types.length ? types : null);
  const stamp = new Date().toISOString().slice(0, 10);
  if (req.query.download === "1") {
    res.setHeader("Content-Type", "application/geo+json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="gis-nodes-${stamp}.geojson"`);
  }
  res.json(fc);
});

app.post("/import/geojson", requireAuth, requireAdmin, (req, res) => {
  const defaultType = typeof req.body?.defaultType === "string" ? req.body.defaultType : "TK";
  const { nodes: parsedNodes, errors: parseErrors } = parseGeoJsonImport(req.body?.geojson ?? req.body, defaultType);
  if (!parsedNodes.length) {
    return res.status(400).json({ message: parseErrors.join("; ") || "Нет объектов в GeoJSON" });
  }
  const remapTakenIds = Boolean(req.body?.remapTakenIds);
  let nodes;
  const allRemapped = [];
  try {
    const n = allocateImportIds(parsedNodes, "nodes", { remapTakenIds });
    nodes = n.rows;
    allRemapped.push(...n.remapped);
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ message: err.message });
    return res.status(500).json({ message: err.message || String(err) });
  }
  const graphErrors = validateImportAppend([], nodes, []);
  if (graphErrors.length) return res.status(400).json({ message: graphErrors.join("; ") });
  const tx = db.transaction(() => {
    const nodeInsert = db.prepare(
      `INSERT INTO nodes (id, type, name, lat, lng, parent_tk_id, passport_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    );
    for (const n of nodes) {
      nodeInsert.run(n.id, n.type, n.name, n.lat, n.lng, n.parent_tk_id ?? null, JSON.stringify(n.passport_data ?? {}));
    }
    syncSqliteSequences();
  });
  try {
    tx();
  } catch (err) {
    return res.status(500).json({ message: err.message || String(err) });
  }
  res.json({
    ok: true,
    added: { projects: 0, nodes: nodes.length, edges: 0 },
    remapped: allRemapped,
    parseWarnings: parseErrors,
  });
});

app.get("/backups", requireAuth, (_req, res) => {
  res.json({
    config: readBackupConfig(),
    backups: listBackupFiles(),
  });
});

app.put("/backups/config", requireAuth, requireAdmin, (req, res) => {
  const body = req.body || {};
  const config = writeBackupConfig({
    enabled: Boolean(body.enabled),
    intervalMinutes: Number(body.intervalMinutes),
    maxBackups: Number(body.maxBackups),
  });
  res.json({ config });
});

app.post("/backups/run", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const entry = await runBackup(req.workspaceSlug);
    res.status(201).json({ backup: entry, backups: listBackupFiles() });
  } catch (err) {
    res.status(500).json({ message: err.message || String(err) });
  }
});

app.post("/backups/:filename/restore", requireAuth, requireAdmin, (req, res) => {
  try {
    restoreBackup(req.params.filename, req.workspaceSlug);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: err.message || String(err) });
  }
});

app.delete("/backups/:filename", requireAuth, requireAdmin, (req, res) => {
  try {
    deleteBackup(req.params.filename);
    res.json({ ok: true, backups: listBackupFiles() });
  } catch (err) {
    res.status(400).json({ message: err.message || String(err) });
  }
});

app.get("/backups/:filename/info", requireAuth, (req, res) => {
  try {
    res.json(getBackupInfo(req.params.filename));
  } catch (err) {
    res.status(400).json({ message: err.message || String(err) });
  }
});

app.get("/backups/:filename/download", requireAuth, (req, res) => {
  try {
    const filePath = getBackupFilePath(req.params.filename);
    res.download(filePath, req.params.filename);
  } catch (err) {
    res.status(400).json({ message: err.message || String(err) });
  }
});

initBackupScheduler();

registerBitrixRoutes(app, {
  jwt,
  JWT_SECRET,
  db,
  systemDb,
  parseRow,
  requireAuth,
  requireAdmin,
  getOrOpenWorkspaceBySlug,
  fiberCableStatusSchema,
});

app.use((_req, res) => {
  res.status(404).json({ message: "Маршрут API не найден. Перезапустите backend на актуальной версии." });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  const status =
    typeof err.status === "number"
      ? err.status
      : typeof err.statusCode === "number"
        ? err.statusCode
        : 500;
  const code = status >= 400 && status < 600 ? status : 500;
  res.status(code).json({ message: err.message || "Внутренняя ошибка сервера" });
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

const server = app.listen(PORT, HOST);
server.on("listening", () => {
  console.log(`GIS backend listening on http://127.0.0.1:${PORT} (HOST=${HOST})`);
  console.log(`  С другого ПК: http://<IP-этого-Mac>:${PORT}/health`);
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Порт ${PORT} занят — вероятно запущен старый backend. Остановите его (например: lsof -ti :${PORT} | xargs kill) и перезапустите приложение.`
    );
  } else {
    console.error("Не удалось открыть порт:", err.message);
  }
  process.exit(1);
});
