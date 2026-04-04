const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WECHAT_CONFIG_PATH = "../src/channels/wechat/config";
const FEISHU_CONFIG_PATH = "../src/channels/feishu/config";

function withEnv(nextEnv, fn) {
  const originalArgv = process.argv.slice();
  const keys = Object.keys(nextEnv);
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  Object.assign(process.env, nextEnv);
  process.argv = ["node", "mya-connect", "channel", "start"];

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

function createIsolatedHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-config-home-"));
}

function writeSettings(homeDir, settings) {
  const targetDir = path.join(homeDir, ".mya");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "settings.json"), JSON.stringify(settings, null, 2));
}

test("readWechatConfig uses mya defaults", () => {
  delete require.cache[require.resolve(WECHAT_CONFIG_PATH)];
  const { readWechatConfig } = require(WECHAT_CONFIG_PATH);

  withEnv(
    {
      HOME: createIsolatedHome(),
      MYA_CONNECT_WECHAT_STATE_DIR: "",
      MYA_CONNECT_WECHAT_DEFAULT_WORKSPACE: "",
      MYA_CONNECT_WECHAT_MYA_COMMAND: "",
      MYA_CONNECT_WECHAT_ENABLE_AUTO_MODE: "",
      MYA_CONNECT_WECHAT_PERMISSION_MODE: "",
      MYA_WECHAT_STATE_DIR: "",
      MYA_WECHAT_MYA_COMMAND: "",
    },
    () => {
      const config = readWechatConfig("start");
      assert.equal(config.mode, "start");
      assert.equal(config.stateDir, path.join(os.homedir(), ".mya", "connect", "wechat"));
      assert.equal(config.myaCommand, "mya");
      assert.equal(config.enableAutoMode, false);
      assert.equal(config.permissionMode, "dontAsk");
      assert.equal(config.qrBotType, "3");
    }
  );
});

test("readWechatConfig honors MYA_CONNECT_WECHAT environment overrides", () => {
  delete require.cache[require.resolve(WECHAT_CONFIG_PATH)];
  const { readWechatConfig } = require(WECHAT_CONFIG_PATH);

  withEnv(
    {
      HOME: createIsolatedHome(),
      MYA_CONNECT_WECHAT_STATE_DIR: "/tmp/mya-connect-wechat",
      MYA_CONNECT_WECHAT_DEFAULT_WORKSPACE: "/tmp/project",
      MYA_CONNECT_WECHAT_ALLOWED_USER_IDS: "u1,u2",
      MYA_CONNECT_WECHAT_MYA_COMMAND: "/usr/local/bin/mya",
      MYA_CONNECT_WECHAT_ENABLE_AUTO_MODE: "true",
      MYA_CONNECT_WECHAT_PERMISSION_MODE: "default",
      MYA_CONNECT_WECHAT_QR_BOT_TYPE: "3",
    },
    () => {
      const config = readWechatConfig("start");
      assert.equal(config.stateDir, "/tmp/mya-connect-wechat");
      assert.equal(config.defaultWorkspaceRoot, "/tmp/project");
      assert.deepEqual(config.allowedUserIds, ["u1", "u2"]);
      assert.equal(config.myaCommand, "/usr/local/bin/mya");
      assert.equal(config.enableAutoMode, true);
      assert.equal(config.permissionMode, "default");
      assert.equal(config.qrBotType, "3");
    }
  );
});

test("readFeishuConfig uses defaults", () => {
  delete require.cache[require.resolve(FEISHU_CONFIG_PATH)];
  const { readFeishuConfig } = require(FEISHU_CONFIG_PATH);

  withEnv(
    {
      HOME: createIsolatedHome(),
      MYA_CONNECT_FEISHU_STATE_DIR: "",
      MYA_CONNECT_FEISHU_APP_ID: "",
      MYA_CONNECT_FEISHU_APP_SECRET: "",
      MYA_CONNECT_FEISHU_MYA_COMMAND: "",
      MYA_CONNECT_FEISHU_ENABLE_AUTO_MODE: "",
      MYA_CONNECT_FEISHU_PERMISSION_MODE: "",
    },
    () => {
      const config = readFeishuConfig("start");
      assert.equal(config.mode, "start");
      assert.equal(config.stateDir, path.join(os.homedir(), ".mya", "connect", "feishu"));
      assert.equal(config.myaCommand, "mya");
      assert.equal(config.enableAutoMode, false);
      assert.equal(config.permissionMode, "dontAsk");
      assert.equal(config.enableGroupAtMessages, true);
      assert.equal(config.replyInThread, false);
    }
  );
});

test("readFeishuConfig honors explicit overrides", () => {
  delete require.cache[require.resolve(FEISHU_CONFIG_PATH)];
  const { readFeishuConfig } = require(FEISHU_CONFIG_PATH);

  withEnv(
    {
      HOME: createIsolatedHome(),
      MYA_CONNECT_FEISHU_STATE_DIR: "/tmp/mya-connect-feishu",
      MYA_CONNECT_FEISHU_APP_ID: "cli_test",
      MYA_CONNECT_FEISHU_APP_SECRET: "secret_test",
      MYA_CONNECT_FEISHU_DEFAULT_WORKSPACE: "/tmp/project",
      MYA_CONNECT_FEISHU_ALLOWED_OPEN_IDS: "ou_a,ou_b",
      MYA_CONNECT_FEISHU_MYA_COMMAND: "/usr/local/bin/mya",
      MYA_CONNECT_FEISHU_ENABLE_AUTO_MODE: "true",
      MYA_CONNECT_FEISHU_ENABLE_GROUP_AT: "false",
      MYA_CONNECT_FEISHU_REPLY_IN_THREAD: "yes",
      MYA_CONNECT_FEISHU_PERMISSION_MODE: "default",
    },
    () => {
      const config = readFeishuConfig("check");
      assert.equal(config.mode, "check");
      assert.equal(config.stateDir, "/tmp/mya-connect-feishu");
      assert.equal(config.appId, "cli_test");
      assert.equal(config.appSecret, "secret_test");
      assert.equal(config.defaultWorkspaceRoot, "/tmp/project");
      assert.deepEqual(config.allowedOpenIds, ["ou_a", "ou_b"]);
      assert.equal(config.myaCommand, "/usr/local/bin/mya");
      assert.equal(config.enableAutoMode, true);
      assert.equal(config.enableGroupAtMessages, false);
      assert.equal(config.replyInThread, true);
      assert.equal(config.permissionMode, "default");
    }
  );
});

test("readWechatConfig inherits the global default model from settings when no channel override exists", () => {
  const homeDir = createIsolatedHome();
  writeSettings(homeDir, {
    env: {
      ANTHROPIC_MODEL: "kimi-k2.5",
    },
  });

  delete require.cache[require.resolve(WECHAT_CONFIG_PATH)];
  const { readWechatConfig } = require(WECHAT_CONFIG_PATH);

  withEnv(
    {
      HOME: homeDir,
      MYA_CONNECT_WECHAT_DEFAULT_MODEL: "",
      MYA_WECHAT_DEFAULT_MODEL: "",
    },
    () => {
      const config = readWechatConfig("start");
      assert.equal(config.defaultModel, "kimi-k2.5");
    }
  );
});

test("readFeishuConfig inherits the global default model from settings when no channel override exists", () => {
  const homeDir = createIsolatedHome();
  writeSettings(homeDir, {
    env: {
      ANTHROPIC_MODEL: "kimi-k2.5",
    },
  });

  delete require.cache[require.resolve(FEISHU_CONFIG_PATH)];
  const { readFeishuConfig } = require(FEISHU_CONFIG_PATH);

  withEnv(
    {
      HOME: homeDir,
      MYA_CONNECT_FEISHU_DEFAULT_MODEL: "",
    },
    () => {
      const config = readFeishuConfig("start");
      assert.equal(config.defaultModel, "kimi-k2.5");
    }
  );
});
