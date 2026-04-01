const fs = require("fs");
const os = require("os");
const path = require("path");
const dotenv = require("dotenv");

const { readWechatConfig } = require("./channels/wechat/config");
const { readFeishuConfig } = require("./channels/feishu/config");
const { WechatRuntime } = require("./app/wechat-runtime");
const { FeishuRuntime } = require("./app/feishu-runtime");
const {
  migrateLegacyWechatState,
  resolveWechatMigrationPaths,
} = require("./infra/config/wechat-migration");
const { runLoginFlow } = require("./infra/weixin/login");
const { listWeixinAccounts } = require("./infra/weixin/account-store");
const {
  getConnectCommandName,
  getConnectLogPrefix,
} = require("./shared/branding");

function ensureDefaultConfigDirectory() {
  fs.mkdirSync(path.join(os.homedir(), ".mya-connect"), { recursive: true });
}

function getEnvCandidates(channel) {
  return [
    path.join(process.cwd(), ".env"),
    path.join(os.homedir(), ".mya-connect", ".env"),
    path.join(os.homedir(), ".mya-connect", channel || "", ".env"),
    channel === "wechat" ? path.join(os.homedir(), ".mya-wechat", ".env") : "",
  ];
}

function loadEnv(channel) {
  ensureDefaultConfigDirectory();

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
  const commandName = getConnectCommandName();
  return `
用法: ${commandName} <channel> <command>

channels:
  wechat     微信扫码桥接
  feishu     飞书自建应用桥接

wechat commands:
  ${commandName} wechat login
  ${commandName} wechat start
  ${commandName} wechat accounts
  ${commandName} wechat migrate

feishu commands:
  ${commandName} feishu check
  ${commandName} feishu start
`;
}

function printHelp() {
  console.log(buildHelpText());
}

function printWechatAccounts(config) {
  const accounts = listWeixinAccounts(config);
  if (!accounts.length) {
    console.log(`当前没有已保存的微信账号。先执行 \`${getConnectCommandName()} wechat login\`。`);
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

async function main() {
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

  if (channel === "wechat") {
    const config = readWechatConfig(process.argv[3] || "");
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
      await runLoginFlow(config);
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
    const config = readFeishuConfig(process.argv[3] || "");
    const command = config.mode || "";

    if (!command || command === "help" || command === "--help" || command === "-h") {
      printHelp();
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

module.exports = {
  buildHelpText,
  main,
};
