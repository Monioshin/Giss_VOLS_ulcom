const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "..", "data", "app-config.json");

const DEFAULT_CONFIG = {
  userDataReadOnly: false,
};

function readAppConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return { ...DEFAULT_CONFIG, ...raw, userDataReadOnly: Boolean(raw.userDataReadOnly) };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_CONFIG };
}

function writeAppConfig(config) {
  const next = { userDataReadOnly: Boolean(config.userDataReadOnly) };
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

module.exports = { readAppConfig, writeAppConfig };
