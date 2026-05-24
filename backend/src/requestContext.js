const { AsyncLocalStorage } = require("async_hooks");

const workspaceStorage = new AsyncLocalStorage();

function runWithWorkspaceContext(ctx, fn) {
  return workspaceStorage.run(ctx, fn);
}

function getWorkspaceContext() {
  return workspaceStorage.getStore() ?? null;
}

module.exports = { workspaceStorage, runWithWorkspaceContext, getWorkspaceContext };
