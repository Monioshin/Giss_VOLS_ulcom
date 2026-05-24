/** Bounding box from edge geometry [[lat,lng],...]. */
function geomBboxFromGeometry(geometry) {
  if (!Array.isArray(geometry) || geometry.length === 0) {
    return { bbox_min_lat: null, bbox_max_lat: null, bbox_min_lng: null, bbox_max_lng: null }
  }
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const pt of geometry) {
    if (!Array.isArray(pt) || pt.length < 2) continue
    const lat = Number(pt[0])
    const lng = Number(pt[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
  }
  if (!Number.isFinite(minLat)) {
    return { bbox_min_lat: null, bbox_max_lat: null, bbox_min_lng: null, bbox_max_lng: null }
  }
  const pad = 0.0002
  return {
    bbox_min_lat: minLat - pad,
    bbox_max_lat: maxLat + pad,
    bbox_min_lng: minLng - pad,
    bbox_max_lng: maxLng + pad,
  }
}

function backfillEdgeBboxes(db) {
  const rows = db.prepare("SELECT id, geometry FROM edges WHERE bbox_min_lat IS NULL").all();
  if (rows.length === 0) return { updated: 0 };
  const upd = db.prepare(
    `UPDATE edges SET bbox_min_lat = ?, bbox_max_lat = ?, bbox_min_lng = ?, bbox_max_lng = ? WHERE id = ?`,
  );
  const tx = db.transaction(() => {
    for (const row of rows) {
      const bbox = geomBboxFromGeometry(parseGeometryField(row.geometry));
      upd.run(bbox.bbox_min_lat, bbox.bbox_max_lat, bbox.bbox_min_lng, bbox.bbox_max_lng, row.id);
    }
  });
  tx();
  return { updated: rows.length };
}

function parseGeometryField(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function syncEdgeGeomBbox(db, edgeId, geometry) {
  const bbox = geomBboxFromGeometry(parseGeometryField(geometry))
  db.prepare(
    `UPDATE edges SET bbox_min_lat = ?, bbox_max_lat = ?, bbox_min_lng = ?, bbox_max_lng = ? WHERE id = ?`,
  ).run(bbox.bbox_min_lat, bbox.bbox_max_lat, bbox.bbox_min_lng, bbox.bbox_max_lng, edgeId)
}

module.exports = { geomBboxFromGeometry, parseGeometryField, syncEdgeGeomBbox, backfillEdgeBboxes }
