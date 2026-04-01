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
