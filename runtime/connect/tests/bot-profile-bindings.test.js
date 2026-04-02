const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { HubProfileStore } = require("../src/hub/profiles/profile-store");
const {
  DEFAULT_BOT_NAME,
  bindFeishuChannel,
  bindWechatChannel,
  ensureBotProfile,
} = require("../src/hub/profiles/bot-profile");
const { buildMyaStreamInvocation } = require("../src/infra/mya/stream-turn");

function createStore() {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-bot-profile-"));
  return {
    homeDir,
    store: new HubProfileStore({ homeDir }),
  };
}

test("ensureBotProfile creates a default bot when omitted", () => {
  const { homeDir, store } = createStore();

  const result = ensureBotProfile(store, {
    workspaceRoot: "/tmp/workspace",
  });

  assert.equal(result.created, true);
  assert.equal(result.profile.profileId, DEFAULT_BOT_NAME);
  assert.equal(result.profile.name, DEFAULT_BOT_NAME);
  assert.equal(result.profile.defaultWorkspaceRoot, "/tmp/workspace");

  fs.rmSync(homeDir, { recursive: true, force: true });
});

test("ensureBotProfile inherits the global bypass permission mode for new bots", () => {
  const { homeDir, store } = createStore();

  const result = ensureBotProfile(store, {
    name: "review-bot",
    workspaceRoot: "/tmp/workspace",
    settings: {
      permissions: {
        defaultMode: "bypassPermissions",
      },
    },
  });

  assert.equal(result.profile.permissionMode, "bypassPermissions");

  fs.rmSync(homeDir, { recursive: true, force: true });
});

test("bindWechatChannel keeps exactly one active wechat bot", () => {
  const { homeDir, store } = createStore();

  store.save({
    profileId: "alpha",
    name: "Alpha",
    defaultWorkspaceRoot: "/tmp/a",
    workspaceAllowlist: ["/tmp/a"],
    channels: [{ type: "wechat", accountId: "wx-alpha" }],
  });
  store.save({
    profileId: "beta",
    name: "Beta",
    defaultWorkspaceRoot: "/tmp/b",
    workspaceAllowlist: ["/tmp/b"],
    channels: [],
  });

  const result = bindWechatChannel(store, "beta", {
    accountId: "wx-beta",
  });

  assert.deepEqual(result.reassignedFrom, ["alpha"]);
  assert.equal(store.get("alpha").channels.length, 0);
  assert.deepEqual(store.get("beta").channels, [{
    type: "wechat",
    accountId: "wx-beta",
    defaultWorkspaceRoot: "/tmp/b",
    permissionMode: "",
  }]);

  fs.rmSync(homeDir, { recursive: true, force: true });
});

test("bindFeishuChannel overwrites the target bot and reassigns duplicate app ids", () => {
  const { homeDir, store } = createStore();

  store.save({
    profileId: "review",
    name: "Review",
    defaultWorkspaceRoot: "/tmp/review",
    workspaceAllowlist: ["/tmp/review"],
    channels: [{ type: "feishu", appId: "app-a", appSecret: "old-secret" }],
  });
  store.save({
    profileId: "ops",
    name: "Ops",
    defaultWorkspaceRoot: "/tmp/ops",
    workspaceAllowlist: ["/tmp/ops"],
    channels: [{ type: "feishu", appId: "app-b", appSecret: "ops-secret" }],
  });

  const result = bindFeishuChannel(store, "ops", {
    appId: "app-a",
    appSecret: "new-secret",
  });

  assert.equal(result.replacedExisting, true);
  assert.deepEqual(result.reassignedFrom, ["review"]);
  assert.deepEqual(store.get("review").channels, []);
  assert.deepEqual(store.get("ops").channels, [{
    type: "feishu",
    appId: "app-a",
    appSecret: "new-secret",
    defaultWorkspaceRoot: "/tmp/ops",
    permissionMode: "",
  }]);

  fs.rmSync(homeDir, { recursive: true, force: true });
});

test("buildMyaStreamInvocation forwards bot-level API overrides", () => {
  const invocation = buildMyaStreamInvocation({
    myaCommand: "mya",
    workspaceRoot: "/tmp/project",
    profileId: "review-bot",
    profile: {
      profileId: "review-bot",
      defaultModel: "sonnet",
      baseUrl: "https://proxy.example.com",
      apiKey: "sk-test",
      authToken: "auth-test",
    },
  });

  assert.equal(invocation.env.ANTHROPIC_BASE_URL, "https://proxy.example.com");
  assert.equal(invocation.env.ANTHROPIC_API_KEY, "sk-test");
  assert.equal(invocation.env.ANTHROPIC_AUTH_TOKEN, "auth-test");
});
