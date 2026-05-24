/** DDL and incremental migrations for workspace SQLite files (no users table). */

const { geomBboxFromGeometry, parseGeometryField } = require("./geomBbox");

function migrateProjectsUpdatedAt(db) {
  const cols = db.prepare("PRAGMA table_info(projects)").all();
  if (!cols.some((c) => c.name === "updated_at")) {
    db.exec(`ALTER TABLE projects ADD COLUMN updated_at TEXT`);
    db.prepare(`UPDATE projects SET updated_at = datetime('now') WHERE updated_at IS NULL`).run();
  }
}

function migrateEdgeBboxColumns(db) {
  const edgeColumns = db.prepare("PRAGMA table_info(edges)").all();
  if (!edgeColumns.some((c) => c.name === "bbox_min_lat")) {
    db.exec(`
      ALTER TABLE edges ADD COLUMN bbox_min_lat REAL;
      ALTER TABLE edges ADD COLUMN bbox_max_lat REAL;
      ALTER TABLE edges ADD COLUMN bbox_min_lng REAL;
      ALTER TABLE edges ADD COLUMN bbox_max_lng REAL;
    `);
  }
  const rows = db.prepare("SELECT id, geometry FROM edges WHERE bbox_min_lat IS NULL").all();
  if (rows.length === 0) return;
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
}

function initWorkspaceSchema(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT,
      passport_data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const projectColumns = db.prepare("PRAGMA table_info(projects)").all();
  if (!projectColumns.some((column) => column.name === "passport_data")) {
    db.exec("ALTER TABLE projects ADD COLUMN passport_data TEXT NOT NULL DEFAULT '{}';");
  }

  const nodeColumns = db.prepare("PRAGMA table_info(nodes)").all();
  if (!nodeColumns.some((column) => column.name === "parent_tk_id")) {
    db.exec("ALTER TABLE nodes ADD COLUMN parent_tk_id INTEGER REFERENCES nodes(id) ON DELETE RESTRICT;");
  }

  const edgeColumns = db.prepare("PRAGMA table_info(edges)").all();
  if (!edgeColumns.some((column) => column.name === "cable_name")) db.exec("ALTER TABLE edges ADD COLUMN cable_name TEXT;");
  if (!edgeColumns.some((column) => column.name === "total_fibers")) db.exec("ALTER TABLE edges ADD COLUMN total_fibers INTEGER;");
  if (!edgeColumns.some((column) => column.name === "used_fibers")) db.exec("ALTER TABLE edges ADD COLUMN used_fibers INTEGER;");

  migrateEdgesNullableProjectId(db);

  const edgeColsAfterMigrate = db.prepare("PRAGMA table_info(edges)").all();
  if (!edgeColsAfterMigrate.some((column) => column.name === "cable_status")) {
    db.exec("ALTER TABLE edges ADD COLUMN cable_status TEXT;");
  }
  db.prepare("UPDATE edges SET cable_status = 'READY' WHERE type = 'OPTOVOLOKNO' AND (cable_status IS NULL OR cable_status = '')").run();

  migrateEdgeBboxColumns(db);
  migrateProjectsUpdatedAt(db);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
    CREATE INDEX IF NOT EXISTS idx_nodes_lat_lng ON nodes(lat, lng);
    CREATE INDEX IF NOT EXISTS idx_nodes_type_lat_lng ON nodes(type, lat, lng);
    CREATE INDEX IF NOT EXISTS idx_nodes_parent_tk ON nodes(parent_tk_id);
    CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);
    CREATE INDEX IF NOT EXISTS idx_edges_project ON edges(project_id);
    CREATE INDEX IF NOT EXISTS idx_edges_start ON edges(start_node_id);
    CREATE INDEX IF NOT EXISTS idx_edges_end ON edges(end_node_id);
    CREATE INDEX IF NOT EXISTS idx_edges_bbox ON edges(bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng);

    CREATE TABLE IF NOT EXISTS fiber_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      fiber_count INTEGER NOT NULL,
      start_mufta_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      end_mufta_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      edge_ids TEXT NOT NULL,
      total_length_m INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function migrateEdgesNullableProjectId(db) {
  const cols = db.prepare("PRAGMA table_info(edges)").all();
  const pcol = cols.find((c) => c.name === "project_id");
  if (pcol && pcol.notnull === 0) return;
  db.exec(`
    CREATE TABLE edges_migrated (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('KANALIZACIYA', 'OPTOVOLOKNO')),
      start_node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      end_node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      length_m REAL NOT NULL,
      geometry TEXT NOT NULL,
      cable_name TEXT,
      total_fibers INTEGER,
      used_fibers INTEGER,
      project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT,
      passport_data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO edges_migrated (
      id, type, start_node_id, end_node_id, length_m, geometry, cable_name, total_fibers, used_fibers, project_id, passport_data, created_at, updated_at
    )
    SELECT id, type, start_node_id, end_node_id, length_m, geometry, cable_name, total_fibers, used_fibers, project_id, passport_data, created_at, updated_at
    FROM edges;
    DROP TABLE edges;
    ALTER TABLE edges_migrated RENAME TO edges;
  `);
  db.prepare("UPDATE edges SET project_id = NULL WHERE type = 'KANALIZACIYA'").run();
}

const NETWORK_TABLES = ["projects", "nodes", "edges", "fiber_orders"];

function copyNetworkTables(fromDb, toDb) {
  const tx = toDb.transaction(() => {
    toDb.pragma("foreign_keys = OFF");
    for (const table of NETWORK_TABLES) {
      toDb.prepare(`DELETE FROM ${table}`).run();
    }
    for (const table of NETWORK_TABLES) {
      const rows = fromDb.prepare(`SELECT * FROM ${table}`).all();
      if (rows.length === 0) continue;
      const cols = Object.keys(rows[0]);
      const placeholders = cols.map(() => "?").join(", ");
      const insert = toDb.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`);
      for (const row of rows) {
        insert.run(...cols.map((c) => row[c]));
      }
    }
    toDb.pragma("foreign_keys = ON");
    for (const table of NETWORK_TABLES) {
      const { m } = toDb.prepare(`SELECT IFNULL(MAX(id), 0) AS m FROM ${table}`).get();
      toDb.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(table);
      if (m > 0) toDb.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run(table, m);
    }
  });
  tx();
}

module.exports = {
  initWorkspaceSchema,
  migrateEdgesNullableProjectId,
  NETWORK_TABLES,
  copyNetworkTables,
};
