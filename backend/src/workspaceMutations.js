const { readAppConfig } = require("./appConfig");
const { bumpDataRevision } = require("./syncRevision");
const { logActivityEvent } = require("./activityLog");
const { getWorkspaceContext } = require("./requestContext");
const { getSystemDb } = require("./workspaces");

function checkExpectedUpdatedAt(existing, expected) {
  if (expected == null || expected === "") return null;
  const cur = existing.updated_at ?? "";
  if (String(expected) !== String(cur)) {
    return {
      status: 409,
      body: {
        message: "Объект изменён другим пользователем",
        current_updated_at: cur,
      },
    };
  }
  return null;
}

function afterWorkspaceMutation(req, entity, entityId, op) {
  const ctx = getWorkspaceContext();
  const db = ctx?.db ?? req.workspaceDb;
  const slug = ctx?.slug ?? req.workspaceSlug;
  if (db) bumpDataRevision(db, entity, entityId, op);
  if (req.authUser && slug) {
    try {
      logActivityEvent(getSystemDb(), {
        userId: req.authUser.id,
        username: req.authUser.username,
        workspaceSlug: slug,
        action: op,
        entity,
        entityId,
      });
    } catch {
      /* ignore */
    }
  }
}

function requireDataWrite(req, res, next) {
  const cfg = readAppConfig();
  if (cfg.userDataReadOnly) {
    return res.status(403).json({ message: "Режим только чтение данных включён администратором" });
  }
  const { requireEditor } = require("./roles");
  return requireEditor(req, res, next);
}

module.exports = {
  checkExpectedUpdatedAt,
  afterWorkspaceMutation,
  requireDataWrite,
};
