/**
 * Поиск оптических маршрутов между двумя узлами (MUFTA/KROSS).
 * Вынесено из server.js для переиспользования в /routes и Bitrix-интеграции.
 */

function isOpticalEndpointNodeType(t) {
  const u = String(t ?? "")
    .trim()
    .toUpperCase()
    .replace(/\u00A0/g, "");
  if (u === "MUFTA" || u === "KROSS") return true;
  if (u === "CROSS" || u === "CX") return true;
  return false;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {(row: object) => object} parseRow
 * @param {number} startId
 * @param {number} endId
 * @param {number} requiredFreeFibers
 */
function findOpticalRoutes(db, parseRow, startId, endId, requiredFreeFibers) {
  const startNode = db.prepare("SELECT id, type FROM nodes WHERE id = ?").get(startId);
  const endNode = db.prepare("SELECT id, type FROM nodes WHERE id = ?").get(endId);
  if (!startNode || !endNode || !isOpticalEndpointNodeType(startNode.type) || !isOpticalEndpointNodeType(endNode.type)) {
    return { ok: false, message: "Route points must be MUFTA or KROSS nodes" };
  }

  const opticalEdges = db
    .prepare(
      `SELECT e.*, sn.name AS start_node_name, en.name AS end_node_name
       FROM edges e
       JOIN nodes sn ON sn.id = e.start_node_id
       JOIN nodes en ON en.id = e.end_node_id
       WHERE e.type = 'OPTOVOLOKNO'
         AND COALESCE(e.total_fibers, 0) - COALESCE(e.used_fibers, 0) >= ?`,
    )
    .all(requiredFreeFibers)
    .map(parseRow);

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
        totalLength + candidate.edge.length_m,
      );
    }
  };

  dfs(startId, [startId], [], 0);
  routes.sort((a, b) => a.total_length_m - b.total_length_m);
  return { ok: true, routes };
}

module.exports = { findOpticalRoutes, isOpticalEndpointNodeType };
