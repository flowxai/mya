const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { HubProfileStore } = require("../src/hub/profiles/profile-store");
const { resolveProfilePath } = require("../src/hub/profiles/profile-paths");

function createStore() {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-hub-profiles-"));
  return {
    homeDir,
    store: new HubProfileStore({ homeDir }),
  };
}

test("HubProfileStore saves profiles under the hub profiles directory and loads them by id", () => {
  const { homeDir, store } = createStore();

  const saved = store.save({
    profileId: " Team Alpha ",
    name: "Alpha",
    channels: [{ type: "wechat", accountId: "wx-main" }],
  });

  const filePath = resolveProfilePath("Team Alpha", { homeDir });
  assert.equal(
    filePath,
    path.join(homeDir, ".mya", "connect", "hub", "profiles", "team-alpha", "profile.json"),
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), saved);
  const loaded = {
    ...saved,
    wakePolicy: {
      schedules: [],
      events: [],
    },
  };
  assert.deepEqual(store.get("TEAM alpha"), loaded);

  fs.rmSync(homeDir, { recursive: true, force: true });
});

test("HubProfileStore lists saved profiles in profileId order and skips malformed entries", () => {
  const { homeDir, store } = createStore();

  store.save({ profileId: "z-last", name: "Last", channels: [{ type: "wechat", accountId: "wx-z" }] });
  store.save({ profileId: "a-first", name: "First", channels: [{ type: "feishu", appId: "fs-a" }] });

  const malformedDir = path.join(homeDir, ".mya", "connect", "hub", "profiles", "broken");
  fs.mkdirSync(malformedDir, { recursive: true });
  fs.writeFileSync(path.join(malformedDir, "profile.json"), JSON.stringify({ profileId: [] }), "utf8");

  assert.deepEqual(
    store.list().map((profile) => profile.profileId),
    ["a-first", "z-last"],
  );

  fs.rmSync(homeDir, { recursive: true, force: true });
});

test("HubProfileStore removes persisted profiles and reports missing profiles", () => {
  const { homeDir, store } = createStore();

  store.save({ profileId: "remove-me", name: "Remove Me", channels: [{ type: "wechat", accountId: "wx-remove" }] });

  assert.equal(store.remove("remove-me"), true);
  assert.equal(store.get("remove-me"), null);
  assert.equal(store.remove("remove-me"), false);

  fs.rmSync(homeDir, { recursive: true, force: true });
});

test("HubProfileStore rejects profiles without a valid profileId", () => {
  const { homeDir, store } = createStore();

  assert.throws(
    () => store.save({ name: "Missing Id" }),
    /profileId/,
  );

  fs.rmSync(homeDir, { recursive: true, force: true });
});
