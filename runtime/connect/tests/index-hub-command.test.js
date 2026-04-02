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

test("main lists hub profiles from ~/.mya-connect/hub/profiles", { concurrency: false }, async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-hub-home-"));
  const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-hub-cwd-"));
  const profilePath = path.join(
    homeDir,
    ".mya-connect",
    "hub",
    "profiles",
    "review-bot",
    "profile.json"
  );
  const originalHome = process.env.HOME;
  const originalArgv = process.argv.slice();
  const originalCwd = process.cwd();
  const logs = [];
  const originalLog = console.log;

  writeJson(profilePath, {
    profileId: "review-bot",
    name: "Review Bot",
    channels: [{ type: "feishu", appId: "review-app", appSecret: "secret-review-app" }],
  });

  delete require.cache[require.resolve(INDEX_PATH)];
  process.env.HOME = homeDir;
  process.argv = ["node", "mya-connect", "hub", "profiles", "list"];
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

  assert.ok(logs.some((line) => line.includes("review-bot")));
});

test("main validates hub profiles and surfaces success output", { concurrency: false }, async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-hub-home-"));
  const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-hub-cwd-"));
  const profilePath = path.join(
    homeDir,
    ".mya-connect",
    "hub",
    "profiles",
    "ops-bot",
    "profile.json"
  );
  const originalHome = process.env.HOME;
  const originalArgv = process.argv.slice();
  const originalCwd = process.cwd();
  const logs = [];
  const originalLog = console.log;

  writeJson(profilePath, {
    profileId: "ops-bot",
    name: "Ops Bot",
    channels: [{ type: "wechat", accountId: "ops-account" }],
  });

  delete require.cache[require.resolve(INDEX_PATH)];
  process.env.HOME = homeDir;
  process.argv = ["node", "mya-connect", "hub", "profiles", "validate"];
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

  assert.ok(logs.some((line) => line.includes("ops-bot")));
  assert.ok(logs.some((line) => /valid|通过|ok/i.test(line)));
});

test("main rejects multiple wechat bot bindings during hub validation", { concurrency: false }, async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-hub-home-"));
  const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-hub-cwd-"));
  const originalHome = process.env.HOME;
  const originalArgv = process.argv.slice();
  const originalCwd = process.cwd();
  const logs = [];
  const originalLog = console.log;

  writeJson(
    path.join(homeDir, ".mya-connect", "hub", "profiles", "wx-a", "profile.json"),
    {
      profileId: "wx-a",
      name: "WX A",
      channels: [{ type: "wechat", accountId: "wx-a-account" }],
    },
  );
  writeJson(
    path.join(homeDir, ".mya-connect", "hub", "profiles", "wx-b", "profile.json"),
    {
      profileId: "wx-b",
      name: "WX B",
      channels: [{ type: "wechat", accountId: "wx-b-account" }],
    },
  );

  delete require.cache[require.resolve(INDEX_PATH)];
  process.env.HOME = homeDir;
  process.argv = ["node", "mya-connect", "hub", "profiles", "validate"];
  process.chdir(workingDir);
  console.log = (...args) => {
    logs.push(args.join(" "));
  };

  try {
    const { main } = require(INDEX_PATH);
    await assert.rejects(() => main(), /hub profile 校验失败/);
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

  assert.ok(logs.some((line) => line.includes("bot channel topology")));
  assert.ok(logs.some((line) => line.includes("微信当前只支持一个 bot 绑定")));
});

test("main rejects feishu bot bindings without explicit app credentials", { concurrency: false }, async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-hub-home-"));
  const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-hub-cwd-"));
  const profilePath = path.join(
    homeDir,
    ".mya-connect",
    "hub",
    "profiles",
    "review-bot",
    "profile.json"
  );
  const originalHome = process.env.HOME;
  const originalArgv = process.argv.slice();
  const originalCwd = process.cwd();
  const logs = [];
  const originalLog = console.log;

  writeJson(profilePath, {
    profileId: "review-bot",
    name: "Review Bot",
    channels: [{ type: "feishu", appId: "review-app" }],
  });

  delete require.cache[require.resolve(INDEX_PATH)];
  process.env.HOME = homeDir;
  process.argv = ["node", "mya-connect", "hub", "profiles", "validate"];
  process.chdir(workingDir);
  console.log = (...args) => {
    logs.push(args.join(" "));
  };

  try {
    const { main } = require(INDEX_PATH);
    await assert.rejects(() => main(), /hub profile 校验失败/);
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

  assert.ok(logs.some((line) => line.includes("feishu 绑定缺少 appSecret")));
});
