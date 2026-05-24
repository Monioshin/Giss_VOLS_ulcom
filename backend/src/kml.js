const { db, parseRow } = require("./db");

function escapeXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function coordsFromGeometry(geometry) {
  if (!Array.isArray(geometry) || geometry.length < 2) return "";
  return geometry
    .map((pt) => {
      const lat = Number(pt[0]);
      const lng = Number(pt[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return `${lng},${lat},0`;
    })
    .filter(Boolean)
    .join(" ");
}

function edgePlacemark(edge, projectName) {
  const coords = coordsFromGeometry(edge.geometry);
  if (!coords) return "";
  const isOpt = edge.type === "OPTOVOLOKNO";
  const name = isOpt
    ? edge.cable_name || `ВОЛС #${edge.id}`
    : `Канализация #${edge.id}`;
  const desc = [
    `Тип: ${edge.type}`,
    projectName ? `Проект: ${projectName}` : null,
    `Длина: ${Math.round(edge.length_m)} м`,
    isOpt && edge.total_fibers != null ? `Волокон: ${edge.used_fibers ?? 0}/${edge.total_fibers}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const style = isOpt ? "#vols" : "#kanal";
  return `    <Placemark>
      <name>${escapeXml(name)}</name>
      <description>${escapeXml(desc)}</description>
      <styleUrl>${style}</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>`;
}

function nodePlacemark(node) {
  const lat = Number(node.lat);
  const lng = Number(node.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return `    <Placemark>
      <name>${escapeXml(`${node.type} · ${node.name}`)}</name>
      <description>${escapeXml(`Узел id ${node.id}`)}</description>
      <styleUrl>#node</styleUrl>
      <Point>
        <coordinates>${lng},${lat},0</coordinates>
      </Point>
    </Placemark>`;
}

/**
 * @param {{ projectId?: number | null, includeNodes?: boolean }} opts
 */
function buildKml(opts = {}) {
  const { projectId = null, includeNodes = true, volsOnly = false } = opts;
  const projects = db.prepare("SELECT id, name FROM projects").all();
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  const pid = projectId != null && Number.isFinite(Number(projectId)) ? Number(projectId) : null;
  const edges =
    pid != null
      ? db
          .prepare(
            `SELECT e.id, e.type, e.length_m, e.geometry, e.cable_name, e.total_fibers, e.used_fibers, e.project_id
             FROM edges e WHERE e.project_id = ? OR e.type = 'KANALIZACIYA' ORDER BY e.id`
          )
          .all(pid)
          .map(parseRow)
      : db
          .prepare(
            `SELECT e.id, e.type, e.length_m, e.geometry, e.cable_name, e.total_fibers, e.used_fibers, e.project_id
             FROM edges e ORDER BY e.id`
          )
          .all()
          .map(parseRow);
  const filteredEdges = volsOnly ? edges.filter((e) => e.type === "OPTOVOLOKNO") : edges;

  const placemarks = filteredEdges
    .map((e) => edgePlacemark(e, e.project_id ? projectMap[e.project_id] : null))
    .filter(Boolean)
    .join("\n");

  let nodeBlock = "";
  if (includeNodes) {
    const nodes = db.prepare("SELECT id, type, name, lat, lng FROM nodes ORDER BY id").all();
    nodeBlock = nodes.map(nodePlacemark).filter(Boolean).join("\n");
  }

  const docName =
    projectId != null && projectMap[projectId]
      ? `GIS — ${projectMap[projectId]}`
      : "GIS — все трассы";

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(docName)}</name>
    <description>Экспорт трасс и узлов GIS</description>
    <Style id="vols">
      <LineStyle><color>ff0000ff</color><width>3</width></LineStyle>
    </Style>
    <Style id="kanal">
      <LineStyle><color>ff808080</color><width>2</width></LineStyle>
    </Style>
    <Style id="node">
      <IconStyle><scale>0.7</scale></IconStyle>
    </Style>
    <Folder>
      <name>Участки</name>
${placemarks}
    </Folder>
    ${
      includeNodes
        ? `<Folder>
      <name>Узлы</name>
${nodeBlock}
    </Folder>`
        : ""
    }
  </Document>
</kml>`;
}

module.exports = { buildKml };
