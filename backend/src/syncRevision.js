/** Версия данных workspace для опроса клиентами (совместная работа). */

function ensureSyncTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS change_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      op TEXT NOT NULL,
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const row = db.prepare("SELECT value FROM workspace_meta WHERE key = 'data_revision'").get();
  if (!row) {
    db.prepare("INSERT INTO workspace_meta (key, value) VALUES ('data_revision', '0')").run();
  }
}

function getDataRevision(db) {
  ensureSyncTables(db);
  const row = db.prepare("SELECT value FROM workspace_meta WHERE key = 'data_revision'").get();
  return Number(row?.value ?? 0) || 0;
}

function bumpDataRevision(db, entity, entityId, op) {
  ensureSyncTables(db);
  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO change_log (entity, entity_id, op) VALUES (?, ?, ?)",
    ).run(entity, entityId ?? null, op);
    const cur = getDataRevision(db);
    const next = cur + 1;
    db.prepare("UPDATE workspace_meta SET value = ? WHERE key = 'data_revision'").run(String(next));
  });
  tx();
  return getDataRevision(db);
}

function getChangesSince(db, sinceRevision, limit = 500) {
  ensureSyncTables(db);
  const since = Number(sinceRevision) || 0;
  if (since <= 0) {
    return db
      .prepare(
        `SELECT id, entity, entity_id, op, at FROM change_log ORDER BY id DESC LIMIT ?`,
      )
      .all(limit)
      .reverse();
  }
  return db
    .prepare(
      `SELECT id, entity, entity_id, op, at FROM change_log WHERE id > (
         SELECT COALESCE(MAX(id), 0) FROM change_log WHERE id <= (
           SELECT COALESCE((SELECT id FROM change_log ORDER BY id ASC LIMIT 1 OFFSET ?), 0)
         )
       ) OR id > (SELECT COALESCE(MAX(c.id), 0) FROM (
         SELECT id FROM change_log ORDER BY id ASC
       ) c LIMIT 1 OFFSET (SELECT COUNT(*) FROM change_log) - ?)
       ORDER BY id ASC LIMIT ?`,
    )
    .all(0, 0, limit);
}

/** Упрощённо: все записи с id больше порога по revision. */
function getChangesSinceSimple(db, sinceRevision, limit = 500) {
  ensureSyncTables(db);
  const rev = Number(sinceRevision) || 0;
  const all = db.prepare("SELECT id, entity, entity_id, op, at FROM change_log ORDER BY id ASC").all();
  const threshold = Math.max(0, all.length - rev);
  return all.slice(threshold).slice(-limit);
}

module.exports = {
  ensureSyncTables,
  getDataRevision,
  bumpDataRevision,
  getChangesSince: getChangesSinceSimple,
};
