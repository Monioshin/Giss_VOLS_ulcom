function ensureActivityTable(systemDb) {
  systemDb.exec(`
    CREATE TABLE IF NOT EXISTS activity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL DEFAULT (datetime('now')),
      user_id INTEGER,
      username TEXT,
      workspace_slug TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id INTEGER
    );
  `);
}

function logActivityEvent(systemDb, { userId, username, workspaceSlug, action, entity, entityId }) {
  ensureActivityTable(systemDb);
  systemDb
    .prepare(
      `INSERT INTO activity_events (user_id, username, workspace_slug, action, entity, entity_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(userId ?? null, username ?? null, workspaceSlug ?? null, action, entity ?? null, entityId ?? null);
}

function listActivityEvents(systemDb, limit = 100) {
  ensureActivityTable(systemDb);
  return systemDb
    .prepare(
      `SELECT id, at, user_id, username, workspace_slug, action, entity, entity_id
       FROM activity_events ORDER BY id DESC LIMIT ?`,
    )
    .all(Math.min(500, Math.max(1, limit)));
}

module.exports = { ensureActivityTable, logActivityEvent, listActivityEvents };
