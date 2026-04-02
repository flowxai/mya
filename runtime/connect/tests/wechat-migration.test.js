const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { migrateLegacyWechatState } = require("../src/infra/config/wechat-migration");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

test("migrateLegacyWechatState copies legacy WeChat state and rewrites env keys", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-migrate-"));
  const legacyStateDir = path.join(homeDir, ".mya-wechat");
  const targetStateDir = path.join(homeDir, ".mya-connect", "wechat");

  writeJson(path.join(legacyStateDir, "accounts", "legacy-user.json"), {
    accountId: "legacy-user",
    token: "token-1",
    savedAt: "2026-04-01T12:00:00.000Z",
  });
  writeJson(path.join(legacyStateDir, "sessions.json"), {
    bindings: {
      "wx:user": {
        activeWorkspaceRoot: "/tmp/project",
      },
    },
  });
  fs.mkdirSync(path.join(legacyStateDir, "sync-buf"), { recursive: true });
  fs.writeFileSync(path.join(legacyStateDir, "sync-buf", "legacy-user.txt"), "buffer-1", "utf8");
  fs.writeFileSync(
    path.join(legacyStateDir, ".env"),
    [
      "# legacy wechat config",
      "MYA_WECHAT_ACCOUNT_ID=legacy-user",
      `MYA_WECHAT_STATE_DIR=${legacyStateDir}`,
      `MYA_WECHAT_SESSIONS_FILE=${path.join(legacyStateDir, "sessions.json")}`,
      `MYA_WECHAT_SYNC_BUFFER_DIR=${path.join(legacyStateDir, "sync-buf")}`,
      "MYA_WECHAT_DEFAULT_WORKSPACE=/tmp/project",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = migrateLegacyWechatState({ legacyStateDir, targetStateDir });

  assert.equal(result.migrated, true);
  assert.equal(result.copiedAccounts, 1);
  assert.equal(result.copiedSyncBuffers, 1);
  assert.equal(result.copiedSessionsFile, true);
  assert.equal(result.copiedEnvFile, true);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(targetStateDir, "sessions.json"), "utf8")),
    {
      bindings: {
        "wx:user": {
          activeWorkspaceRoot: "/tmp/project",
        },
      },
    },
  );
  assert.equal(
    fs.readFileSync(path.join(targetStateDir, "sync-buf", "legacy-user.txt"), "utf8"),
    "buffer-1",
  );

  const migratedEnv = fs.readFileSync(path.join(targetStateDir, ".env"), "utf8");
  assert.ok(migratedEnv.includes("MYA_CONNECT_WECHAT_ACCOUNT_ID=legacy-user"));
  assert.ok(migratedEnv.includes(`MYA_CONNECT_WECHAT_STATE_DIR=${targetStateDir}`));
  assert.ok(
    migratedEnv.includes(`MYA_CONNECT_WECHAT_SESSIONS_FILE=${path.join(targetStateDir, "sessions.json")}`),
  );
  assert.ok(
    migratedEnv.includes(`MYA_CONNECT_WECHAT_SYNC_BUFFER_DIR=${path.join(targetStateDir, "sync-buf")}`),
  );
  assert.equal(migratedEnv.includes("MYA_WECHAT_"), false);
});

test("migrateLegacyWechatState is idempotent and does not overwrite existing target files", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-migrate-idempotent-"));
  const legacyStateDir = path.join(homeDir, ".mya-wechat");
  const targetStateDir = path.join(homeDir, ".mya-connect", "wechat");

  writeJson(path.join(legacyStateDir, "accounts", "existing.json"), {
    accountId: "existing",
    token: "legacy-token",
  });
  writeJson(path.join(legacyStateDir, "accounts", "missing.json"), {
    accountId: "missing",
    token: "legacy-missing-token",
  });
  writeJson(path.join(legacyStateDir, "sessions.json"), {
    bindings: {
      legacy: {
        activeWorkspaceRoot: "/tmp/legacy",
      },
    },
  });
  fs.mkdirSync(path.join(legacyStateDir, "sync-buf"), { recursive: true });
  fs.writeFileSync(path.join(legacyStateDir, "sync-buf", "existing.txt"), "legacy-buffer", "utf8");
  fs.writeFileSync(path.join(legacyStateDir, ".env"), "MYA_WECHAT_ACCOUNT_ID=legacy\n", "utf8");

  writeJson(path.join(targetStateDir, "accounts", "existing.json"), {
    accountId: "existing",
    token: "new-token",
  });
  writeJson(path.join(targetStateDir, "sessions.json"), {
    bindings: {
      current: {
        activeWorkspaceRoot: "/tmp/current",
      },
    },
  });
  fs.mkdirSync(path.join(targetStateDir, "sync-buf"), { recursive: true });
  fs.writeFileSync(path.join(targetStateDir, "sync-buf", "existing.txt"), "new-buffer", "utf8");
  fs.writeFileSync(path.join(targetStateDir, ".env"), "MYA_CONNECT_WECHAT_ACCOUNT_ID=current\n", "utf8");

  const first = migrateLegacyWechatState({ legacyStateDir, targetStateDir });
  const second = migrateLegacyWechatState({ legacyStateDir, targetStateDir });

  assert.equal(first.migrated, true);
  assert.equal(first.copiedAccounts, 1);
  assert.equal(first.skippedAccounts, 1);
  assert.equal(first.copiedSyncBuffers, 0);
  assert.equal(first.skippedSyncBuffers, 1);
  assert.equal(first.copiedSessionsFile, false);
  assert.equal(first.copiedEnvFile, false);

  assert.equal(second.migrated, false);
  assert.equal(second.copiedAccounts, 0);
  assert.equal(second.copiedSyncBuffers, 0);
  assert.equal(second.copiedSessionsFile, false);
  assert.equal(second.copiedEnvFile, false);

  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(targetStateDir, "accounts", "existing.json"), "utf8")),
    {
      accountId: "existing",
      token: "new-token",
    },
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(targetStateDir, "accounts", "missing.json"), "utf8")),
    {
      accountId: "missing",
      token: "legacy-missing-token",
    },
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(targetStateDir, "sessions.json"), "utf8")),
    {
      bindings: {
        current: {
          activeWorkspaceRoot: "/tmp/current",
        },
      },
    },
  );
  assert.equal(
    fs.readFileSync(path.join(targetStateDir, "sync-buf", "existing.txt"), "utf8"),
    "new-buffer",
  );
  assert.equal(
    fs.readFileSync(path.join(targetStateDir, ".env"), "utf8"),
    "MYA_CONNECT_WECHAT_ACCOUNT_ID=current\n",
  );
});
