const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

const CONFIG_PATH = "../src/infra/config/config";

function withEnv(nextEnv, fn) {
  const originalArgv = process.argv.slice();
  const keys = Object.keys(nextEnv);
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  Object.assign(process.env, nextEnv);
  process.argv = ["node", "mya-wechat", "start"];

  try {
    fn();
  } finally {
    process.argv = originalArgv;
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("readConfig uses mya-wechat defaults", () => {
  delete require.cache[require.resolve(CONFIG_PATH)];
  const { readConfig } = require(CONFIG_PATH);

  withEnv(
    {
      MYA_WECHAT_STATE_DIR: "",
      MYA_WECHAT_DEFAULT_WORKSPACE: "",
      MYA_WECHAT_MYA_COMMAND: "",
      MYA_WECHAT_ENABLE_AUTO_MODE: "",
      MYA_WECHAT_PERMISSION_MODE: "",
    },
    () => {
      const config = readConfig();
      assert.equal(config.mode, "start");
      assert.equal(config.stateDir, path.join(os.homedir(), ".mya-wechat"));
      assert.equal(config.myaCommand, "mya");
      assert.equal(config.enableAutoMode, false);
      assert.equal(config.permissionMode, "dontAsk");
      assert.equal(config.preserveExistingAccounts, true);
      assert.equal(config.autoSelectLatestAccount, true);
      assert.equal(config.qrBotType, "3");
    },
  );
});

test("readConfig honors MYA_WECHAT environment overrides", () => {
  delete require.cache[require.resolve(CONFIG_PATH)];
  const { readConfig } = require(CONFIG_PATH);

  withEnv(
    {
      MYA_WECHAT_STATE_DIR: "/tmp/mya-wechat",
      MYA_WECHAT_DEFAULT_WORKSPACE: "/tmp/project",
      MYA_WECHAT_ALLOWED_USER_IDS: "u1,u2",
      MYA_WECHAT_MYA_COMMAND: "/usr/local/bin/mya",
      MYA_WECHAT_ENABLE_AUTO_MODE: "false",
      MYA_WECHAT_PERMISSION_MODE: "default",
      MYA_WECHAT_PRESERVE_EXISTING_ACCOUNTS: "false",
      MYA_WECHAT_AUTO_SELECT_LATEST_ACCOUNT: "no",
      MYA_WECHAT_QR_BOT_TYPE: "8",
    },
    () => {
      const config = readConfig();
      assert.equal(config.stateDir, "/tmp/mya-wechat");
      assert.equal(config.defaultWorkspaceRoot, "/tmp/project");
      assert.deepEqual(config.allowedUserIds, ["u1", "u2"]);
      assert.equal(config.myaCommand, "/usr/local/bin/mya");
      assert.equal(config.enableAutoMode, false);
      assert.equal(config.permissionMode, "default");
      assert.equal(config.preserveExistingAccounts, false);
      assert.equal(config.autoSelectLatestAccount, false);
      assert.equal(config.qrBotType, "8");
    },
  );
});
