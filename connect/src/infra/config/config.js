const os = require("os");
const path = require("path");

const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_ENV_VALUES = new Set(["0", "false", "no", "off"]);
const ALLOWED_PERMISSION_MODES = new Set([
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "default",
  "dontAsk",
  "plan",
]);

function readConfig() {
  const mode = process.argv[2] || "";
  const defaultStateDir = path.join(os.homedir(), ".mya-wechat");
  const stateDir = process.env.MYA_WECHAT_STATE_DIR || defaultStateDir;

  return {
    mode,
    stateDir,
    baseUrl: process.env.MYA_WECHAT_BASE_URL || "https://ilinkai.weixin.qq.com",
    cdnBaseUrl: process.env.MYA_WECHAT_CDN_BASE_URL || "https://novac2c.cdn.weixin.qq.com/c2c",
    accountId: process.env.MYA_WECHAT_ACCOUNT_ID || "",
    allowedUserIds: readListEnv("MYA_WECHAT_ALLOWED_USER_IDS"),
    workspaceAllowlist: readListEnv("MYA_WECHAT_WORKSPACE_ALLOWLIST"),
    defaultWorkspaceRoot: readTextEnv("MYA_WECHAT_DEFAULT_WORKSPACE"),
    defaultWorkspaceId: process.env.MYA_WECHAT_DEFAULT_WORKSPACE_ID || "default",
    defaultModel: readTextEnv("MYA_WECHAT_DEFAULT_MODEL") || "sonnet",
    defaultEffort: readTextEnv("MYA_WECHAT_DEFAULT_EFFORT"),
    permissionMode: readPermissionModeEnv("MYA_WECHAT_PERMISSION_MODE", "dontAsk"),
    enableAutoMode: readBooleanEnv("MYA_WECHAT_ENABLE_AUTO_MODE", false),
    preserveExistingAccounts: readBooleanEnv("MYA_WECHAT_PRESERVE_EXISTING_ACCOUNTS", true),
    autoSelectLatestAccount: readBooleanEnv("MYA_WECHAT_AUTO_SELECT_LATEST_ACCOUNT", true),
    myaCommand: process.env.MYA_WECHAT_MYA_COMMAND || "mya",
    enableTyping: readBooleanEnv("MYA_WECHAT_ENABLE_TYPING", true),
    sessionsFile: process.env.MYA_WECHAT_SESSIONS_FILE
      || path.join(stateDir, "sessions.json"),
    syncBufferDir: process.env.MYA_WECHAT_SYNC_BUFFER_DIR
      || path.join(stateDir, "sync-buf"),
    accountsDir: path.join(stateDir, "accounts"),
    qrBotType: readTextEnv("MYA_WECHAT_QR_BOT_TYPE") || "3",
  };
}

function readListEnv(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readBooleanEnv(name, defaultValue) {
  const rawValue = process.env[name];
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return defaultValue;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (TRUE_ENV_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_ENV_VALUES.has(normalized)) {
    return false;
  }
  return defaultValue;
}

function readTextEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function readPermissionModeEnv(name, fallback) {
  const value = readTextEnv(name);
  if (ALLOWED_PERMISSION_MODES.has(value)) {
    return value;
  }
  return fallback;
}

module.exports = { readConfig };
