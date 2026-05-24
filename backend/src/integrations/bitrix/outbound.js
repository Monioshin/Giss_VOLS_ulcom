const { bitrixTasksTaskAdd, bitrixCrmDealUpdate } = require("./client");
const { getGisPublicUrl } = require("./config");
const {
  getBitrixUfCodes,
  dealFieldsAfterRouteCheck,
  dealFieldsAfterProjectCreated,
  dealFieldsAfterFiberOrder,
} = require("./mappers");

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

/**
 * @param {import('better-sqlite3').Database} systemDb
 * @param {string} workspaceSlug
 * @param {number} edgeId
 * @param {object} edgeRow parsed edge
 * @param {number} [dealId] optional Bitrix deal to link in description
 */
async function notifyBitrixAccident(systemDb, workspaceSlug, edgeId, edgeRow, dealId) {
  const existing = systemDb
    .prepare("SELECT bitrix_task_id FROM bitrix_edge_incidents WHERE workspace_slug = ? AND edge_id = ?")
    .get(workspaceSlug, edgeId);
  if (existing?.bitrix_task_id) return { skipped: true, reason: "already_notified", taskId: existing.bitrix_task_id };

  const geom = Array.isArray(edgeRow.geometry) ? edgeRow.geometry : [];
  let midLat = 0;
  let midLng = 0;
  if (geom.length) {
    const mid = geom[Math.floor(geom.length / 2)];
    midLat = mid[0];
    midLng = mid[1];
  }
  const title = `Авария ВОЛС: ${edgeRow.cable_name || `участок #${edgeId}`}`;
  const gisUrl = `${getGisPublicUrl()}/#map?highlight=edge:${edgeId}`;
  const descr = [
    `GIS workspace: ${workspaceSlug}`,
    `Участок id: ${edgeId}`,
    `Статус: ACCIDENT`,
    dealId ? `Сделка Bitrix: ${dealId}` : null,
    `Карта: ${gisUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const responsible = Number(process.env.BITRIX_DEFAULT_TASK_RESPONSIBLE_ID || 1);
  const r = await bitrixTasksTaskAdd({
    TITLE: title,
    DESCRIPTION: descr,
    RESPONSIBLE_ID: responsible,
    CREATED_BY: responsible,
  });

  if (r.skipped) return r;
  const raw = r.result?.result;
  let taskId = raw?.task?.id ?? raw?.task?.ID;
  if (taskId == null && typeof raw === "number") taskId = raw;
  if (taskId == null && raw?.id != null) taskId = raw.id;
  if (!r.ok || !taskId) return r;
  systemDb
    .prepare(
      `INSERT INTO bitrix_edge_incidents (workspace_slug, edge_id, bitrix_task_id, created_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(workspace_slug, edge_id) DO UPDATE SET bitrix_task_id = excluded.bitrix_task_id`,
    )
    .run(workspaceSlug, edgeId, Number(taskId));
  return r;
}

async function notifyBitrixDealRouteCheck(dealId, routePayload) {
  const uf = getBitrixUfCodes();
  const best = routePayload.routes?.[0];
  const minFree = routePayload.min_free_fibers_on_route;
  const fields = dealFieldsAfterRouteCheck(uf, {
    bestLengthM: best?.total_length_m ?? "",
    minFreeFibers: minFree ?? "",
    routesCount: routePayload.routes?.length ?? 0,
  });
  return bitrixCrmDealUpdate(dealId, fields);
}

async function notifyBitrixDealProjectCreated(dealId, projectId) {
  const uf = getBitrixUfCodes();
  return bitrixCrmDealUpdate(dealId, dealFieldsAfterProjectCreated(uf, projectId));
}

async function notifyBitrixDealFiberOrder(dealId, order) {
  const uf = getBitrixUfCodes();
  const fields = dealFieldsAfterFiberOrder(uf, order.id, order.total_length_m, order.fiber_count);
  return bitrixCrmDealUpdate(dealId, fields);
}

module.exports = {
  notifyBitrixAccident,
  notifyBitrixDealRouteCheck,
  notifyBitrixDealProjectCreated,
  notifyBitrixDealFiberOrder,
  haversineMeters,
};
