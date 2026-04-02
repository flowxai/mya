const fs = require("fs");
const os = require("os");
const path = require("path");

const PERMISSION_MODE_ALIASES = {
  "accept-edits": "acceptEdits",
  "auto-mode": "auto",
  automode: "auto",
  "dangerously-skip-permissions": "bypassPermissions",
  dangerous_skip_permissions: "bypassPermissions",
  "skip-permissions": "bypassPermissions",
};

const ALLOWED_PERMISSION_MODES = new Set([
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "default",
  "dontAsk",
  "plan",
]);

function getRuntimeConfigHomeDir() {
  return process.env.MYA_CONFIG_DIR
    || process.env.MY_AGENT_CONFIG_DIR
    || process.env.CLAUDE_CONFIG_DIR
    || path.join(os.homedir(), ".mya");
}

function getUserSettingsPath() {
  return path.join(getRuntimeConfigHomeDir(), "settings.json");
}

function readUserSettings() {
  const settingsPath = getUserSettingsPath();
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    return {};
  }
}

function normalizePermissionMode(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return "";
  }

  const alias = PERMISSION_MODE_ALIASES[normalized.toLowerCase()];
  const resolved = alias || normalized;
  return ALLOWED_PERMISSION_MODES.has(resolved) ? resolved : "";
}

function resolveConnectPermissionMode({
  explicitValues = [],
  envValues = [],
  settings = readUserSettings(),
  fallback = "dontAsk",
} = {}) {
  for (const value of explicitValues) {
    const normalized = normalizePermissionMode(value);
    if (normalized) {
      return normalized;
    }
  }

  for (const value of envValues) {
    const normalized = normalizePermissionMode(value);
    if (normalized) {
      return normalized;
    }
  }

  const configured =
    normalizePermissionMode(settings?.env?.MYA_DEFAULT_PERMISSION_MODE) ||
    normalizePermissionMode(settings?.permissions?.defaultMode);

  return configured || normalizePermissionMode(fallback) || "dontAsk";
}

module.exports = {
  ALLOWED_PERMISSION_MODES,
  getRuntimeConfigHomeDir,
  getUserSettingsPath,
  normalizePermissionMode,
  readUserSettings,
  resolveConnectPermissionMode,
};
