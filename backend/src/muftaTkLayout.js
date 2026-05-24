/** Орбитальная раскладка нескольких муфт вокруг одного ТК (метры). */

const TK_BODY_RADIUS_M = 0.35;
const MUFTA_BODY_RADIUS_M = 0.28;
const LAYOUT_START_ANGLE = -Math.PI / 2;
const NEAR_TK_CENTER_EPS_M = 0.05;

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

function offsetLatLng(lat, lng, bearingRad, distanceM) {
  const R = 6371000;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distanceM / R) +
      Math.cos(lat1) * Math.sin(distanceM / R) * Math.cos(bearingRad),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(distanceM / R) * Math.cos(lat1),
      Math.cos(distanceM / R) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [(lat2 * 180) / Math.PI, (lng2 * 180) / Math.PI];
}

/**
 * Радиус орбиты от центра ТК (м). Для 2+ муфт используем почти весь лимит привязки,
 * иначе на карте маркеры накладываются (0.6 м ≈ 1–2 px на zoom 18).
 */
function orbitRadiusMeters(count, maxAttachMeters) {
  const base = TK_BODY_RADIUS_M + MUFTA_BODY_RADIUS_M;
  if (count <= 1) return Math.min(maxAttachMeters, base);
  const minForSpacing = MUFTA_BODY_RADIUS_M / Math.sin(Math.PI / count);
  const geometric = Math.max(base, minForSpacing);
  const minChord = 2 * MUFTA_BODY_RADIUS_M + 0.35;
  let r = Math.min(maxAttachMeters, Math.max(geometric, maxAttachMeters * 0.92));
  const chord = 2 * r * Math.sin(Math.PI / count);
  if (chord < minChord) {
    const rNeeded = minChord / (2 * Math.sin(Math.PI / count));
    r = Math.min(maxAttachMeters, Math.max(r, rNeeded));
  }
  return r;
}

function maxMuftasPerTk(maxAttachMeters) {
  for (let n = 1; n <= 500; n += 1) {
    if (orbitRadiusMeters(n, maxAttachMeters) > maxAttachMeters) return n - 1;
  }
  return 500;
}

/**
 * @param {number} tkLat
 * @param {number} tkLng
 * @param {number} count
 * @param {number} maxAttachMeters
 * @returns {[number, number][] | null} null если радиус орбиты превышает лимит
 */
function computeMuftaPositionsOnTk(tkLat, tkLng, count, maxAttachMeters) {
  if (count <= 0) return [];
  if (count === 1) return [[tkLat, tkLng]];
  const R = orbitRadiusMeters(count, maxAttachMeters);
  if (R > maxAttachMeters + 1e-6) return null;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const angle = LAYOUT_START_ANGLE + (2 * Math.PI * i) / count;
    out.push(offsetLatLng(tkLat, tkLng, angle, R));
  }
  return out;
}

function isNearTkCenter(lat, lng, tk, epsM = NEAR_TK_CENTER_EPS_M) {
  if (!tk) return false;
  return haversineMeters([lat, lng], [tk.lat, tk.lng]) <= epsM;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} tkId
 * @param {number} maxAttachMeters
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function rebalanceMuftasOnTk(db, tkId, maxAttachMeters) {
  const tk = db.prepare("SELECT id, lat, lng FROM nodes WHERE id = ? AND type = 'TK'").get(tkId);
  if (!tk) return { ok: true };
  const muftas = db
    .prepare("SELECT id FROM nodes WHERE type = 'MUFTA' AND parent_tk_id = ? ORDER BY id ASC")
    .all(tkId);
  if (!muftas.length) return { ok: true };
  const positions = computeMuftaPositionsOnTk(tk.lat, tk.lng, muftas.length, maxAttachMeters);
  if (!positions) {
    const maxN = maxMuftasPerTk(maxAttachMeters);
    return {
      ok: false,
      message: `Слишком много муфт на ТК #${tkId} (макс. ${maxN} при радиусе привязки ${maxAttachMeters} м)`,
    };
  }
  const upd = db.prepare("UPDATE nodes SET lat = ?, lng = ?, updated_at = datetime('now') WHERE id = ?");
  for (let i = 0; i < muftas.length; i += 1) {
    upd.run(positions[i][0], positions[i][1], muftas[i].id);
  }
  return { ok: true };
}

/**
 * После импорта: переразнести муфты на ТК, если хотя бы одна импортированная муфта у центра ТК.
 * @param {import('better-sqlite3').Database} db
 * @param {Array<{ type: string, lat: number, lng: number, parent_tk_id?: number | null }>} importedNodes
 */
function rebalanceMuftasAfterImport(db, importedNodes, maxAttachMeters) {
  const tkIds = new Set();
  for (const n of importedNodes) {
    if (n.type !== "MUFTA" || n.parent_tk_id == null) continue;
    const tk = db.prepare("SELECT lat, lng FROM nodes WHERE id = ?").get(n.parent_tk_id);
    if (tk && isNearTkCenter(n.lat, n.lng, tk)) tkIds.add(n.parent_tk_id);
  }
  for (const tkId of tkIds) {
    const r = rebalanceMuftasOnTk(db, tkId, maxAttachMeters);
    if (!r.ok) throw new Error(r.message);
  }
}

function muftaAttachDistanceError(maxAttachMeters) {
  return `Муфта должна быть в пределах ${maxAttachMeters} м от ТК`;
}

/** При старте: одна муфта — в центр ТК; несколько — по кругу. */
function rebalanceAllMuftaTk(db, maxAttachMeters) {
  const rows = db
    .prepare(
      `SELECT DISTINCT parent_tk_id AS tk_id
       FROM nodes WHERE type = 'MUFTA' AND parent_tk_id IS NOT NULL`,
    )
    .all();
  for (const row of rows) {
    const r = rebalanceMuftasOnTk(db, row.tk_id, maxAttachMeters);
    if (!r.ok) console.warn("mufta rebalance:", r.message);
  }
}

module.exports = {
  TK_BODY_RADIUS_M,
  MUFTA_BODY_RADIUS_M,
  NEAR_TK_CENTER_EPS_M,
  haversineMeters,
  computeMuftaPositionsOnTk,
  isNearTkCenter,
  rebalanceMuftasOnTk,
  rebalanceMuftasAfterImport,
  rebalanceAllMuftaTk,
  maxMuftasPerTk,
  muftaAttachDistanceError,
};
