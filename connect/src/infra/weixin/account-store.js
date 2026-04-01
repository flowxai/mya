const fs = require("fs");
const path = require("path");
const {
  getConnectCommandName,
  getConnectLogPrefix,
} = require("../../shared/branding");

function normalizeAccountId(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function ensureAccountsDir(config) {
  fs.mkdirSync(config.accountsDir, { recursive: true });
}

function resolveAccountPath(config, accountId) {
  return path.join(config.accountsDir, `${normalizeAccountId(accountId)}.json`);
}

function deleteWeixinAccount(config, accountId) {
  const normalizedAccountId = normalizeAccountId(accountId);
  if (!normalizedAccountId) {
    return false;
  }

  try {
    const filePath = resolveAccountPath(config, normalizedAccountId);
    if (!fs.existsSync(filePath)) {
      return false;
    }
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function saveWeixinAccount(config, rawAccountId, update) {
  ensureAccountsDir(config);
  const accountId = normalizeAccountId(rawAccountId);
  const filePath = resolveAccountPath(config, accountId);
  const existing = loadWeixinAccount(config, accountId) || {};
  const next = {
    accountId,
    rawAccountId: String(rawAccountId || "").trim() || existing.rawAccountId || "",
    token: typeof update.token === "string" && update.token.trim() ? update.token.trim() : existing.token || "",
    baseUrl: typeof update.baseUrl === "string" && update.baseUrl.trim() ? update.baseUrl.trim() : existing.baseUrl || config.baseUrl,
    userId: typeof update.userId === "string" ? update.userId.trim() : existing.userId || "",
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best effort
  }
  return next;
}

function loadWeixinAccount(config, accountId) {
  const normalizedAccountId = normalizeAccountId(accountId);
  if (!normalizedAccountId) {
    return null;
  }

  try {
    const raw = fs.readFileSync(resolveAccountPath(config, normalizedAccountId), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      accountId: normalizedAccountId,
      rawAccountId: typeof parsed.rawAccountId === "string" ? parsed.rawAccountId : "",
      token: typeof parsed.token === "string" ? parsed.token : "",
      baseUrl: typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : config.baseUrl,
      userId: typeof parsed.userId === "string" ? parsed.userId : "",
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    };
  } catch {
    return null;
  }
}

function listWeixinAccounts(config) {
  ensureAccountsDir(config);
  const files = fs.readdirSync(config.accountsDir, { withFileTypes: true });
  return files
    .filter((entry) => (
      entry.isFile()
      && entry.name.endsWith(".json")
      && !entry.name.endsWith(".context-tokens.json")
    ))
    .map((entry) => loadWeixinAccount(config, entry.name.slice(0, -5)))
    .filter(Boolean)
    .sort((left, right) => String(right.savedAt || "").localeCompare(String(left.savedAt || "")));
}

function resolveSelectedAccount(config) {
  if (config.accountId) {
    const account = loadWeixinAccount(config, config.accountId);
    if (!account) {
      throw new Error(`未找到微信账号: ${config.accountId}`);
    }
    if (!account.token) {
      throw new Error(`微信账号缺少 token: ${account.accountId}，请重新执行 login`);
    }
    return account;
  }

  const accounts = listWeixinAccounts(config);
  if (!accounts.length) {
    throw new Error(`当前没有已保存的微信账号，请先执行 \`${getConnectCommandName()} wechat login\``);
  }
  if (accounts.length > 1) {
    if (config.autoSelectLatestAccount !== false && shouldAutoSelectLatestAccount(accounts)) {
      ensureAccountHasToken(accounts[0]);
      console.warn(
        `${getConnectLogPrefix("wechat")} 检测到多个微信账号，默认使用最近登录的账号 ${accounts[0].accountId}。`
        + " 如需固定账号，请设置 MYA_CONNECT_WECHAT_ACCOUNT_ID。",
      );
      return accounts[0];
    }
    const accountIds = accounts.map((account) => account.accountId).join(", ");
    throw new Error(`检测到多个微信账号，请设置 MYA_CONNECT_WECHAT_ACCOUNT_ID。可选值: ${accountIds}`);
  }
  return ensureAccountHasToken(accounts[0]);
}

function ensureAccountHasToken(account) {
  if (!account.token) {
    throw new Error(`微信账号缺少 token: ${account.accountId}，请重新执行 login`);
  }
  return account;
}

function shouldAutoSelectLatestAccount(accounts) {
  const userIds = new Set(
    accounts
      .map((account) => (typeof account.userId === "string" ? account.userId.trim() : ""))
      .filter(Boolean),
  );
  return userIds.size <= 1;
}

module.exports = {
  deleteWeixinAccount,
  listWeixinAccounts,
  loadWeixinAccount,
  normalizeAccountId,
  resolveAccountPath,
  resolveSelectedAccount,
  saveWeixinAccount,
  shouldAutoSelectLatestAccount,
};
