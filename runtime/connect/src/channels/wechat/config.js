const os = require("os");
const path = require("path");
const {
  resolveConnectDefaultModel,
  resolveConnectPermissionMode,
  readUserSettings,
} = require("../../shared/settings");
const {
  getConnectChannelRoot,
} = require("../../shared/runtime-paths");

const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_ENV_VALUES = new Set(["0", "false", "no", "off"]);
function readWechatConfig(mode) {
  const defaultStateDir = getConnectChannelRoot("wechat");
  const defaultLegacyStateDir = path.join(os.homedir(), ".mya-wechat");
  const stateDir = readTextEnv(["MYA_CONNECT_WECHAT_STATE_DIR", "MYA_WECHAT_STATE_DIR"])
    || defaultStateDir;
  const userSettings = readUserSettings();

  return {
    mode,
    stateDir,
    legacyStateDir: readTextEnv(["MYA_WECHAT_STATE_DIR"]) || defaultLegacyStateDir,
    baseUrl: readTextEnv(["MYA_CONNECT_WECHAT_BASE_URL", "MYA_WECHAT_BASE_URL"]) || "https://ilinkai.weixin.qq.com",
    cdnBaseUrl: readTextEnv(["MYA_CONNECT_WECHAT_CDN_BASE_URL", "MYA_WECHAT_CDN_BASE_URL"])
      || "https://novac2c.cdn.weixin.qq.com/c2c",
    accountId: readTextEnv(["MYA_CONNECT_WECHAT_ACCOUNT_ID", "MYA_WECHAT_ACCOUNT_ID"]),
    allowedUserIds: readListEnv(["MYA_CONNECT_WECHAT_ALLOWED_USER_IDS", "MYA_WECHAT_ALLOWED_USER_IDS"]),
    workspaceAllowlist: readListEnv(["MYA_CONNECT_WECHAT_WORKSPACE_ALLOWLIST", "MYA_WECHAT_WORKSPACE_ALLOWLIST"]),
    defaultWorkspaceRoot: readTextEnv(["MYA_CONNECT_WECHAT_DEFAULT_WORKSPACE", "MYA_WECHAT_DEFAULT_WORKSPACE"]),
    defaultWorkspaceId: readTextEnv(["MYA_CONNECT_WECHAT_DEFAULT_WORKSPACE_ID", "MYA_WECHAT_DEFAULT_WORKSPACE_ID"]) || "default",
    defaultModel: resolveConnectDefaultModel({
      explicitValues: [
        readTextEnv(["MYA_CONNECT_WECHAT_DEFAULT_MODEL", "MYA_WECHAT_DEFAULT_MODEL"]),
      ],
      settings: userSettings,
    }),
    defaultEffort: readTextEnv(["MYA_CONNECT_WECHAT_DEFAULT_EFFORT", "MYA_WECHAT_DEFAULT_EFFORT"]),
    permissionMode: resolveConnectPermissionMode({
      envValues: [
        readTextEnv(["MYA_DEFAULT_PERMISSION_MODE"]),
        readTextEnv(["MYA_CONNECT_WECHAT_PERMISSION_MODE", "MYA_WECHAT_PERMISSION_MODE"]),
      ],
      settings: userSettings,
      fallback: "dontAsk",
    }),
    enableAutoMode: readBooleanEnv(["MYA_CONNECT_WECHAT_ENABLE_AUTO_MODE", "MYA_WECHAT_ENABLE_AUTO_MODE"], false),
    preserveExistingAccounts: readBooleanEnv(
      ["MYA_CONNECT_WECHAT_PRESERVE_EXISTING_ACCOUNTS", "MYA_WECHAT_PRESERVE_EXISTING_ACCOUNTS"],
      true
    ),
    autoSelectLatestAccount: readBooleanEnv(
      ["MYA_CONNECT_WECHAT_AUTO_SELECT_LATEST_ACCOUNT", "MYA_WECHAT_AUTO_SELECT_LATEST_ACCOUNT"],
      true
    ),
    myaCommand: readTextEnv(["MYA_CONNECT_WECHAT_MYA_COMMAND", "MYA_WECHAT_MYA_COMMAND"]) || "mya",
    enableTyping: readBooleanEnv(["MYA_CONNECT_WECHAT_ENABLE_TYPING", "MYA_WECHAT_ENABLE_TYPING"], true),
    sessionsFile: readTextEnv(["MYA_CONNECT_WECHAT_SESSIONS_FILE", "MYA_WECHAT_SESSIONS_FILE"])
      || path.join(stateDir, "sessions.json"),
    syncBufferDir: readTextEnv(["MYA_CONNECT_WECHAT_SYNC_BUFFER_DIR", "MYA_WECHAT_SYNC_BUFFER_DIR"])
      || path.join(stateDir, "sync-buf"),
    accountsDir: path.join(stateDir, "accounts"),
    qrBotType: readTextEnv(["MYA_CONNECT_WECHAT_QR_BOT_TYPE", "MYA_WECHAT_QR_BOT_TYPE"]) || "3",
  };
}

function readListEnv(names) {
  return String(readTextEnv(names) || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readBooleanEnv(names, defaultValue) {
  const rawValue = readTextEnv(names);
  if (!rawValue) {
    return defaultValue;
  }

  const normalized = rawValue.toLowerCase();
  if (TRUE_ENV_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_ENV_VALUES.has(normalized)) {
    return false;
  }
  return defaultValue;
}

function readTextEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

module.exports = { readWechatConfig };
