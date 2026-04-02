const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SETTINGS_PATH = "../src/shared/settings";

test("connector settings resolve permission mode from ~/.mya/settings.json env alias", { concurrency: false }, () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-settings-home-"));
  const configDir = path.join(homeDir, ".mya");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "settings.json"),
    JSON.stringify({
      env: {
        MYA_DEFAULT_PERMISSION_MODE: "dangerously-skip-permissions",
      },
    }, null, 2),
    "utf8",
  );

  const originalHome = process.env.HOME;
  delete require.cache[require.resolve(SETTINGS_PATH)];
  process.env.HOME = homeDir;

  try {
    const { resolveConnectPermissionMode } = require(SETTINGS_PATH);
    assert.equal(resolveConnectPermissionMode({ fallback: "dontAsk" }), "bypassPermissions");
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    delete require.cache[require.resolve(SETTINGS_PATH)];
  }
});

test("connector settings prefer explicit channel/profile permission mode over global settings", { concurrency: false }, () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-settings-home-"));
  const configDir = path.join(homeDir, ".mya");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "settings.json"),
    JSON.stringify({
      permissions: {
        defaultMode: "plan",
      },
    }, null, 2),
    "utf8",
  );

  const originalHome = process.env.HOME;
  delete require.cache[require.resolve(SETTINGS_PATH)];
  process.env.HOME = homeDir;

  try {
    const { resolveConnectPermissionMode } = require(SETTINGS_PATH);
    assert.equal(
      resolveConnectPermissionMode({
        explicitValues: ["dangerously-skip-permissions"],
        fallback: "dontAsk",
      }),
      "bypassPermissions",
    );
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    delete require.cache[require.resolve(SETTINGS_PATH)];
  }
});
