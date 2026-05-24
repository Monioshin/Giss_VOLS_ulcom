/** GeoJSON FeatureCollection для узлов (ТК и др.) */

function nodeToFeature(n) {
  const passport =
    typeof n.passport_data === "string" ? JSON.parse(n.passport_data || "{}") : n.passport_data ?? {};
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [n.lng, n.lat] },
    properties: {
      id: n.id,
      type: n.type,
      name: n.name,
      parent_tk_id: n.parent_tk_id ?? null,
      ...passport,
    },
  };
}

function exportNodesGeoJson(rows, typesFilter) {
  let list = rows;
  if (typesFilter?.length) {
    const set = new Set(typesFilter);
    list = list.filter((n) => set.has(n.type));
  }
  return {
    type: "FeatureCollection",
    features: list.map(nodeToFeature),
  };
}

function normalizeNodeTypeImport(raw) {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  const map = {
    tk: "TK",
    тк: "TK",
    колодец: "TK",
    mufta: "MUFTA",
    муфта: "MUFTA",
    piket: "PIKET",
    пикет: "PIKET",
    kross: "KROSS",
    кросс: "KROSS",
  };
  const upper = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (["TK", "MUFTA", "PIKET", "KROSS"].includes(upper)) return upper;
  return map[key] ?? null;
}

function parseGeoJsonImport(body, defaultType = "TK") {
  const errors = [];
  const nodes = [];
  const fc = body?.type === "FeatureCollection" ? body : body?.type === "Feature" ? { features: [body] } : null;
  if (!fc?.features?.length) {
    errors.push("Ожидается GeoJSON FeatureCollection или Feature");
    return { nodes, errors };
  }
  let row = 0;
  for (const f of fc.features) {
    row += 1;
    const ctx = `feature ${row}`;
    if (!f?.geometry || f.geometry.type !== "Point" || !Array.isArray(f.geometry.coordinates)) {
      errors.push(`${ctx}: нужна Point geometry`);
      continue;
    }
    const [lng, lat] = f.geometry.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      errors.push(`${ctx}: неверные координаты`);
      continue;
    }
    const p = f.properties ?? {};
    const type = normalizeNodeTypeImport(p.type) ?? defaultType;
    if (!type) {
      errors.push(`${ctx}: неверный type`);
      continue;
    }
    const name = String(p.name ?? p.Name ?? "").trim() || `${type === "TK" ? "ТК" : type}-${row}`;
    const item = {
      type,
      name,
      lat,
      lng,
      passport_data: { ...p },
    };
    delete item.passport_data.id;
    delete item.passport_data.type;
    delete item.passport_data.name;
    delete item.passport_data.parent_tk_id;
    const id = Number(p.id);
    if (Number.isInteger(id) && id > 0) item.id = id;
    const parent = Number(p.parent_tk_id);
    if (Number.isInteger(parent) && parent > 0) item.parent_tk_id = parent;
    nodes.push(item);
  }
  return { nodes, errors };
}

module.exports = { exportNodesGeoJson, parseGeoJsonImport, nodeToFeature };
