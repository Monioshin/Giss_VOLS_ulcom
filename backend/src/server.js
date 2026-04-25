const express = require("express");
const cors = require("cors");
const { z } = require("zod");
const { db, parseRow, seedIfEmpty } = require("./db");

const app = express();
const PORT = process.env.PORT || 4000;
const MUFTA_ATTACH_MAX_METERS = 2;
const API_VERSION = "mvp-2026-04-23-fibers-routes";

app.use(cors());
app.use(express.json());
seedIfEmpty();

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
  project_id: z.number().int().positive(),
  cable_name: z.string().optional().nullable(),
  total_fibers: z.number().int().nonnegative().optional().nullable(),
  used_fibers: z.number().int().nonnegative().optional().nullable(),
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

app.get("/routes", (req, res) => {
  const startId = Number(req.query.start_node_id);
  const endId = Number(req.query.end_node_id);
  const requiredFreeFibers = Number(req.query.required_free_fibers || 1);
  if (!Number.isInteger(startId) || !Number.isInteger(endId) || !Number.isInteger(requiredFreeFibers)) {
    return res.status(400).json({ message: "Invalid route query" });
  }

  const startNode = db.prepare("SELECT id, type FROM nodes WHERE id = ?").get(startId);
  const endNode = db.prepare("SELECT id, type FROM nodes WHERE id = ?").get(endId);
  if (!startNode || !endNode || startNode.type !== "MUFTA" || endNode.type !== "MUFTA") {
    return res.status(400).json({ message: "Route points must be MUFTA nodes" });
  }

  const opticalEdges = db
    .prepare(
      `SELECT e.*, sn.name AS start_node_name, en.name AS end_node_name
       FROM edges e
       JOIN nodes sn ON sn.id = e.start_node_id
       JOIN nodes en ON en.id = e.end_node_id
       WHERE e.type = 'OPTOVOLOKNO'`
    )
    .all()
    .map(parseRow)
    .filter((edge) => (edge.total_fibers || 0) - (edge.used_fibers || 0) >= requiredFreeFibers);

  const adjacency = new Map();
  for (const edge of opticalEdges) {
    if (!adjacency.has(edge.start_node_id)) adjacency.set(edge.start_node_id, []);
    if (!adjacency.has(edge.end_node_id)) adjacency.set(edge.end_node_id, []);
    adjacency.get(edge.start_node_id).push({ next: edge.end_node_id, edge });
    adjacency.get(edge.end_node_id).push({ next: edge.start_node_id, edge });
  }

  const routes = [];
  const dfs = (nodeId, visitedNodes, visitedEdges, totalLength) => {
    if (routes.length >= 20) return;
    if (nodeId === endId) {
      routes.push({
        edge_ids: [...visitedEdges],
        node_ids: [...visitedNodes],
        total_length_m: Math.round(totalLength),
      });
      return;
    }
    const candidates = adjacency.get(nodeId) || [];
    for (const candidate of candidates) {
      if (visitedNodes.includes(candidate.next)) continue;
      dfs(
        candidate.next,
        [...visitedNodes, candidate.next],
        [...visitedEdges, candidate.edge.id],
        totalLength + candidate.edge.length_m
      );
    }
  };

  dfs(startId, [startId], [], 0);
  routes.sort((a, b) => a.total_length_m - b.total_length_m);
  res.json({ routes });
});

app.get("/projects", (_req, res) => {
  const rows = db
    .prepare("SELECT id, name, description, created_at FROM projects ORDER BY id DESC")
    .all();
  res.json(rows);
});

app.delete("/projects/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid ID" });
  const existing = db.prepare("SELECT id FROM projects WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ message: "Project not found" });

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM edges WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  });
  tx();
  res.status(204).send();
});

app.post("/projects", (req, res) => {
  const parsed = projectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const { name, description = "" } = parsed.data;
  const result = db
    .prepare("INSERT INTO projects (name, description) VALUES (?, ?)")
    .run(name, description);
  const project = db
    .prepare("SELECT id, name, description, created_at FROM projects WHERE id = ?")
    .get(result.lastInsertRowid);
  res.status(201).json(project);
});

app.get("/nodes", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM nodes ORDER BY id DESC")
    .all()
    .map(parseRow);
  res.json(rows);
});

app.post("/nodes", (req, res) => {
  const parsed = nodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const { type, name, lat, lng, parent_tk_id = null, passport_data = {} } = parsed.data;
  if (type === "MUFTA") {
    if (!parent_tk_id) return res.status(400).json({ message: "MUFTA must reference parent TK" });
    const tk = db.prepare("SELECT id, type, lat, lng FROM nodes WHERE id = ?").get(parent_tk_id);
    if (!tk || tk.type !== "TK") return res.status(400).json({ message: "parent_tk_id must reference TK node" });
    const distance = haversineMeters([lat, lng], [tk.lat, tk.lng]);
    if (distance > MUFTA_ATTACH_MAX_METERS) {
      return res.status(400).json({ message: "MUFTA must be placed on TK coordinates" });
    }
  }
  if (type !== "MUFTA" && parent_tk_id) {
    return res.status(400).json({ message: "Only MUFTA can have parent_tk_id" });
  }
  const result = db
    .prepare(
      `INSERT INTO nodes (type, name, lat, lng, parent_tk_id, passport_data)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(type, name, lat, lng, parent_tk_id, JSON.stringify(passport_data));
  const row = db.prepare("SELECT * FROM nodes WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(parseRow(row));
});

app.put("/nodes/:id", (req, res) => {
  const id = Number(req.params.id);
  const parsed = nodeSchema.partial().safeParse(req.body);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid ID" });
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const existing = db.prepare("SELECT * FROM nodes WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ message: "Node not found" });

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
      return res.status(400).json({ message: "MUFTA must be placed on TK coordinates" });
    }
  }
  if (nextType !== "MUFTA" && nextParentTkId) {
    return res.status(400).json({ message: "Only MUFTA can have parent_tk_id" });
  }
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

  const updated = db.prepare("SELECT * FROM nodes WHERE id = ?").get(id);
  res.json(parseRow(updated));
});

app.delete("/nodes/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid ID" });

  const existing = db.prepare("SELECT * FROM nodes WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ message: "Node not found" });

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
  });
  tx();
  res.status(204).send();
});

app.get("/edges", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT
        e.*,
        p.name AS project_name,
        sn.name AS start_node_name,
        en.name AS end_node_name
      FROM edges e
      JOIN projects p ON p.id = e.project_id
      JOIN nodes sn ON sn.id = e.start_node_id
      JOIN nodes en ON en.id = e.end_node_id
      ORDER BY e.id DESC`
    )
    .all()
    .map(parseRow);
  res.json(rows);
});

app.post("/edges", (req, res) => {
  const parsed = edgeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const payload = parsed.data;
  const projectExists = db.prepare("SELECT id FROM projects WHERE id = ?").get(payload.project_id);
  const startExists = db.prepare("SELECT id, type FROM nodes WHERE id = ?").get(payload.start_node_id);
  const endExists = db.prepare("SELECT id, type FROM nodes WHERE id = ?").get(payload.end_node_id);
  if (!projectExists || !startExists || !endExists) {
    return res.status(400).json({ message: "Invalid project or node reference" });
  }
  if (startExists.type !== "MUFTA" || endExists.type !== "MUFTA") {
    return res.status(400).json({ message: "Edges must start and end at MUFTA nodes" });
  }
  if (payload.type === "OPTOVOLOKNO") {
    if (!payload.cable_name || payload.total_fibers == null || payload.used_fibers == null) {
      return res.status(400).json({ message: "OPTOVOLOKNO requires cable_name, total_fibers, used_fibers" });
    }
    if (payload.used_fibers > payload.total_fibers) {
      return res.status(400).json({ message: "used_fibers cannot exceed total_fibers" });
    }
  }

  const result = db
    .prepare(
      `INSERT INTO edges
      (type, start_node_id, end_node_id, length_m, geometry, cable_name, total_fibers, used_fibers, project_id, passport_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      payload.project_id,
      JSON.stringify(payload.passport_data || {})
    );

  const row = db
    .prepare(
      `SELECT
        e.*,
        p.name AS project_name,
        sn.name AS start_node_name,
        en.name AS end_node_name
      FROM edges e
      JOIN projects p ON p.id = e.project_id
      JOIN nodes sn ON sn.id = e.start_node_id
      JOIN nodes en ON en.id = e.end_node_id
      WHERE e.id = ?`
    )
    .get(result.lastInsertRowid);
  res.status(201).json(parseRow(row));
});

app.put("/edges/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid ID" });

  const parsed = edgeSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const existing = db.prepare("SELECT * FROM edges WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ message: "Edge not found" });

  const oldGeometry = JSON.parse(existing.geometry || "[]");
  const oldPassport = JSON.parse(existing.passport_data || "{}");
  const patch = parsed.data;
  const nextStartNodeId = patch.start_node_id ?? existing.start_node_id;
  const nextEndNodeId = patch.end_node_id ?? existing.end_node_id;
  const nextStart = db.prepare("SELECT id, type FROM nodes WHERE id = ?").get(nextStartNodeId);
  const nextEnd = db.prepare("SELECT id, type FROM nodes WHERE id = ?").get(nextEndNodeId);
  if (!nextStart || !nextEnd) return res.status(400).json({ message: "Invalid node reference" });
  const nextType = patch.type ?? existing.type;
  if (nextStart.type !== "MUFTA" || nextEnd.type !== "MUFTA") {
    return res.status(400).json({ message: "Edges must start and end at MUFTA nodes" });
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

  db.prepare(
    `UPDATE edges
     SET type = ?, start_node_id = ?, end_node_id = ?, length_m = ?, geometry = ?, cable_name = ?, total_fibers = ?, used_fibers = ?, project_id = ?, passport_data = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    nextType,
    patch.start_node_id ?? existing.start_node_id,
    patch.end_node_id ?? existing.end_node_id,
    patch.length_m ?? existing.length_m,
    JSON.stringify(patch.geometry ?? oldGeometry),
    patch.cable_name ?? existing.cable_name,
    patch.total_fibers ?? existing.total_fibers,
    patch.used_fibers ?? existing.used_fibers,
    patch.project_id ?? existing.project_id,
    JSON.stringify(patch.passport_data ?? oldPassport),
    id
  );

  const row = db
    .prepare(
      `SELECT
        e.*,
        p.name AS project_name,
        sn.name AS start_node_name,
        en.name AS end_node_name
      FROM edges e
      JOIN projects p ON p.id = e.project_id
      JOIN nodes sn ON sn.id = e.start_node_id
      JOIN nodes en ON en.id = e.end_node_id
      WHERE e.id = ?`
    )
    .get(id);
  res.json(parseRow(row));
});

app.delete("/edges/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid ID" });
  const existing = db.prepare("SELECT id FROM edges WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ message: "Edge not found" });
  db.prepare("DELETE FROM edges WHERE id = ?").run(id);
  res.status(204).send();
});

app.listen(PORT, () => {
  console.log(`GIS backend listening on http://localhost:${PORT}`);
});
