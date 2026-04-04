const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SessionStore } = require("../src/infra/storage/session-store");

test("SessionStore persists codex params with source metadata", () => {
  const filePath = path.join(os.tmpdir(), `mya-connect-session-store-${Date.now()}-${Math.random()}.json`);
  const store = new SessionStore({ filePath });

  store.setCodexParamsForWorkspace("binding-1", "/tmp/project", {
    model: "sonnet",
    effort: "high",
    source: "user",
  });

  assert.deepEqual(
    store.getCodexParamsForWorkspace("binding-1", "/tmp/project"),
    {
      model: "sonnet",
      effort: "high",
      source: "user",
    },
  );

  fs.rmSync(filePath, { force: true });
});
