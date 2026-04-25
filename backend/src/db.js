const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "..", "data", "gis.sqlite");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('TK', 'MUFTA', 'PIKET', 'KROSS')),
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    parent_tk_id INTEGER REFERENCES nodes(id) ON DELETE RESTRICT,
    passport_data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('KANALIZACIYA', 'OPTOVOLOKNO')),
    start_node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
    end_node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
    length_m REAL NOT NULL,
    geometry TEXT NOT NULL,
    cable_name TEXT,
    total_fibers INTEGER,
    used_fibers INTEGER,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    passport_data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const nodeColumns = db.prepare("PRAGMA table_info(nodes)").all();
if (!nodeColumns.some((column) => column.name === "parent_tk_id")) {
  db.exec("ALTER TABLE nodes ADD COLUMN parent_tk_id INTEGER REFERENCES nodes(id) ON DELETE RESTRICT;");
}
const edgeColumns = db.prepare("PRAGMA table_info(edges)").all();
if (!edgeColumns.some((column) => column.name === "cable_name")) db.exec("ALTER TABLE edges ADD COLUMN cable_name TEXT;");
if (!edgeColumns.some((column) => column.name === "total_fibers")) db.exec("ALTER TABLE edges ADD COLUMN total_fibers INTEGER;");
if (!edgeColumns.some((column) => column.name === "used_fibers")) db.exec("ALTER TABLE edges ADD COLUMN used_fibers INTEGER;");

function parseRow(row) {
  if (!row) return row;
  const parsed = {
    ...row,
    passport_data: JSON.parse(row.passport_data || "{}"),
  };
  if ("geometry" in row) {
    parsed.geometry = row.geometry ? JSON.parse(row.geometry) : null;
  }
  return parsed;
}

function seedIfEmpty() {
  const projectCount = db.prepare("SELECT COUNT(*) AS count FROM projects").get().count;
  const nodeCount = db.prepare("SELECT COUNT(*) AS count FROM nodes").get().count;
  if (projectCount > 0 || nodeCount > 0) return;

  const tx = db.transaction(() => {
    const project = db
      .prepare("INSERT INTO projects (name, description) VALUES (?, ?)")
      .run("Демо проект ЛКС", "Автосид для быстрого старта");
    const projectId = Number(project.lastInsertRowid);

    const tk = db
      .prepare("INSERT INTO nodes (type, name, lat, lng, parent_tk_id, passport_data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("TK", "ТК-001", 55.751244, 37.618423, null, JSON.stringify({ status: "existing" }));
    const tk2 = db
      .prepare("INSERT INTO nodes (type, name, lat, lng, parent_tk_id, passport_data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("TK", "ТК-002", 55.756244, 37.628423, null, JSON.stringify({ status: "existing" }));
    const mufta = db
      .prepare("INSERT INTO nodes (type, name, lat, lng, parent_tk_id, passport_data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("MUFTA", "Муфта-001", 55.751244, 37.618423, Number(tk.lastInsertRowid), JSON.stringify({ reserve_cores: 8 }));
    const mufta2 = db
      .prepare("INSERT INTO nodes (type, name, lat, lng, parent_tk_id, passport_data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("MUFTA", "Муфта-002", 55.756244, 37.628423, Number(tk2.lastInsertRowid), JSON.stringify({ reserve_cores: 16 }));

    db.prepare(
      `INSERT INTO edges (type, start_node_id, end_node_id, length_m, geometry, cable_name, total_fibers, used_fibers, project_id, passport_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "OPTOVOLOKNO",
      Number(mufta.lastInsertRowid),
      Number(mufta2.lastInsertRowid),
      920,
      JSON.stringify([
        [55.751244, 37.618423],
        [55.7535, 37.6224],
        [55.756244, 37.628423],
      ]),
      "ОК-001",
      24,
      8,
      projectId,
      JSON.stringify({ fibers_used: 12 })
    );
  });

  tx();
}

module.exports = { db, parseRow, seedIfEmpty };
