/**
 * Создание участка канализации по названиям начального и конечного ТК.
 */

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

function escapeLike(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} name
 * @returns {{ ok: true, node: object } | { ok: false, code: string, message: string, candidates?: { id: number, name: string }[] }}
 */
function resolveTkByName(db, name) {
  const q = String(name ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!q) {
    return { ok: false, code: "empty", message: "Укажите название ТК" };
  }

  if (/^\d+$/.test(q)) {
    const byId = db.prepare("SELECT * FROM nodes WHERE type = 'TK' AND id = ?").get(Number(q));
    if (byId) return { ok: true, node: byId };
  }

  const exact = db
    .prepare(`SELECT * FROM nodes WHERE type = 'TK' AND name = ? COLLATE NOCASE`)
    .get(q);
  if (exact) return { ok: true, node: exact };

  const like = `%${escapeLike(q)}%`;
  const candidates = db
    .prepare(
      `SELECT id, name FROM nodes WHERE type = 'TK' AND name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT 10`,
    )
    .all(like);

  if (candidates.length === 0) {
    return { ok: false, code: "not_found", message: `ТК «${q}» не найден в базе` };
  }
  if (candidates.length === 1) {
    const node = db.prepare("SELECT * FROM nodes WHERE id = ?").get(candidates[0].id);
    return node ? { ok: true, node } : { ok: false, code: "not_found", message: `ТК «${q}» не найден в базе` };
  }

  return {
    ok: false,
    code: "ambiguous",
    message: `По запросу «${q}» найдено несколько ТК — уточните название`,
    candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
  };
}

function buildKanalGeometry(startNode, endNode) {
  return [
    [startNode.lat, startNode.lng],
    [endNode.lat, endNode.lng],
  ];
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {(row: object) => object} parseRow
 * @param {(db: import('better-sqlite3').Database, edgeId: number, geometry: [number, number][]) => void} syncEdgeGeomBbox
 * @param {{ start_tk_name: string, end_tk_name: string, length_m: number, passport_data?: Record<string, unknown> }} payload
 */
function createKanalLink(db, parseRow, syncEdgeGeomBbox, payload) {
  const startRes = resolveTkByName(db, payload.start_tk_name);
  if (!startRes.ok) return startRes;

  const endRes = resolveTkByName(db, payload.end_tk_name);
  if (!endRes.ok) return endRes;

  const startNode = startRes.node;
  const endNode = endRes.node;

  if (startNode.id === endNode.id) {
    return {
      ok: false,
      code: "same_node",
      message: "Начальный и конечный ТК должны быть разными колодцами",
    };
  }

  const geometry = buildKanalGeometry(startNode, endNode);
  const passport = {
    ...(payload.passport_data && typeof payload.passport_data === "object" ? payload.passport_data : {}),
    catalog_length_m: payload.length_m,
  };

  const result = db
    .prepare(
      `INSERT INTO edges
      (type, start_node_id, end_node_id, length_m, geometry, cable_name, total_fibers, used_fibers, project_id, passport_data, cable_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "KANALIZACIYA",
      startNode.id,
      endNode.id,
      payload.length_m,
      JSON.stringify(geometry),
      null,
      null,
      null,
      null,
      JSON.stringify(passport),
      null,
    );

  const row = db.prepare(`${EDGE_SELECT_SQL} WHERE e.id = ?`).get(result.lastInsertRowid);
  syncEdgeGeomBbox(db, row.id, geometry);
  const edge = parseRow(row);
  return { ok: true, edge };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {(row: object) => object} parseRow
 * @param {(db: import('better-sqlite3').Database, edgeId: number, geometry: [number, number][]) => void} syncEdgeGeomBbox
 * @param {{ row?: number, start_tk_name: string, end_tk_name: string, length_m: number, passport_data?: Record<string, unknown> }[]} rows
 */
function createKanalLinksBulk(db, parseRow, syncEdgeGeomBbox, rows) {
  const created = [];
  const errors = [];
  for (const item of rows) {
    const rowNum = item.row ?? 0;
    const result = createKanalLink(db, parseRow, syncEdgeGeomBbox, {
      start_tk_name: item.start_tk_name,
      end_tk_name: item.end_tk_name,
      length_m: item.length_m,
      passport_data: item.passport_data,
    });
    if (!result.ok) {
      errors.push({
        row: rowNum,
        message: result.message,
        code: result.code,
        candidates: result.candidates,
      });
    } else {
      created.push({ row: rowNum, edge: result.edge });
    }
  }
  return { created, errors };
}

module.exports = {
  resolveTkByName,
  buildKanalGeometry,
  createKanalLink,
  createKanalLinksBulk,
  EDGE_SELECT_SQL,
};
