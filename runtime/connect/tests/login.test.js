const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  saveWeixinAccount,
  loadWeixinAccount,
} = require("../src/infra/weixin/account-store");
const { resolveContextTokenPath } = require("../src/infra/weixin/context-token-store");
const { cleanupStaleAccountsForUserId } = require("../src/infra/weixin/login");
const { resolveSyncBufferPath } = require("../src/infra/weixin/sync-buffer-store");

function createConfig(overrides = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-wechat-login-"));
  return {
    baseUrl: "https://ilinkai.weixin.qq.com",
    accountsDir: path.join(stateDir, "accounts"),
    syncBufferDir: path.join(stateDir, "sync-buf"),
    preserveExistingAccounts: true,
    ...overrides,
  };
}

function seedAccountArtifacts(config, accountId, userId) {
  const account = saveWeixinAccount(config, accountId, {
    token: `${accountId}-token`,
    userId,
  });
  fs.mkdirSync(path.dirname(resolveSyncBufferPath(config, accountId)), { recursive: true });
  fs.writeFileSync(resolveSyncBufferPath(config, accountId), "buffer", "utf8");
  fs.writeFileSync(resolveContextTokenPath(config, accountId), JSON.stringify({ [userId]: "ctx" }), "utf8");
  return account;
}

test("cleanupStaleAccountsForUserId keeps prior same-user accounts by default", () => {
  const config = createConfig({ preserveExistingAccounts: true });
  seedAccountArtifacts(config, "older", "wx-user-1");
  const activeAccount = seedAccountArtifacts(config, "latest", "wx-user-1");

  const removed = cleanupStaleAccountsForUserId(config, activeAccount);

  assert.deepEqual(removed, []);
  assert.ok(loadWeixinAccount(config, "older"));
  assert.ok(fs.existsSync(resolveSyncBufferPath(config, "older")));
  assert.ok(fs.existsSync(resolveContextTokenPath(config, "older")));
});

test("cleanupStaleAccountsForUserId can delete prior same-user accounts when explicitly enabled", () => {
  const config = createConfig({ preserveExistingAccounts: false });
  seedAccountArtifacts(config, "older", "wx-user-1");
  const activeAccount = seedAccountArtifacts(config, "latest", "wx-user-1");

  const removed = cleanupStaleAccountsForUserId(config, activeAccount);

  assert.equal(removed.length, 1);
  assert.equal(removed[0].accountId, "older");
  assert.equal(loadWeixinAccount(config, "older"), null);
  assert.equal(fs.existsSync(resolveSyncBufferPath(config, "older")), false);
  assert.equal(fs.existsSync(resolveContextTokenPath(config, "older")), false);
});
