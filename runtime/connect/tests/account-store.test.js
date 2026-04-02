const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  resolveAccountPath,
  resolveSelectedAccount,
  saveWeixinAccount,
} = require("../src/infra/weixin/account-store");

function createConfig(overrides = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-wechat-account-store-"));
  return {
    baseUrl: "https://ilinkai.weixin.qq.com",
    accountId: "",
    accountsDir: path.join(stateDir, "accounts"),
    autoSelectLatestAccount: true,
    ...overrides,
  };
}

function overwriteSavedAt(config, accountId, savedAt) {
  const filePath = resolveAccountPath(config, accountId);
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  parsed.savedAt = savedAt;
  fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), "utf8");
}

test("resolveSelectedAccount chooses latest saved account when multiple accounts exist", () => {
  const config = createConfig();

  saveWeixinAccount(config, "older", {
    token: "token-older",
    userId: "wx-user-1",
  });
  saveWeixinAccount(config, "latest", {
    token: "token-latest",
    userId: "wx-user-1",
  });

  overwriteSavedAt(config, "older", "2026-04-01T10:00:00.000Z");
  overwriteSavedAt(config, "latest", "2026-04-01T10:05:00.000Z");

  const selected = resolveSelectedAccount(config);
  assert.equal(selected.accountId, "latest");
  assert.equal(selected.token, "token-latest");
});

test("resolveSelectedAccount stays strict when autoSelectLatestAccount is disabled", () => {
  const config = createConfig({ autoSelectLatestAccount: false });

  saveWeixinAccount(config, "first", {
    token: "token-first",
    userId: "wx-user-1",
  });
  saveWeixinAccount(config, "second", {
    token: "token-second",
    userId: "wx-user-2",
  });

  assert.throws(
    () => resolveSelectedAccount(config),
    /检测到多个微信账号，请设置 MYA_CONNECT_WECHAT_ACCOUNT_ID/,
  );
});
