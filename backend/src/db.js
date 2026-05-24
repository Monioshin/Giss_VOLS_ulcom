const bcrypt = require("bcryptjs");
const {
  initDatabases,
  getSystemDb,
  getWorkspaceDb,
  createDbProxy,
} = require("./workspaces");

initDatabases();

const db = createDbProxy(getWorkspaceDb);
const systemDb = createDbProxy(getSystemDb);

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
  const ws = getWorkspaceDb();
  const projectCount = ws.prepare("SELECT COUNT(*) AS count FROM projects").get().count;
  const nodeCount = ws.prepare("SELECT COUNT(*) AS count FROM nodes").get().count;
  if (projectCount > 0 || nodeCount > 0) return;

  const tx = ws.transaction(() => {
    const project = ws
      .prepare("INSERT INTO projects (name, description) VALUES (?, ?)")
      .run("Демо проект ЛКС", "Автосид для быстрого старта");
    const projectId = Number(project.lastInsertRowid);

    const tk = ws
      .prepare("INSERT INTO nodes (type, name, lat, lng, parent_tk_id, passport_data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("TK", "ТК-001", 55.751244, 37.618423, null, JSON.stringify({ status: "existing" }));
    const tk2 = ws
      .prepare("INSERT INTO nodes (type, name, lat, lng, parent_tk_id, passport_data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("TK", "ТК-002", 55.756244, 37.628423, null, JSON.stringify({ status: "existing" }));
    const mufta = ws
      .prepare("INSERT INTO nodes (type, name, lat, lng, parent_tk_id, passport_data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("MUFTA", "Муфта-001", 55.751244, 37.618423, Number(tk.lastInsertRowid), JSON.stringify({ reserve_cores: 8 }));
    const mufta2 = ws
      .prepare("INSERT INTO nodes (type, name, lat, lng, parent_tk_id, passport_data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("MUFTA", "Муфта-002", 55.756244, 37.628423, Number(tk2.lastInsertRowid), JSON.stringify({ reserve_cores: 16 }));

    ws.prepare(
      `INSERT INTO edges (type, start_node_id, end_node_id, length_m, geometry, cable_name, total_fibers, used_fibers, project_id, passport_data, cable_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      JSON.stringify({ fibers_used: 12 }),
      "READY"
    );
  });

  tx();
}

function seedAdminIfMissing() {
  const sys = getSystemDb();
  const count = sys.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (count > 0) return;
  const hash = bcrypt.hashSync("Админ", 10);
  sys.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'ADMIN')").run("Админ", hash);
}

seedAdminIfMissing();

module.exports = {
  db,
  systemDb,
  getWorkspaceDb,
  getSystemDb,
  parseRow,
  seedIfEmpty,
};
