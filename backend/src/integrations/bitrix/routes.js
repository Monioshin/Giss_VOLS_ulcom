const { z } = require("zod");
const { findOpticalRoutes } = require("../../routesEngine");
const { getBitrixInboundSecret, getGisPublicUrl } = require("./config");
const {
  notifyBitrixAccident,
  notifyBitrixDealRouteCheck,
  notifyBitrixDealProjectCreated,
  haversineMeters,
} = require("./outbound");
const { getBitrixUfCodes, DEFAULT_UF } = require("./mappers");

function requireBitrixInbound(req, res, next) {
  const secret = getBitrixInboundSecret();
  if (!secret) return res.status(503).json({ message: "BITRIX_INBOUND_SECRET не задан" });
  const got = req.headers["x-gis-bitrix-secret"] || req.query.secret;
  if (got !== secret) return res.status(403).json({ message: "Forbidden" });
  next();
}

const routeCheckBody = z.object({
  start_node_id: z.number().int().positive(),
  end_node_id: z.number().int().positive(),
  required_free_fibers: z.number().int().positive().optional().default(1),
  deal_id: z.number().int().positive().optional().nullable(),
  update_bitrix_deal: z.boolean().optional().default(false),
});

const dealWonBody = z.object({
  deal_id: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  update_bitrix_deal: z.boolean().optional().default(true),
});

const nearestBody = z.object({
  lat: z.number(),
  lng: z.number(),
  limit: z.number().int().positive().max(50).optional().default(10),
});

const webhookBody = z.object({
  type: z.enum(["task_completed", "accident_cleared"]),
  workspace_slug: z.string().min(1),
  edge_id: z.number().int().positive(),
  bitrix_task_id: z.number().int().positive().optional(),
  new_cable_status: z.enum(["READY", "IN_WORK", "OFFLINE", "ACCIDENT", "CONSTRUCTION"]).optional(),
});

const projectEdgesStatusBody = z.object({
  project_id: z.number().int().positive(),
  cable_status: z.enum(["READY", "IN_WORK", "OFFLINE", "ACCIDENT", "CONSTRUCTION"]),
});

function registerBitrixRoutes(app, ctx) {
  const {
    jwt,
    JWT_SECRET,
    db,
    systemDb,
    parseRow,
    requireAuth,
    requireAdmin,
    getOrOpenWorkspaceBySlug,
    fiberCableStatusSchema,
  } = ctx;

  app.get("/integrations/bitrix/field-catalog", requireBitrixInbound, (_req, res) => {
    res.json({
      description: "Создайте в карточке сделки пользовательские поля с этими кодами (или задайте свои через BITRIX_UF_* в .env).",
      defaultUfCodes: DEFAULT_UF,
      configuredUfCodes: getBitrixUfCodes(),
      env: [
        "BITRIX_INBOUND_SECRET",
        "BITRIX_REST_WEBHOOK_URL",
        "GIS_PUBLIC_URL",
        "BITRIX_DEFAULT_TASK_RESPONSIBLE_ID",
        "BITRIX_UF_GIS_PROJECT_ID",
        "BITRIX_UF_GIS_FIBER_ORDER_ID",
        "BITRIX_UF_ROUTE_LENGTH_M",
        "BITRIX_UF_ROUTE_FREE_FIBERS",
        "BITRIX_UF_ROUTE_FOUND",
      ],
    });
  });

  app.post("/integrations/bitrix/route-check", requireBitrixInbound, async (req, res) => {
    const parsed = routeCheckBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    const { start_node_id, end_node_id, required_free_fibers, deal_id, update_bitrix_deal } = parsed.data;

    const r = findOpticalRoutes(db, parseRow, start_node_id, end_node_id, required_free_fibers);
    if (!r.ok) return res.status(400).json({ message: r.message });

    let minFree = null;
    for (const route of r.routes) {
      const edges = route.edge_ids.map((id) => parseRow(db.prepare("SELECT * FROM edges WHERE id = ?").get(id)));
      let m = Infinity;
      for (const e of edges) {
        if (!e || e.type !== "OPTOVOLOKNO") continue;
        const free = (e.total_fibers || 0) - (e.used_fibers || 0);
        m = Math.min(m, free);
      }
      if (Number.isFinite(m)) minFree = minFree == null ? m : Math.max(minFree, m);
    }

    const payload = { routes: r.routes, min_free_fibers_on_route: minFree };
    if (update_bitrix_deal && deal_id) {
      const br = await notifyBitrixDealRouteCheck(deal_id, { ...payload, routes: r.routes });
      return res.json({ ...payload, bitrix: br });
    }
    res.json(payload);
  });

  app.post("/integrations/bitrix/nearest-endpoints", requireBitrixInbound, (req, res) => {
    const parsed = nearestBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    const { lat, lng, limit } = parsed.data;
    const nodes = db
      .prepare(`SELECT id, type, name, lat, lng FROM nodes WHERE type IN ('MUFTA','KROSS')`)
      .all();
    const scored = nodes
      .map((n) => ({
        id: n.id,
        type: n.type,
        name: n.name,
        lat: n.lat,
        lng: n.lng,
        distance_m: Math.round(haversineMeters([lat, lng], [n.lat, n.lng])),
      }))
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, limit);
    res.json({ nodes: scored });
  });

  app.post("/integrations/bitrix/deal-won", requireBitrixInbound, async (req, res) => {
    const parsed = dealWonBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    const { deal_id, title, description, update_bitrix_deal } = parsed.data;
    const ins = db.prepare("INSERT INTO projects (name, description, passport_data) VALUES (?, ?, ?)").run(
      title,
      description ?? "",
      JSON.stringify({ bitrix_deal_id: deal_id }),
    );
    const projectId = Number(ins.lastInsertRowid);
    let bitrix = null;
    if (update_bitrix_deal) bitrix = await notifyBitrixDealProjectCreated(deal_id, projectId);
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
    res.status(201).json({ project: parseRow(row), map_url: `${getGisPublicUrl()}/#map?highlight=project:${projectId}`, bitrix });
  });

  app.post("/integrations/bitrix/project-edges-status", requireBitrixInbound, (req, res) => {
    const parsed = projectEdgesStatusBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    const { project_id, cable_status } = parsed.data;
    const info = db.prepare("SELECT id FROM projects WHERE id = ?").get(project_id);
    if (!info) return res.status(404).json({ message: "Project not found" });
    const r = db
      .prepare(
        `UPDATE edges SET cable_status = ?, updated_at = datetime('now')
         WHERE project_id = ? AND type = 'OPTOVOLOKNO'`,
      )
      .run(cable_status, project_id);
    res.json({ ok: true, changes: r.changes, project_id, cable_status });
  });

  app.post("/integrations/bitrix/webhook", requireBitrixInbound, (req, res) => {
    const parsed = webhookBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    const { type, workspace_slug, edge_id, new_cable_status } = parsed.data;
    const wsDb = getOrOpenWorkspaceBySlug(workspace_slug);
    const edge = wsDb.prepare("SELECT * FROM edges WHERE id = ?").get(edge_id);
    if (!edge || edge.type !== "OPTOVOLOKNO") return res.status(404).json({ message: "Оптический участок не найден" });

    if (type === "task_completed" || type === "accident_cleared") {
      const next = new_cable_status || "READY";
      const st = fiberCableStatusSchema.safeParse(next);
      if (!st.success) return res.status(400).json({ message: "Invalid new_cable_status" });
      wsDb.prepare("UPDATE edges SET cable_status = ?, updated_at = datetime('now') WHERE id = ?").run(st.data, edge_id);
      systemDb.prepare("DELETE FROM bitrix_edge_incidents WHERE workspace_slug = ? AND edge_id = ?").run(workspace_slug, edge_id);
      return res.json({ ok: true, edge_id, cable_status: st.data });
    }
    res.status(400).json({ message: "Unknown webhook type" });
  });

  app.get("/integrations/bitrix/embed-token", requireAuth, requireAdmin, (req, res) => {
    const edgeId = Number(req.query.highlight_edge_id || "") || null;
    const nodeId = Number(req.query.highlight_node_id || "") || null;
    const projectId = Number(req.query.highlight_project_id || "") || null;
    const token = jwt.sign(
      {
        typ: "embed_map",
        scope: "read",
        sub: req.authUser.id,
        edgeId,
        nodeId,
        projectId,
      },
      JWT_SECRET,
      { expiresIn: "15m" },
    );
    const embedUrl = `${getGisPublicUrl()}/#embed=${encodeURIComponent(token)}`;
    res.json({ token, embedUrl, expiresInSeconds: 900 });
  });
}

module.exports = { registerBitrixRoutes, requireBitrixInbound };
