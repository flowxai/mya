const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const INDEX_PATH = "../src/index";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

test("main migrates legacy WeChat state automatically before listing accounts", { concurrency: false }, async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-home-"));
  const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-cwd-"));
  const legacyStateDir = path.join(homeDir, ".mya-wechat");
  const targetAccountPath = path.join(homeDir, ".mya-connect", "wechat", "accounts", "legacy-user.json");
  const originalHome = process.env.HOME;
  const originalArgv = process.argv.slice();
  const originalCwd = process.cwd();
  const logs = [];
  const originalLog = console.log;

  writeJson(path.join(legacyStateDir, "accounts", "legacy-user.json"), {
    accountId: "legacy-user",
    rawAccountId: "legacy-user",
    token: "legacy-token",
    userId: "wx-1",
    savedAt: "2026-04-01T12:00:00.000Z",
  });

  delete require.cache[require.resolve(INDEX_PATH)];
  process.env.HOME = homeDir;
  process.argv = ["node", "mya-connect", "wechat", "accounts"];
  process.chdir(workingDir);
  console.log = (...args) => {
    logs.push(args.join(" "));
  };

  try {
    const { main } = require(INDEX_PATH);
    await main();
  } finally {
    console.log = originalLog;
    process.chdir(originalCwd);
    process.argv = originalArgv;
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    delete require.cache[require.resolve(INDEX_PATH)];
  }

  assert.equal(fs.existsSync(targetAccountPath), true);
  assert.ok(logs.some((line) => line.includes("已保存账号")));
  assert.ok(logs.some((line) => line.includes("legacy-user")));
});
