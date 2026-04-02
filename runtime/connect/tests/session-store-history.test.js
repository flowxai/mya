const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SessionStore } = require("../src/infra/storage/session-store");

test("SessionStore persists recent conversation entries per workspace", () => {
  const filePath = path.join(os.tmpdir(), `mya-connect-session-store-${Date.now()}-${Math.random()}.json`);
  const store = new SessionStore({ filePath });

  store.appendRecentConversationEntry("binding-1", "/tmp/project-a", {
    role: "user",
    text: "你好",
  });
  store.appendRecentConversationEntry("binding-1", "/tmp/project-a", {
    role: "assistant",
    text: "你好！",
  });
  store.appendRecentConversationEntry("binding-1", "/tmp/project-b", {
    role: "user",
    text: "另一个项目",
  });

  assert.deepEqual(
    store.getRecentConversationEntries("binding-1", "/tmp/project-a"),
    [
      {
        role: "user",
        text: "你好",
      },
      {
        role: "assistant",
        text: "你好！",
      },
    ],
  );
  assert.deepEqual(
    store.getRecentConversationEntries("binding-1", "/tmp/project-b"),
    [
      {
        role: "user",
        text: "另一个项目",
      },
    ],
  );

  fs.rmSync(filePath, { force: true });
});

test("SessionStore caps recent conversation entries and removes them with the workspace", () => {
  const filePath = path.join(os.tmpdir(), `mya-connect-session-store-${Date.now()}-${Math.random()}.json`);
  const store = new SessionStore({ filePath });

  for (let index = 0; index < 16; index += 1) {
    store.appendRecentConversationEntry("binding-2", "/tmp/project", {
      role: index % 2 === 0 ? "user" : "assistant",
      text: `message-${index}`,
    });
  }

  const entries = store.getRecentConversationEntries("binding-2", "/tmp/project");
  assert.equal(entries.length, 12);
  assert.equal(entries[0].text, "message-4");
  assert.equal(entries.at(-1).text, "message-15");

  store.removeWorkspace("binding-2", "/tmp/project");
  assert.deepEqual(store.getRecentConversationEntries("binding-2", "/tmp/project"), []);

  fs.rmSync(filePath, { force: true });
});

test("SessionStore buildBindingKey isolates hub profiles while preserving legacy non-profile keys", () => {
  const filePath = path.join(os.tmpdir(), `mya-connect-session-store-${Date.now()}-${Math.random()}.json`);
  const store = new SessionStore({ filePath });

  const legacyKey = store.buildBindingKey({
    workspaceId: "default",
    accountId: "feishu-app-a",
    senderId: "user:alice",
  });
  const reviewKey = store.buildBindingKey({
    workspaceId: "default",
    accountId: "feishu-app-a",
    senderId: "user:alice",
    profileId: "review-bot",
  });
  const opsKey = store.buildBindingKey({
    workspaceId: "default",
    accountId: "feishu-app-a",
    senderId: "user:alice",
    profileId: "ops-bot",
  });

  assert.equal(legacyKey, "default:feishu-app-a:user:alice");
  assert.equal(reviewKey, "review-bot:default:feishu-app-a:user:alice");
  assert.equal(opsKey, "ops-bot:default:feishu-app-a:user:alice");
  assert.notEqual(reviewKey, opsKey);

  fs.rmSync(filePath, { force: true });
});

test("SessionStore scopes remembered approval prefixes by profile, channel, account, sender and workspace", () => {
  const filePath = path.join(os.tmpdir(), `mya-connect-session-store-${Date.now()}-${Math.random()}.json`);
  const store = new SessionStore({ filePath });
  const reviewScope = {
    profileId: "review-bot",
    channelType: "feishu",
    accountId: "review-app",
    senderId: "user:alice",
    workspaceRoot: "/tmp/project",
  };
  const opsScope = {
    profileId: "ops-bot",
    channelType: "feishu",
    accountId: "ops-app",
    senderId: "user:alice",
    workspaceRoot: "/tmp/project",
  };

  store.rememberApprovalCommandPrefix(reviewScope, ["npm", "test"]);

  assert.deepEqual(store.getApprovalCommandAllowlist(reviewScope), [["npm", "test"]]);
  assert.deepEqual(store.getApprovalCommandAllowlist(opsScope), []);

  fs.rmSync(filePath, { force: true });
});
