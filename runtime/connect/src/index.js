const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const readline = require("readline/promises");
const dotenv = require("dotenv");

const { readWechatConfig } = require("./channels/wechat/config");
const { readFeishuConfig } = require("./channels/feishu/config");
const { WechatRuntime } = require("./app/wechat-runtime");
const { FeishuRuntime } = require("./app/feishu-runtime");
const {
  ensureBotInstructionsFile,
  resolveBotInstructionsPath,
} = require("./hub/profiles/bot-instructions");
const {
  migrateLegacyWechatState,
  resolveWechatMigrationPaths,
} = require("./infra/config/wechat-migration");
const { runLoginFlow } = require("./infra/weixin/login");
const { listWeixinAccounts } = require("./infra/weixin/account-store");
const {
  getConnectLogPrefix,
} = require("./shared/branding");
const {
  resolveConnectPermissionMode,
} = require("./shared/settings");
const {
  getConnectChannelRoot,
  getConnectConfigRoot,
  getHubProfilesRoot,
  getHubStateRoot,
} = require("./shared/runtime-paths");

const HUB_HEARTBEAT_INTERVAL_MS = 5000;
const HUB_HEARTBEAT_STALE_MS = 15000;

function ensureDefaultConfigDirectory() {
  fs.mkdirSync(getConnectConfigRoot(), { recursive: true });
}

function getEnvCandidates(channel) {
  return [
    path.join(process.cwd(), ".env"),
    path.join(getConnectConfigRoot(), ".env"),
    path.join(getConnectChannelRoot(channel || ""), ".env"),
    path.join(os.homedir(), ".mya-connect", ".env"),
    path.join(os.homedir(), ".mya-connect", channel || "", ".env"),
    channel === "wechat" ? path.join(os.homedir(), ".mya-wechat", ".env") : "",
  ];
}

function loadEnv(channel) {
  const envCandidates = getEnvCandidates(channel);

  for (const envPath of envCandidates) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    dotenv.config({ path: envPath });
    return;
  }

  dotenv.config();
}

function readEnvOverrides(channel) {
  for (const envPath of getEnvCandidates(channel)) {
    if (!envPath || !fs.existsSync(envPath)) {
      continue;
    }
    return dotenv.parse(fs.readFileSync(envPath, "utf8"));
  }
  return {};
}

function buildHelpText() {
  return `
用法: mya <command>

bot commands:
  mya bots                    List saved bots and choose one to open
  mya bots add <name>         Create a bot in the current workspace and open it
  mya bots remove <name>      Remove a saved bot and its BOT.md

channel commands:
  mya wechat login [bot]      Login WeChat and bind the single WeChat entry to a bot
  mya wechat accounts         Show saved WeChat accounts
  mya feishu login [bot]      Save Feishu app credentials for a bot
  mya feishu check            Validate Feishu app credentials

first-time bot setup:
  mya bots add review-bot     Create a new bot and open it immediately
  # then inside the new session:
  /whoru                      Explain or save the bot's identity and purpose

service:
  mya serve                   Start every configured bot/channel together

notes:
  - omitting [bot] uses the default bot
  - mya bots add <name> writes both profile.json and BOT.md
  - WeChat can only be bound to one bot at a time
  - each Feishu bot keeps its own appId/appSecret inside that bot profile
  - mya serve only manages bots that have a configured wechat or feishu channel
  - advanced service/debug commands still exist: mya serve status|restart|stop|logs, mya wechat start, mya feishu start
  - legacy alias \`mya connect ...\` still works for older scripts, but it is no longer the recommended entry point
`;
}

function printHelp() {
  console.log(buildHelpText());
}

function printWechatAccounts(config) {
  const accounts = listWeixinAccounts(config);
  if (!accounts.length) {
    console.log("当前没有已保存的微信账号。先执行 `mya wechat login`。");
    return;
  }

  console.log("已保存账号：");
  for (const account of accounts) {
    console.log(`- ${account.accountId}`);
    console.log(`  userId: ${account.userId || "(unknown)"}`);
    console.log(`  baseUrl: ${account.baseUrl || config.baseUrl}`);
    console.log(`  savedAt: ${account.savedAt || "(unknown)"}`);
  }
}

function getDefaultBotName() {
  const explicit = normalizeHubText(process.env.MYA_DEFAULT_BOT);
  return explicit || "default";
}

function resolveBotName(rawBotName) {
  return normalizeHubText(rawBotName) || getDefaultBotName();
}

function parseChannelCommandArguments(channelName, supportedCommands = []) {
  const first = normalizeHubText(process.argv[3]).toLowerCase();
  const second = normalizeHubText(process.argv[4]).toLowerCase();
  const commandSet = new Set(supportedCommands);

  if (commandSet.has(first)) {
    return {
      channel: channelName,
      command: first,
      botName: resolveBotName(process.argv[4]),
      rest: process.argv.slice(5),
    };
  }

  if (commandSet.has(second)) {
    return {
      channel: channelName,
      command: second,
      botName: resolveBotName(process.argv[3]),
      rest: process.argv.slice(5),
    };
  }

  return {
    channel: channelName,
    command: first,
    botName: resolveBotName(process.argv[4]),
    rest: process.argv.slice(5),
  };
}

async function promptForInput(label, {
  defaultValue = "",
  required = true,
} = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    if (defaultValue) {
      return defaultValue;
    }
    throw new Error(`缺少交互终端，无法输入 ${label}`);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const promptSuffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = await rl.question(`${label}${promptSuffix}: `);
    const normalized = normalizeHubText(answer) || normalizeHubText(defaultValue);
    if (!normalized && required) {
      throw new Error(`${label} 不能为空`);
    }
    return normalized;
  } finally {
    rl.close();
  }
}

async function runFeishuCheck(config) {
  if (!config.appId || !config.appSecret) {
    throw new Error(
      "缺少飞书配置。请设置 MYA_CONNECT_FEISHU_APP_ID 和 MYA_CONNECT_FEISHU_APP_SECRET。"
    );
  }

  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      app_id: config.appId,
      app_secret: config.appSecret,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
    const detail = payload.msg || `${response.status} ${response.statusText}`;
    throw new Error(`飞书凭证校验失败: ${detail}`);
  }

  console.log("飞书凭证校验通过。");
  console.log(`app_id: ${config.appId}`);
  console.log(`expire: ${payload.expire || "(unknown)"}`);
}

function getDefaultHubProfilesDir() {
  return getHubProfilesRoot();
}

function getDefaultHubStateDir() {
  return getHubStateRoot();
}

function getDefaultHubPidFile() {
  return path.join(getDefaultHubStateDir(), "runtime.pid");
}

function getDefaultHubStatusFile() {
  return path.join(getDefaultHubStateDir(), "runtime-status.json");
}

function ensureHubStateDirectory() {
  fs.mkdirSync(getDefaultHubStateDir(), { recursive: true });
}

function getHubProfileStore() {
  const { HubProfileStore } = require("./hub/profiles/profile-store");
  return new HubProfileStore();
}

function getHubTaskRegistry() {
  const { HubTaskRegistry } = require("./hub/tasks/task-registry");
  return new HubTaskRegistry();
}

function getHubPolicyStore() {
  const { PolicyStore } = require("./hub/governance/policy-store");
  return new PolicyStore();
}

function getHubAuditLog() {
  const { AuditLog } = require("./hub/governance/audit-log");
  return new AuditLog();
}

function getHubProfileId(profileEntry) {
  if (typeof profileEntry === "string") {
    return profileEntry;
  }

  if (!profileEntry || typeof profileEntry !== "object") {
    return "";
  }

  return String(profileEntry.profileId || profileEntry.id || "").trim();
}

function printHubProfilesList(store) {
  const profiles = Array.isArray(store.list()) ? store.list() : [];
  if (!profiles.length) {
    console.log(`当前没有已保存的 bots。目录: ${getDefaultHubProfilesDir()}`);
    return;
  }

  console.log("已保存 bots：");
  for (const profileEntry of profiles) {
    const profileId = getHubProfileId(profileEntry);
    const channelCount = Array.isArray(profileEntry?.channels) ? profileEntry.channels.length : 0;

    console.log(`- ${profileId || "(missing-id)"}`);
    if (profileEntry?.name) {
      console.log(`  name: ${profileEntry.name}`);
    }
    console.log(`  channels: ${channelCount}`);
  }
}

function printBotsList(store) {
  const profiles = Array.isArray(store.list()) ? store.list() : [];
  if (!profiles.length) {
    console.log(`当前没有已保存的 bots。首次创建可用 \`mya bots add <name>\``);
    return;
  }

  const { getBotWorkspaceRoot, hasConfiguredBotIdentity } = require("./hub/profiles/bot-profile");

  console.log("已保存 bots：");
  for (const profile of profiles) {
    const profileId = getHubProfileId(profile);
    const workspaceRoot = getBotWorkspaceRoot(profile) || "(none)";
    const channels = Array.isArray(profile?.channels) ? profile.channels : [];
    const channelBindings = channels
      .map((channel) => describeChannelBinding(channel))
      .filter(Boolean);
    console.log(`- ${profileId || "(missing-id)"}`);
    if (profile?.name) {
      console.log(`  name: ${profile.name}`);
    }
    console.log(`  workspace: ${workspaceRoot}`);
    console.log(`  identity: ${hasConfiguredBotIdentity(profile) ? "configured" : "bootstrap"}`);
    console.log(`  channels: ${channelBindings.length ? channelBindings.join(", ") : "terminal-only"}`);
  }
}

function getStoredBots(store) {
  return Array.isArray(store?.list?.()) ? store.list() : [];
}

function formatInteractiveBotChoice(profile, index) {
  const { getBotWorkspaceRoot, hasConfiguredBotIdentity } = require("./hub/profiles/bot-profile");
  const profileId = getHubProfileId(profile) || "(missing-id)";
  const workspaceRoot = getBotWorkspaceRoot(profile) || "(none)";
  const channels = Array.isArray(profile?.channels) ? profile.channels : [];
  const channelBindings = channels
    .map((channel) => describeChannelBinding(channel))
    .filter(Boolean);
  const botLabel = profile?.name && profile.name !== profileId
    ? `${profileId} (${profile.name})`
    : profileId;

  return [
    `${index + 1}. ${botLabel}`,
    `   workspace: ${workspaceRoot}`,
    `   identity: ${hasConfiguredBotIdentity(profile) ? "configured" : "bootstrap"}`,
    `   channels: ${channelBindings.length ? channelBindings.join(", ") : "terminal-only"}`,
  ];
}

function writeInteractiveSelectorOutput(output, text) {
  if (typeof output === "function") {
    output(text);
    return;
  }

  if (output && typeof output.write === "function") {
    output.write(text);
  }
}

function renderInteractiveBotsSelector(profiles, selectedIndex) {
  const lines = [
    "\x1b[2J\x1b[H\x1b[?25l",
    "选择一个 bot 进入：",
    "",
  ];

  for (const [index, profile] of profiles.entries()) {
    const rendered = formatInteractiveBotChoice(profile, index);
    const firstLine = rendered[0] || "";
    const marker = index === selectedIndex ? ">" : " ";
    lines.push(`${marker} ${firstLine.replace(/^\d+\.\s*/, "")}`);
    for (const line of rendered.slice(1)) {
      lines.push(`  ${line.trimStart()}`);
    }
    lines.push("");
  }

  lines.push("↑/↓ 选择，Enter 打开，q 或 Esc 退出。");
  return `${lines.join("\n")}\n`;
}

async function runInteractiveBotsSelector(store, {
  input = process.stdin,
  output = process.stdout,
  launch = launchBotConversation,
} = {}) {
  const profiles = getStoredBots(store);
  if (!profiles.length) {
    writeInteractiveSelectorOutput(output, "当前没有已保存的 bots。首次创建可用 `mya bots add <name>`\n");
    return false;
  }

  const outputSupportsInteractive = typeof output === "function"
    || Boolean(output && output.isTTY);

  if (!input || !output || !input.isTTY || !outputSupportsInteractive) {
    printBotsList(store);
    return false;
  }

  return await new Promise((resolve, reject) => {
    let selectedIndex = 0;
    let settled = false;

    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      input.removeListener("data", handleData);
      if (typeof input.setRawMode === "function") {
        input.setRawMode(false);
      }
      if (typeof input.pause === "function") {
        input.pause();
      }
      writeInteractiveSelectorOutput(output, "\x1b[?25h");
    };

    const render = () => {
      writeInteractiveSelectorOutput(
        output,
        renderInteractiveBotsSelector(profiles, selectedIndex),
      );
    };

    const openSelectedProfile = () => {
      const { resolveProfilePath } = require("./hub/profiles/profile-paths");
      const profile = profiles[selectedIndex];
      const profilePath = resolveProfilePath(profile.profileId, {
        profilesRoot: store.profilesRoot,
      });
      const instructionsPath = resolveBotInstructionsPath(profile.profileId);

      cleanup();
      Promise.resolve(launch(profile, profilePath, instructionsPath))
        .then(() => resolve(true))
        .catch(reject);
    };

    const cancel = () => {
      cleanup();
      writeInteractiveSelectorOutput(output, "已取消。\n");
      resolve(false);
    };

    const handleData = (chunk) => {
      const text = String(chunk);

      if (text === "\u0003") {
        cleanup();
        reject(new Error("已中断"));
        return;
      }

      if (text === "\u001b[A") {
        selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : profiles.length - 1;
        render();
        return;
      }

      if (text === "\u001b[B") {
        selectedIndex = selectedIndex < profiles.length - 1 ? selectedIndex + 1 : 0;
        render();
        return;
      }

      if (text === "\r" || text === "\n") {
        openSelectedProfile();
        return;
      }

      if (text === "\u001b" || text.toLowerCase() === "q") {
        cancel();
      }
    };

    if (typeof input.setEncoding === "function") {
      input.setEncoding("utf8");
    }
    if (typeof input.setRawMode === "function") {
      input.setRawMode(true);
    }
    if (typeof input.resume === "function") {
      input.resume();
    }
    input.on("data", handleData);
    render();
  });
}

function validateHubProfile(profile) {
  const problems = [];

  if (!profile || typeof profile !== "object") {
    return ["profile.json 必须是对象"];
  }
  if (!String(profile.profileId || profile.id || "").trim()) {
    problems.push("缺少 profileId");
  }
  if (!Array.isArray(profile.channels)) {
    problems.push("channels 必须是数组");
  } else {
    profile.channels.forEach((channel, index) => {
      if (!channel || typeof channel !== "object") {
        problems.push(`channels[${index}] 必须是对象`);
        return;
      }
      if (!String(channel.type || "").trim()) {
        problems.push(`channels[${index}].type 缺失`);
        return;
      }

      const type = normalizeHubText(channel.type).toLowerCase();
      if (type === "wechat" && !normalizeHubText(channel.accountId || channel.channelId)) {
        problems.push(`channels[${index}] 的 wechat 绑定缺少 accountId`);
      }
      if (type === "feishu") {
        if (!normalizeHubText(channel.appId || channel.accountId)) {
          problems.push(`channels[${index}] 的 feishu 绑定缺少 appId`);
        }
        if (!normalizeHubText(channel.appSecret)) {
          problems.push(`channels[${index}] 的 feishu 绑定缺少 appSecret`);
        }
      }
    });
  }

  return problems;
}

function describeChannelBinding(channel) {
  if (!channel || typeof channel !== "object") {
    return "";
  }

  const type = normalizeHubText(channel.type).toLowerCase();
  if (!type) {
    return "";
  }

  if (type === "wechat") {
    return `wechat:${pickHubText(channel.accountId, channel.channelId, "(unbound)")}`;
  }

  if (type === "feishu") {
    return `feishu:${pickHubText(channel.appId, channel.accountId, "(unbound)")}`;
  }

  return type;
}

function validateHubTopology(profiles) {
  const problems = [];
  const runnableProfiles = Array.isArray(profiles) ? profiles : [];
  const activeWechatBindings = [];
  const feishuOwners = new Map();

  for (const profile of runnableProfiles) {
    const profileId = getHubProfileId(profile) || "(missing-id)";
    const channels = Array.isArray(profile?.channels) ? profile.channels : [];

    for (const channel of channels) {
      if (!channel || channel.enabled === false) {
        continue;
      }

      const type = normalizeHubText(channel.type).toLowerCase();
      if (!type) {
        continue;
      }

      if (type === "wechat") {
        const accountId = pickHubText(channel.accountId, channel.channelId);
        activeWechatBindings.push({
          profileId,
          accountId: accountId || "(missing-account)",
        });
        continue;
      }

      if (type === "feishu") {
        const appId = pickHubText(channel.appId, channel.accountId);
        if (!appId) {
          continue;
        }

        const existingOwner = feishuOwners.get(appId);
        if (existingOwner && existingOwner !== profileId) {
          problems.push(`飞书 appId ${appId} 同时绑定到了 ${existingOwner} 和 ${profileId}`);
          continue;
        }
        feishuOwners.set(appId, profileId);
      }
    }
  }

  if (activeWechatBindings.length > 1) {
    const details = activeWechatBindings
      .map((entry) => `${entry.profileId}:${entry.accountId}`)
      .join(", ");
    problems.push(`微信当前只支持一个 bot 绑定。检测到多个绑定: ${details}`);
  }

  return problems;
}

function runHubProfilesValidate(store) {
  const entries = Array.isArray(store.list()) ? store.list() : [];
  if (!entries.length) {
    console.log(`当前没有已保存的 bots。目录: ${getDefaultHubProfilesDir()}`);
    return;
  }

  let invalidCount = 0;

  for (const entry of entries) {
    const profileId = getHubProfileId(entry);
    const profile = profileId && typeof store.get === "function" ? store.get(profileId) : entry;
    const problems = validateHubProfile(profile);

    if (!problems.length) {
      console.log(`- ${profileId}: ok`);
      continue;
    }

    invalidCount += 1;
    console.log(`- ${profileId || "(missing-id)"}: invalid`);
    for (const problem of problems) {
      console.log(`  - ${problem}`);
    }
  }

  const topologyProblems = validateHubTopology(entries);
  if (topologyProblems.length > 0) {
    invalidCount += topologyProblems.length;
    console.log("- bot channel topology: invalid");
    for (const problem of topologyProblems) {
      console.log(`  - ${problem}`);
    }
  }

  if (invalidCount > 0) {
    throw new Error(`${invalidCount} 个 hub profile 校验失败。`);
  }

  console.log(`Bots 校验通过，共 ${entries.length} 个。`);
}

function normalizeHubText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHubStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeHubText(item))
      .filter(Boolean);
  }

  const text = normalizeHubText(value);
  if (!text) {
    return [];
  }

  return text.split(",").map((item) => item.trim()).filter(Boolean);
}

function pickHubText(...values) {
  for (const value of values) {
    const normalized = normalizeHubText(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function pickHubStringList(...values) {
  for (const value of values) {
    const normalized = normalizeHubStringList(value);
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return [];
}

function pickHubBoolean(...values) {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
  }
  return false;
}

function sanitizeHubPathSegment(value, fallback = "default") {
  const normalized = normalizeHubText(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function resolveMainCommandForInteractiveUse() {
  return normalizeHubText(process.env.MYA_CONNECT_MAIN_COMMAND)
    || path.resolve(__dirname, "..", "..", "..", "cli");
}

function spawnForegroundMainCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exitCode = code || 0;
      resolve(code || 0);
    });
  });
}

function buildActiveBotEnv(profile, profilePath, instructionsPath) {
  const { hasConfiguredBotIdentity } = require("./hub/profiles/bot-profile");

  return {
    ...process.env,
    MYA_ACTIVE_BOT_ID: profile.profileId,
    MYA_ACTIVE_BOT_PROFILE_ID: profile.profileId,
    MYA_ACTIVE_BOT_PROFILE_PATH: profilePath,
    MYA_ACTIVE_BOT_INSTRUCTIONS_PATH:
      instructionsPath || resolveBotInstructionsPath(profile.profileId),
    MYA_ACTIVE_BOT_BOOTSTRAP: hasConfiguredBotIdentity(profile) ? "0" : "1",
    MYA_HUB_PROFILE_ID: profile.profileId,
  };
}

async function launchBotConversation(profile, profilePath, instructionsPath) {
  const { getBotWorkspaceRoot } = require("./hub/profiles/bot-profile");
  const cwd = getBotWorkspaceRoot(profile) || process.cwd();

  await spawnForegroundMainCommand(resolveMainCommandForInteractiveUse(), [], {
    cwd,
    env: buildActiveBotEnv(profile, profilePath, instructionsPath),
  });
}

function resolveHubProfileChannelsDir(profileId) {
  return path.join(getDefaultHubProfilesDir(), sanitizeHubPathSegment(profileId), "channels");
}

function resolveHubChannelSessionsFile(profileId, channelType, accountId) {
  const fileName = `${sanitizeHubPathSegment(channelType)}-${sanitizeHubPathSegment(accountId)}-sessions.json`;
  return path.join(resolveHubProfileChannelsDir(profileId), fileName);
}

function readHubRuntimeStatusFile() {
  const statusFile = getDefaultHubStatusFile();
  if (!fs.existsSync(statusFile)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(statusFile, "utf8"));
  } catch {
    return null;
  }
}

function writeHubRuntimeStatusFile(status) {
  ensureHubStateDirectory();
  fs.writeFileSync(getDefaultHubStatusFile(), JSON.stringify(status, null, 2), "utf8");
}

function writeHubRuntimePidFile(pid) {
  ensureHubStateDirectory();
  fs.writeFileSync(getDefaultHubPidFile(), `${pid}\n`, "utf8");
}

function readHubRuntimePidFile() {
  const pidFile = getDefaultHubPidFile();
  if (!fs.existsSync(pidFile)) {
    return 0;
  }

  const rawValue = fs.readFileSync(pidFile, "utf8").trim();
  const pid = Number.parseInt(rawValue, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
}

function clearHubRuntimeStateFiles() {
  for (const filePath of [getDefaultHubPidFile(), getDefaultHubStatusFile()]) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // best effort cleanup
    }
  }
}

function writeHubRuntimeState(status) {
  writeHubRuntimePidFile(status.pid || process.pid);
  writeHubRuntimeStatusFile(status);
}

function isHubProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function serializeHubRuntimeStatus(entries) {
  const activeProfiles = Array.isArray(entries) ? entries : [];
  return buildHubSupervisorStatusSnapshot({
    pid: process.pid,
    state: "running",
    profiles: activeProfiles.map((entry) => ({
      key: entry.key,
      profileId: entry.profileId,
      channelType: entry.type,
      accountId: entry.accountId,
      state: entry.state,
    })),
  });
}

async function runHubSupervisorMaintenanceTick({
  hubRuntime,
  auditLog = null,
  writeStatus = null,
  now = new Date(),
  state = "running",
} = {}) {
  if (!hubRuntime || typeof hubRuntime.tick !== "function") {
    throw new TypeError("runHubSupervisorMaintenanceTick requires a hubRuntime with tick().");
  }

  const tickResult = await hubRuntime.tick(now);
  const dispatches = Array.isArray(tickResult)
    ? tickResult
    : (Array.isArray(tickResult?.dispatches) ? tickResult.dispatches : []);
  const activeEntries = Array.isArray(tickResult?.active)
    ? tickResult.active
    : (typeof hubRuntime.status === "function" ? hubRuntime.status() : []);

  const status = buildHubSupervisorStatusSnapshot({
    pid: process.pid,
    state,
    updatedAt: new Date(now).toISOString(),
    heartbeatAt: new Date(now).toISOString(),
    profiles: (Array.isArray(activeEntries) ? activeEntries : []).map((entry) => ({
      key: entry.key,
      profileId: entry.profileId,
      channelType: entry.type || entry.channelType,
      accountId: entry.accountId,
      state: entry.state,
    })),
  });

  if (typeof writeStatus === "function") {
    writeStatus(status);
  }

  if (auditLog && typeof auditLog.append === "function") {
    for (const dispatch of dispatches) {
      auditLog.append({
        type: "task_dispatch",
        profileId: normalizeHubText(dispatch?.profileId),
        actor: "hub",
        taskId: normalizeHubText(dispatch?.taskId),
        detail: [normalizeHubText(dispatch?.trigger), normalizeHubText(dispatch?.workspaceRoot)]
          .filter(Boolean)
          .join(":"),
      });
    }
  }

  return {
    status,
    dispatches,
    active: Array.isArray(activeEntries) ? activeEntries : [],
  };
}

function buildHubSupervisorStatusSnapshot({
  pid = process.pid,
  profiles = [],
  state = "running",
  updatedAt = new Date().toISOString(),
  heartbeatAt = new Date().toISOString(),
} = {}) {
  return {
    pid,
    state,
    updatedAt,
    heartbeatAt,
    profiles: Array.isArray(profiles) ? profiles.map((entry) => ({ ...entry })) : [],
  };
}

function isHubStatusHeartbeatFresh(status, now = Date.now()) {
  const heartbeatText = normalizeHubText(status?.heartbeatAt);
  if (!heartbeatText) {
    return false;
  }

  const heartbeatTime = Date.parse(heartbeatText);
  if (!Number.isFinite(heartbeatTime)) {
    return false;
  }

  return now - heartbeatTime <= HUB_HEARTBEAT_STALE_MS;
}

function printPersistedHubRuntimeStatus(status) {
  const profiles = Array.isArray(status?.profiles) ? status.profiles : [];
  const pid = Number.isInteger(status?.pid) ? status.pid : 0;
  const updatedAt = normalizeHubText(status?.updatedAt) || "(unknown)";
  const heartbeatAt = normalizeHubText(status?.heartbeatAt) || "(unknown)";
  const state = normalizeHubText(status?.state) || "(unknown)";

  console.log(`mya service status: ${profiles.length} active bot channel(s).`);
  console.log(`pid: ${pid || "(unknown)"}`);
  console.log(`state: ${state}`);
  console.log(`updatedAt: ${updatedAt}`);
  console.log(`heartbeatAt: ${heartbeatAt}`);
  for (const profile of profiles) {
    console.log(`- ${profile.profileId}:${profile.channelType}:${profile.accountId} -> ${profile.state}`);
  }
}

function printHubOperatorSummary(runtimeStatus) {
  const { buildOperatorSummary } = require("./hub/governance/operator-summary");
  const summary = buildOperatorSummary({
    profileStore: getHubProfileStore(),
    runtimeStatus,
    taskRegistry: getHubTaskRegistry(),
    policyStore: getHubPolicyStore(),
    auditLog: getHubAuditLog(),
  });

  console.log(`bots enabled: ${summary.hubEnabled ? "yes" : "no"}`);
  console.log(`bots configured: ${summary.profileCount}`);
  console.log(`active channels: ${summary.activeRuntimeCount}`);
  console.log(`tasks: ${summary.taskCount}`);
  console.log(`policies: ${summary.policyCount}`);
  console.log(`recent audits: ${summary.recentAuditCount}`);
}

function createManagedChannelRuntime(label, runtime) {
  let startPromise = null;
  let readyPromise = null;

  return {
    async start() {
      if (!startPromise) {
        startPromise = Promise.resolve()
          .then(() => runtime.start())
          .catch((error) => {
            console.error(`${getConnectLogPrefix("hub")} runtime failed ${label}: ${error.message}`);
            throw error;
          });
        void startPromise.catch(() => {});
        readyPromise = new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve();
          }, 50);
          startPromise.catch((error) => {
            clearTimeout(timer);
            reject(error);
          });
        });
      }
      return readyPromise;
    },
    async stop() {
      if (typeof runtime.stop === "function") {
        await runtime.stop();
      }
    },
    async notifyTaskCompletion(task) {
      if (typeof runtime.notifyTaskCompletion !== "function") {
        return null;
      }
      return runtime.notifyTaskCompletion(task);
    },
  };
}

function buildHubSupervisorSpawnSpec() {
  return {
    command: process.execPath,
    args: [__filename, "hub", "start"],
    options: {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        MYA_CONNECT_SUPERVISOR_CHILD: "1",
      },
    },
  };
}

function spawnDetachedHubSupervisor() {
  const spec = buildHubSupervisorSpawnSpec();
  const child = spawn(spec.command, spec.args, spec.options);
  child.unref();
  return child.pid || 0;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHubSupervisorReady(pid, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = readHubRuntimeStatusFile();
    if (status?.pid === pid && isHubStatusHeartbeatFresh(status)) {
      return status;
    }
    if (!isHubProcessAlive(pid)) {
      return null;
    }
    await sleep(100);
  }
  return readHubRuntimeStatusFile();
}

function createWechatProfileRuntimeConfig({ profile, profileId, channel, accountId, key }) {
  const baseConfig = readWechatConfig("start");
  const workspaceAllowlist = pickHubStringList(
    channel?.workspaceAllowlist,
    profile?.workspaceAllowlist,
    baseConfig.workspaceAllowlist
  );

  return {
    ...baseConfig,
    accountId: pickHubText(channel?.accountId, channel?.channelId, baseConfig.accountId),
    allowedUserIds: pickHubStringList(
      channel?.allowedUserIds,
      profile?.allowedUserIds,
      baseConfig.allowedUserIds
    ),
    workspaceAllowlist,
    defaultWorkspaceRoot: pickHubText(
      channel?.defaultWorkspaceRoot,
      profile?.defaultWorkspaceRoot,
      baseConfig.defaultWorkspaceRoot
    ),
    defaultWorkspaceId: pickHubText(
      channel?.defaultWorkspaceId,
      profile?.defaultWorkspaceId,
      baseConfig.defaultWorkspaceId
    ) || "default",
    defaultModel: pickHubText(channel?.defaultModel, profile?.defaultModel, baseConfig.defaultModel),
    defaultEffort: pickHubText(channel?.defaultEffort, profile?.defaultEffort, baseConfig.defaultEffort),
    permissionMode: resolveConnectPermissionMode({
      explicitValues: [channel?.permissionMode, profile?.permissionMode],
      fallback: baseConfig.permissionMode,
    }),
    enableAutoMode: pickHubBoolean(
      channel?.enableAutoMode,
      profile?.enableAutoMode,
      baseConfig.enableAutoMode
    ),
    enableTyping: pickHubBoolean(channel?.enableTyping, profile?.enableTyping, baseConfig.enableTyping),
    myaCommand: pickHubText(channel?.myaCommand, profile?.myaCommand, baseConfig.myaCommand) || "mya",
    profileContext: {
      profile,
      profileId,
      channelInstanceId: key,
      workspaceAllowlist,
      memoryNamespace: `profiles/${profileId}`,
      sessionsFile: resolveHubChannelSessionsFile(profileId, "wechat", accountId),
    },
  };
}

function createFeishuProfileRuntimeConfig({ profile, profileId, channel, accountId, key }) {
  const baseConfig = readFeishuConfig("start");
  const workspaceAllowlist = pickHubStringList(
    channel?.workspaceAllowlist,
    profile?.workspaceAllowlist,
    baseConfig.workspaceAllowlist
  );

  return {
    ...baseConfig,
    appId: pickHubText(channel?.appId, channel?.accountId, baseConfig.appId),
    appSecret: pickHubText(channel?.appSecret, baseConfig.appSecret),
    allowedOpenIds: pickHubStringList(
      channel?.allowedOpenIds,
      profile?.allowedOpenIds,
      baseConfig.allowedOpenIds
    ),
    workspaceAllowlist,
    defaultWorkspaceRoot: pickHubText(
      channel?.defaultWorkspaceRoot,
      profile?.defaultWorkspaceRoot,
      baseConfig.defaultWorkspaceRoot
    ),
    defaultWorkspaceId: pickHubText(
      channel?.defaultWorkspaceId,
      profile?.defaultWorkspaceId,
      baseConfig.defaultWorkspaceId
    ) || "default",
    defaultModel: pickHubText(channel?.defaultModel, profile?.defaultModel, baseConfig.defaultModel),
    defaultEffort: pickHubText(channel?.defaultEffort, profile?.defaultEffort, baseConfig.defaultEffort),
    permissionMode: resolveConnectPermissionMode({
      explicitValues: [channel?.permissionMode, profile?.permissionMode],
      fallback: baseConfig.permissionMode,
    }),
    enableAutoMode: pickHubBoolean(
      channel?.enableAutoMode,
      profile?.enableAutoMode,
      baseConfig.enableAutoMode
    ),
    replyInThread: pickHubBoolean(channel?.replyInThread, profile?.replyInThread, baseConfig.replyInThread),
    enableGroupAtMessages: pickHubBoolean(
      channel?.enableGroupAtMessages,
      profile?.enableGroupAtMessages,
      baseConfig.enableGroupAtMessages
    ),
    myaCommand: pickHubText(channel?.myaCommand, profile?.myaCommand, baseConfig.myaCommand) || "mya",
    profileContext: {
      profile,
      profileId,
      channelInstanceId: key,
      workspaceAllowlist,
      memoryNamespace: `profiles/${profileId}`,
      sessionsFile: resolveHubChannelSessionsFile(profileId, "feishu", accountId),
    },
  };
}

function createHubTaskDispatchBridge({ profileStore, taskExecutor, policyStore = null }) {
  const dispatchImpl = typeof taskExecutor?.enqueue === "function"
    ? taskExecutor.enqueue.bind(taskExecutor)
    : (typeof taskExecutor?.dispatch === "function" ? taskExecutor.dispatch.bind(taskExecutor) : null);
  if (!dispatchImpl) {
    throw new TypeError("createHubTaskDispatchBridge requires a taskExecutor with dispatch().");
  }

  return {
    async dispatch(payload = {}) {
      const profileId = normalizeHubText(payload.profileId);
      const profile = profileId && profileStore && typeof profileStore.get === "function"
        ? profileStore.get(profileId)
        : null;
      const policy = profileId && policyStore && typeof policyStore.get === "function"
        ? policyStore.get(profileId)
        : null;

      return dispatchImpl({
        ...payload,
        profile: profile || { profileId },
        permissionMode: pickHubText(
          payload.permissionMode,
          profile?.permissionMode,
          policy?.defaultPermissionMode,
        ),
        model: pickHubText(payload.model, profile?.defaultModel),
        effort: pickHubText(payload.effort, profile?.defaultEffort),
        workerType: pickHubText(payload.workerType, profile?.orchestration?.defaultWorkerType),
        workers: Array.isArray(profile?.workers) ? profile.workers : [],
        memoryPolicy: profile?.memoryPolicy,
        inheritedMemoryNamespace: pickHubText(payload.inheritedMemoryNamespace, profile?.memoryNamespace),
        enableAutoMode: pickHubBoolean(payload.enableAutoMode, profile?.enableAutoMode),
      });
    },
  };
}

function createHubRuntimeSupervisor() {
  const { HubRuntime } = require("./hub/runtime/hub-runtime");
  const { RuntimeRegistry } = require("./hub/runtime/runtime-registry");
  const { ProfileRuntimeFactory } = require("./hub/runtime/profile-runtime-factory");
  const { HubScheduler } = require("./hub/scheduler/scheduler");
  const { HubTaskExecutor } = require("./hub/tasks/task-executor");
  const profileStore = getHubProfileStore();
  const taskRegistry = getHubTaskRegistry();
  const policyStore = getHubPolicyStore();
  const auditLog = getHubAuditLog();
  const runtimeRegistry = new RuntimeRegistry();

  const factory = new ProfileRuntimeFactory({
    builders: {
      wechat: ({ profile, profileId, channel, accountId, key }) => {
        const config = createWechatProfileRuntimeConfig({ profile, profileId, channel, accountId, key });
        return {
          runtime: createManagedChannelRuntime(key, new WechatRuntime(config)),
        };
      },
      feishu: ({ profile, profileId, channel, accountId, key }) => {
        const config = createFeishuProfileRuntimeConfig({ profile, profileId, channel, accountId, key });
        return {
          runtime: createManagedChannelRuntime(key, new FeishuRuntime(config)),
        };
      },
    },
  });

  const taskExecutor = new HubTaskExecutor({
    taskRegistry,
    auditLog,
    completionNotifier: async ({ state, task }) => runtimeRegistry.notifyProfile(
      task?.profileId,
      "notifyTaskCompletion",
      {
        ...task,
        state,
      },
    ),
  });
  const dispatchBridge = createHubTaskDispatchBridge({
    profileStore,
    taskExecutor,
    policyStore,
  });
  const scheduler = new HubScheduler({
    registry: taskRegistry,
    dispatcher: dispatchBridge,
  });

  return {
    auditLog,
    profileStore,
    taskExecutor,
    taskRegistry,
    hubRuntime: new HubRuntime({
      profileStore,
      scheduler,
      runtimeRegistry,
      profileRuntimeFactory: factory,
    }),
  };
}

async function runHubSupervisorChildProcess() {
  const { hubRuntime, auditLog, taskExecutor } = createHubRuntimeSupervisor();
  const result = await hubRuntime.start();
  const writeStatus = (state = "running") => {
    const status = serializeHubRuntimeStatus(hubRuntime.status());
    writeHubRuntimeState({
      ...status,
      pid: process.pid,
      state,
      updatedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    });
    return status;
  };
  const initialTick = await runHubSupervisorMaintenanceTick({
    hubRuntime,
    auditLog,
    now: new Date(),
    state: "running",
    writeStatus(status) {
      writeHubRuntimeState(status);
      return status;
    },
  });
  const status = initialTick.status;
  for (const entry of status.profiles) {
    auditLog.append({
      type: "profile_start",
      profileId: entry.profileId,
      actor: "hub",
      detail: `${entry.channelType}:${entry.accountId}`,
    });
  }

  if (!status.profiles.length) {
    clearHubRuntimeStateFiles();
    return result;
  }

  const heartbeatTimer = setInterval(() => {
    void runHubSupervisorMaintenanceTick({
      hubRuntime,
      auditLog,
      now: new Date(),
      state: "running",
      writeStatus(status) {
        writeHubRuntimeState(status);
        return status;
      },
    }).catch((error) => {
      console.error(`${getConnectLogPrefix("hub")} maintenance tick failed: ${error.message}`);
    });
  }, HUB_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  const shutdown = async () => {
    try {
      writeStatus("stopping");
      if (taskExecutor && typeof taskExecutor.stop === "function") {
        await taskExecutor.stop();
      }
      const stopped = await hubRuntime.stop();
      for (const entry of stopped.stopped || []) {
        auditLog.append({
          type: "profile_stop",
          profileId: entry.profileId,
          actor: "hub",
          detail: `${entry.type}:${entry.accountId}`,
        });
      }
      writeHubRuntimeState(buildHubSupervisorStatusSnapshot({
        pid: process.pid,
        profiles: stopped.active || [],
        state: "stopped",
      }));
    } finally {
      clearInterval(heartbeatTimer);
      clearHubRuntimeStateFiles();
    }
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  await new Promise(() => {});
  return result;
}

async function startHubSupervisorProcess() {
  const existingPid = readHubRuntimePidFile();
  if (existingPid && isHubProcessAlive(existingPid)) {
    throw new Error(`mya service 已在运行中 (pid=${existingPid})。`);
  }

  const profiles = getHubProfileStore().list();
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error("当前没有已保存的 bots。先配置 bots，再启动 mya service。");
  }
  const invalidProfiles = profiles
    .map((profile) => ({
      profileId: getHubProfileId(profile),
      problems: validateHubProfile(profile),
    }))
    .filter((entry) => entry.problems.length > 0);
  if (invalidProfiles.length > 0) {
    throw new Error(
      invalidProfiles
        .map((entry) => `${entry.profileId}: ${entry.problems.join("，")}`)
        .join("；"),
    );
  }
  const topologyProblems = validateHubTopology(profiles);
  if (topologyProblems.length > 0) {
    throw new Error(topologyProblems.join("；"));
  }
  if (!profiles.some((profile) => hasRunnableBotChannels(profile))) {
    throw new Error("当前没有已连接微信/飞书的 bot。先给 bot 绑定渠道，再启动 mya service。");
  }

  clearHubRuntimeStateFiles();
  const pid = spawnDetachedHubSupervisor();
  if (!pid) {
    throw new Error("mya service 启动失败：未拿到子进程 pid。");
  }

  const status = await waitForHubSupervisorReady(pid);
  if (status && isHubProcessAlive(pid)) {
    console.log(`mya service started with ${status.profiles.length} active bot channel(s).`);
    for (const entry of status.profiles) {
      console.log(`- ${entry.profileId}:${entry.channelType}:${entry.accountId} -> ${entry.state}`);
    }
    return status;
  }

  if (!isHubProcessAlive(pid)) {
    clearHubRuntimeStateFiles();
    throw new Error("mya service 启动失败：后台进程已退出。");
  }

  console.log(`mya service started (pid=${pid})，正在初始化。`);
  return null;
}

function hasRunnableBotChannels(profile) {
  const channels = Array.isArray(profile?.channels) ? profile.channels : [];
  return channels.some((channel) => {
    if (!channel || channel.enabled === false) {
      return false;
    }
    const type = normalizeHubText(channel.type).toLowerCase();
    if (type === "wechat") {
      return Boolean(normalizeHubText(channel.accountId || channel.channelId));
    }
    if (type === "feishu") {
      return Boolean(normalizeHubText(channel.appId || channel.accountId) && normalizeHubText(channel.appSecret));
    }
    return Boolean(type);
  });
}

function getBotProfileHelpers() {
  return require("./hub/profiles/bot-profile");
}

function ensureTargetBot(store, rawBotName) {
  const { ensureBotProfile } = getBotProfileHelpers();
  const { readUserSettings } = require("./shared/settings");
  const result = ensureBotProfile(store, {
    name: resolveBotName(rawBotName),
    workspaceRoot: process.cwd(),
    settings: readUserSettings(),
  });
  const instructionsPath = ensureBotInstructionsFile(result.profile, {
    profilesRoot: store.profilesRoot,
  });

  return {
    ...result,
    botName: resolveBotName(rawBotName),
    instructionsPath,
  };
}

async function bindWechatLoginToBot(config, rawBotName) {
  const store = getHubProfileStore();
  const { bindWechatChannel } = getBotProfileHelpers();
  const target = ensureTargetBot(store, rawBotName);
  const account = await runLoginFlow(config);
  const binding = bindWechatChannel(store, target.profile.profileId, {
    accountId: account.accountId,
  });

  console.log(`微信已绑定到 bot ${binding.profile.name || binding.profile.profileId}。`);
  console.log(`accountId: ${account.accountId}`);
  if (binding.reassignedFrom.length > 0) {
    console.log(`已从这些 bot 切换微信绑定: ${binding.reassignedFrom.join(", ")}`);
  }
  console.log(`bot instructions: ${target.instructionsPath}`);
}

async function bindFeishuLoginToBot(config, rawBotName) {
  const store = getHubProfileStore();
  const { bindFeishuChannel } = getBotProfileHelpers();
  const target = ensureTargetBot(store, rawBotName);
  const existingFeishu = (Array.isArray(target.profile.channels) ? target.profile.channels : [])
    .find((channel) => normalizeHubText(channel?.type).toLowerCase() === "feishu");

  const appId = await promptForInput("Feishu appId", {
    defaultValue: config.appId || existingFeishu?.appId || existingFeishu?.accountId || "",
  });
  const appSecret = await promptForInput("Feishu appSecret", {
    defaultValue: config.appSecret || existingFeishu?.appSecret || "",
  });

  const binding = bindFeishuChannel(store, target.profile.profileId, {
    appId,
    appSecret,
  });

  console.log(`飞书已绑定到 bot ${binding.profile.name || binding.profile.profileId}。`);
  console.log(`appId: ${appId}`);
  if (binding.replacedExisting) {
    console.log("该 bot 的飞书配置已覆盖为最新输入。");
  }
  if (binding.reassignedFrom.length > 0) {
    console.log(`已从这些 bot 切换同一个飞书 app 绑定: ${binding.reassignedFrom.join(", ")}`);
  }
  console.log(`bot instructions: ${target.instructionsPath}`);
}

async function runBotsCommand() {
  const command = String(process.argv[3] || "").trim().toLowerCase();
  const rest = process.argv.slice(4);
  const store = getHubProfileStore();

  if (!command) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      await runInteractiveBotsSelector(store);
      return;
    }
    printBotsList(store);
    return;
  }

  if (command === "help" || command === "--help" || command === "-h" || command === "list") {
    printBotsList(store);
    return;
  }

  if (command === "check" || command === "validate") {
    runHubProfilesValidate(store);
    return;
  }

  if (command === "add" || command === "create") {
    const rawName = normalizeHubText(rest.join(" "));
    if (!rawName) {
      throw new Error("用法: mya bots add <name>");
    }

    const { normalizeProfileId, resolveProfilePath } = require("./hub/profiles/profile-paths");
    const { created, profile, instructionsPath } = ensureTargetBot(store, rawName);

    if (created) {
      console.log(`已创建 bot ${profile.name} (${profile.profileId})。`);
      console.log(`bot instructions: ${instructionsPath}`);
      console.log("输入 /whoru 可以继续定义它的身份和作用，也可以直接编辑 BOT.md。");
    } else {
      console.log(`打开已有 bot ${profile.name} (${profile.profileId})。`);
      console.log(`bot instructions: ${instructionsPath}`);
    }

    await launchBotConversation(
      profile,
      resolveProfilePath(profile.profileId, {
        profilesRoot: store.profilesRoot,
      }),
      instructionsPath,
    );
    return;
  }

  if (command === "remove" || command === "rm" || command === "delete") {
    const { normalizeProfileId } = require("./hub/profiles/profile-paths");
    const rawName = normalizeHubText(rest.join(" "));
    if (!rawName) {
      throw new Error("用法: mya bots remove <name>");
    }

    const profileId = normalizeProfileId(rawName);
    const profile = store.get(profileId);
    if (!profile) {
      throw new Error(`未找到 bot: ${rawName}`);
    }

    if (!store.remove(profileId)) {
      throw new Error(`移除 bot 失败: ${profileId}`);
    }

    console.log(`已移除 bot ${profile.name || profile.profileId}。`);
    return;
  }

  throw new Error(`未知 bot 命令: ${command}`);
}

async function runHubCommand() {
  const resource = String(process.argv[3] || "").trim().toLowerCase();
  const command = String(process.argv[4] || "").trim().toLowerCase();

  if (!resource || resource === "help" || resource === "--help" || resource === "-h") {
    printHelp();
    return;
  }
  if (resource !== "profiles") {
    if (resource === "tasks") {
      return runHubTasksCommand();
    }
    if (resource === "logs") {
      return runHubLogsCommand();
    }
    if (resource === "start" || resource === "status" || resource === "stop" || resource === "restart") {
      return runHubRuntimeCommand(resource);
    }
    throw new Error(`未知 hub 子命令: ${resource}`);
  }
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const store = getHubProfileStore();

  if (command === "list") {
    printHubProfilesList(store);
    return;
  }
  if (command === "validate") {
    runHubProfilesValidate(store);
    return;
  }

  throw new Error(`未知 hub profiles 命令: ${command}`);
}

async function runHubTasksCommand() {
  const command = String(process.argv[4] || "").trim().toLowerCase();
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const registry = getHubTaskRegistry();

  if (command === "list") {
    const tasks = registry.list();
    if (!tasks.length) {
      console.log("mya tasks 当前为空。");
      return;
    }

    console.log(`mya tasks: ${tasks.length}`);
    for (const task of tasks) {
      console.log(`- ${task.taskId}`);
      console.log(`  profile: ${task.profileId || "(none)"}`);
      console.log(`  trigger: ${task.trigger || "(unknown)"}`);
      console.log(`  state: ${task.state || "(unknown)"}`);
      console.log(`  workspace: ${task.workspaceRoot || "(none)"}`);
      if (task.resumableSessionId) {
        console.log(`  session: ${task.resumableSessionId}`);
      }
      if (task.lastOutputSummary) {
        console.log(`  summary: ${task.lastOutputSummary}`);
      }
    }
    return;
  }

  if (command === "resume") {
    const taskId = normalizeHubText(process.argv[5]);
    if (!taskId) {
      throw new Error("用法: mya connect hub tasks resume <taskId>");
    }

    const task = registry.getResumeTarget(taskId);
    if (!task) {
      throw new Error(`任务不可恢复或不存在: ${taskId}`);
    }

    const { runMyaPrompt } = require("./infra/mya/runner");
    registry.markRunning(task.taskId, {});
    try {
      const output = await runMyaPrompt({
        myaCommand: "mya",
        workspaceRoot: task.workspaceRoot,
        text: "继续当前任务，并给出最新进展。",
        resumeSessionId: task.resumableSessionId,
        permissionMode: "auto",
        enableAutoMode: false,
      });
      registry.markCompleted(task.taskId, {
        lastOutputSummary: output,
      });
      getHubAuditLog().append({
        type: "task_complete",
        profileId: task.profileId,
        actor: "hub",
        taskId: task.taskId,
        detail: "resumed via hub tasks resume",
      });
      console.log(output || "任务已恢复。");
      return;
    } catch (error) {
      registry.markFailed(task.taskId, {
        lastOutputSummary: normalizeHubText(error?.message),
      });
      getHubAuditLog().append({
        type: "task_fail",
        profileId: task.profileId,
        actor: "hub",
        taskId: task.taskId,
        detail: normalizeHubText(error?.message),
      });
      throw error;
    }
  }

  throw new Error(`未知 hub tasks 命令: ${command}`);
}

function runHubLogsCommand() {
  const limitArg = normalizeHubText(process.argv[4]);
  const parsedLimit = Number.parseInt(limitArg, 10);
  const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
  const auditLog = getHubAuditLog();
  const entries = auditLog.list(limit);

  if (!entries.length) {
    console.log("mya logs 当前为空。");
    return;
  }

  console.log(`mya logs: ${entries.length}`);
  for (const entry of entries) {
    const timestamp = normalizeHubText(entry.timestamp) || "(unknown-time)";
    const type = normalizeHubText(entry.type) || "(unknown-type)";
    const profileId = normalizeHubText(entry.profileId) || "(global)";
    const detail = normalizeHubText(entry.detail);
    const suffix = detail ? ` ${detail}` : "";
    console.log(`- ${timestamp} ${profileId} ${type}${suffix}`);
  }
}

async function runHubRuntimeCommand(command) {
  if (command === "start") {
    if (process.env.MYA_CONNECT_SUPERVISOR_CHILD === "1") {
      await runHubSupervisorChildProcess();
      return;
    }

    await startHubSupervisorProcess();
    return;
  }
  if (command === "status") {
    const pid = readHubRuntimePidFile();
    const status = readHubRuntimeStatusFile();

    if (!pid || !status) {
      console.log("mya service 当前未运行。");
      printHubOperatorSummary({ profiles: [] });
      return;
    }

    if (!isHubProcessAlive(pid)) {
      clearHubRuntimeStateFiles();
      console.log("mya service 状态文件已过期，已清理。");
      printHubOperatorSummary({ profiles: [] });
      return;
    }

    if (!isHubStatusHeartbeatFresh(status)) {
      console.log("mya service 进程仍在，但心跳已过期。");
    }

    printPersistedHubRuntimeStatus(status);
    printHubOperatorSummary(status);
    return;
  }
  if (command === "stop") {
    await stopHubSupervisorProcess();
    return;
  }
  if (command === "restart") {
    await stopHubSupervisorProcess({ quietWhenNotRunning: true });
    await startHubSupervisorProcess();
    return;
  }
}

async function stopHubSupervisorProcess({ quietWhenNotRunning = false } = {}) {
  const pid = readHubRuntimePidFile();
  if (!pid) {
    if (!quietWhenNotRunning) {
      console.log("mya service 当前未运行。");
    }
    return false;
  }

  if (!isHubProcessAlive(pid)) {
    clearHubRuntimeStateFiles();
    if (!quietWhenNotRunning) {
      console.log("mya service 状态文件已过期，已清理。");
    }
    return false;
  }

  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (!isHubProcessAlive(pid)) {
      clearHubRuntimeStateFiles();
      console.log(`mya service 已停止 (pid=${pid})。`);
      return true;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(100);
  }

  console.log(`已向 mya service 发送停止信号 (pid=${pid})。`);
  return true;
}

function rewritePublicCommandArgs(args) {
  const [command, subcommand, ...rest] = args;
  const normalizedCommand = normalizeHubText(command).toLowerCase();
  const normalizedSubcommand = normalizeHubText(subcommand).toLowerCase();

  switch (normalizedCommand) {
    case "serve":
      if (!normalizedSubcommand) {
        return ["hub", "start", ...rest];
      }
      if (normalizedSubcommand === "status") {
        return ["hub", "status", ...rest];
      }
      if (normalizedSubcommand === "restart" || normalizedSubcommand === "reload") {
        return ["hub", "restart", ...rest];
      }
      if (normalizedSubcommand === "stop" || normalizedSubcommand === "off" || normalizedSubcommand === "down") {
        return ["hub", "stop", ...rest];
      }
      if (normalizedSubcommand === "logs") {
        return ["hub", "logs", ...rest];
      }
      return args;
    case "wechat":
      if (normalizedSubcommand === "on") {
        return ["wechat", "start", ...rest];
      }
      return args;
    case "feishu":
      if (normalizedSubcommand === "on") {
        return ["feishu", "start", ...rest];
      }
      return args;
    default:
      return args;
  }
}

async function main() {
  const rewrittenArgs = rewritePublicCommandArgs(process.argv.slice(2));
  process.argv = [process.argv[0], process.argv[1], ...rewrittenArgs];

  const channel = String(process.argv[2] || "").trim().toLowerCase();
  const requestedCommand = String(process.argv[3] || "").trim().toLowerCase();
  let wechatMigration = null;

  if (channel === "wechat") {
    wechatMigration = migrateLegacyWechatState(resolveWechatMigrationPaths({
      env: {
        ...readEnvOverrides(channel),
        ...process.env,
      },
    }));
  }

  loadEnv(channel);

  if (!channel || channel === "help" || channel === "--help" || channel === "-h") {
    printHelp();
    return;
  }

  if (channel === "bots") {
    await runBotsCommand();
    return;
  }

  if (channel === "hub") {
    await runHubCommand();
    return;
  }

  if (channel === "wechat") {
    const parsedArgs = parseChannelCommandArguments("wechat", [
      "help",
      "--help",
      "-h",
      "login",
      "start",
      "accounts",
      "migrate",
    ]);
    const config = readWechatConfig(parsedArgs.command || "");
    const command = config.mode || "";

    if (!command || command === "help" || command === "--help" || command === "-h") {
      printHelp();
      return;
    }
    if (command === "migrate") {
      printWechatMigrationSummary(wechatMigration || migrateLegacyWechatState({
        legacyStateDir: config.legacyStateDir,
        targetStateDir: config.stateDir,
      }));
      return;
    }
    if (wechatMigration?.migrated && requestedCommand !== "migrate") {
      printAutomaticWechatMigrationNotice(wechatMigration);
    }
    if (command === "login") {
      await bindWechatLoginToBot(config, parsedArgs.botName);
      return;
    }
    if (command === "accounts") {
      printWechatAccounts(config);
      return;
    }
    if (command === "start") {
      const runtime = new WechatRuntime(config);
      await runtime.start();
      return;
    }
    throw new Error(`未知微信命令: ${command}`);
  }

  if (channel === "feishu") {
    const parsedArgs = parseChannelCommandArguments("feishu", [
      "help",
      "--help",
      "-h",
      "login",
      "check",
      "start",
    ]);
    const config = readFeishuConfig(parsedArgs.command || "");
    const command = config.mode || "";

    if (!command || command === "help" || command === "--help" || command === "-h") {
      printHelp();
      return;
    }
    if (command === "login") {
      await bindFeishuLoginToBot(config, parsedArgs.botName);
      return;
    }
    if (command === "check") {
      await runFeishuCheck(config);
      return;
    }
    if (command === "start") {
      const runtime = new FeishuRuntime(config);
      await runtime.start();
      return;
    }
    throw new Error(`未知飞书命令: ${command}`);
  }

  throw new Error(`未知 channel: ${channel}`);
}

function printAutomaticWechatMigrationNotice(summary) {
  console.log(
    `${getConnectLogPrefix("wechat")} imported legacy state ${summary.legacyStateDir} -> ${summary.targetStateDir}`,
  );
}

function printWechatMigrationSummary(summary) {
  if (!summary || !summary.sourceDetected) {
    console.log("未检测到旧版 mya-wechat 状态，无需迁移。");
    return;
  }

  if (summary.reason === "same-dir") {
    console.log("当前微信状态目录已经指向旧版目录，无需迁移。");
    return;
  }

  if (!summary.migrated) {
    console.log("旧版 mya-wechat 状态已导入或目标目录已有内容，无需重复迁移。");
    console.log(`source: ${summary.legacyStateDir}`);
    console.log(`target: ${summary.targetStateDir}`);
    return;
  }

  console.log("已导入旧版 mya-wechat 微信状态。");
  console.log(`source: ${summary.legacyStateDir}`);
  console.log(`target: ${summary.targetStateDir}`);
  console.log(`accounts: copied=${summary.copiedAccounts} skipped=${summary.skippedAccounts}`);
  console.log(`sync-buf: copied=${summary.copiedSyncBuffers} skipped=${summary.skippedSyncBuffers}`);
  console.log(`sessions.json: ${summary.copiedSessionsFile ? "copied" : "kept"}`);
  console.log(`.env: ${summary.copiedEnvFile ? "copied" : "kept"}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${getConnectLogPrefix()} ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildHelpText,
  buildHubSupervisorSpawnSpec,
  buildHubSupervisorStatusSnapshot,
  createManagedChannelRuntime,
  createHubTaskDispatchBridge,
  isHubStatusHeartbeatFresh,
  main,
  runInteractiveBotsSelector,
  runHubSupervisorMaintenanceTick,
};
