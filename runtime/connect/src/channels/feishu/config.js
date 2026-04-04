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
function readFeishuConfig(mode) {
  const stateDir = readTextEnv(["MYA_CONNECT_FEISHU_STATE_DIR"])
    || getConnectChannelRoot("feishu");
  const userSettings = readUserSettings();

  return {
    mode,
    stateDir,
    appId: readTextEnv(["MYA_CONNECT_FEISHU_APP_ID"]),
    appSecret: readTextEnv(["MYA_CONNECT_FEISHU_APP_SECRET"]),
    allowedOpenIds: readListEnv(["MYA_CONNECT_FEISHU_ALLOWED_OPEN_IDS"]),
    workspaceAllowlist: readListEnv(["MYA_CONNECT_FEISHU_WORKSPACE_ALLOWLIST"]),
    defaultWorkspaceRoot: readTextEnv(["MYA_CONNECT_FEISHU_DEFAULT_WORKSPACE"]),
    defaultWorkspaceId: readTextEnv(["MYA_CONNECT_FEISHU_DEFAULT_WORKSPACE_ID"]) || "default",
    defaultModel: resolveConnectDefaultModel({
      explicitValues: [
        readTextEnv(["MYA_CONNECT_FEISHU_DEFAULT_MODEL"]),
      ],
      settings: userSettings,
    }),
    defaultEffort: readTextEnv(["MYA_CONNECT_FEISHU_DEFAULT_EFFORT"]),
    permissionMode: resolveConnectPermissionMode({
      envValues: [
        readTextEnv(["MYA_DEFAULT_PERMISSION_MODE"]),
        readTextEnv(["MYA_CONNECT_FEISHU_PERMISSION_MODE"]),
      ],
      settings: userSettings,
      fallback: "dontAsk",
    }),
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

module.exports = { readFeishuConfig };
