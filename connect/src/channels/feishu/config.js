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

function readFeishuConfig(mode) {
  const stateDir = readTextEnv(["MYA_CONNECT_FEISHU_STATE_DIR"])
    || path.join(os.homedir(), ".mya-connect", "feishu");

  return {
    mode,
    stateDir,
    appId: readTextEnv(["MYA_CONNECT_FEISHU_APP_ID"]),
    appSecret: readTextEnv(["MYA_CONNECT_FEISHU_APP_SECRET"]),
    allowedOpenIds: readListEnv(["MYA_CONNECT_FEISHU_ALLOWED_OPEN_IDS"]),
    workspaceAllowlist: readListEnv(["MYA_CONNECT_FEISHU_WORKSPACE_ALLOWLIST"]),
    defaultWorkspaceRoot: readTextEnv(["MYA_CONNECT_FEISHU_DEFAULT_WORKSPACE"]),
    defaultWorkspaceId: readTextEnv(["MYA_CONNECT_FEISHU_DEFAULT_WORKSPACE_ID"]) || "default",
    defaultModel: readTextEnv(["MYA_CONNECT_FEISHU_DEFAULT_MODEL"]) || "sonnet",
    defaultEffort: readTextEnv(["MYA_CONNECT_FEISHU_DEFAULT_EFFORT"]),
    permissionMode: readPermissionModeEnv(["MYA_CONNECT_FEISHU_PERMISSION_MODE"], "dontAsk"),
    enableAutoMode: readBooleanEnv(["MYA_CONNECT_FEISHU_ENABLE_AUTO_MODE"], false),
    myaCommand: readTextEnv(["MYA_CONNECT_FEISHU_MYA_COMMAND"]) || "mya",
    enableGroupAtMessages: readBooleanEnv(["MYA_CONNECT_FEISHU_ENABLE_GROUP_AT"], true),
    replyInThread: readBooleanEnv(["MYA_CONNECT_FEISHU_REPLY_IN_THREAD"], false),
    sessionsFile: readTextEnv(["MYA_CONNECT_FEISHU_SESSIONS_FILE"])
      || path.join(stateDir, "sessions.json"),
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

function readPermissionModeEnv(names, fallback) {
  const value = readTextEnv(names);
  if (ALLOWED_PERMISSION_MODES.has(value)) {
    return value;
  }
  return fallback;
}

module.exports = { readFeishuConfig };
