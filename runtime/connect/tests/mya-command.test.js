const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { EventEmitter } = require("node:events");

const WRAPPER_PATH = path.join(__dirname, "..", "bin", "mya.js");
const {
  runInteractiveBotsSelector,
} = require("../src/index");

function runNode(args, extraEnv = {}) {
  const isolatedHome = extraEnv.HOME || fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-home-"));
  return spawnSync(process.execPath, [WRAPPER_PATH, ...args], {
    env: {
      ...process.env,
      HOME: isolatedHome,
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

function normalizeMacTmpPath(value) {
  return String(value || "").replace(/^\/private(?=\/var\/folders\/)/, "");
}

test("mya connect help routes into the channel bridge help text", () => {
  const result = runNode(["connect", "help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /用法: mya <command>/);
  assert.match(result.stdout, /bot commands:/);
  assert.match(result.stdout, /channel commands:/);
  assert.doesNotMatch(result.stdout, /mya-connect wechat login/);
});

test("top-level mya wechat help routes into the bundled connector help", () => {
  const result = runNode(["wechat", "help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /channel commands:/);
  assert.match(result.stdout, /mya wechat login/);
});

test("top-level mya bots lists saved bots", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-bots-home-"));
  const profilePath = path.join(
    homeDir,
    ".mya",
    "connect",
    "hub",
    "profiles",
    "review-bot",
    "profile.json",
  );

  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(
    profilePath,
    JSON.stringify({
      profileId: "review-bot",
      name: "Review Bot",
      channels: [{ type: "feishu", appId: "review-app", appSecret: "review-secret" }],
    }, null, 2),
    "utf8",
  );

  const result = runNode(["bots"], { HOME: homeDir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /review-bot/);
  assert.match(result.stdout, /feishu:review-app/);
});

function createFakeInteractiveStreams() {
  const input = new EventEmitter();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.resume = () => {};
  input.pause = () => {};
  input.setEncoding = () => {};

  const writes = [];
  const output = (chunk) => {
    writes.push(String(chunk));
  };

  return { input, output, writes };
}

test("interactive mya bots selector supports arrow-key navigation and enter to open", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-bots-select-home-"));
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-bots-select-workspace-"));
  const profilesRoot = path.join(homeDir, ".mya", "connect", "hub", "profiles");
  const selected = [];
  const { input, output, writes } = createFakeInteractiveStreams();

  const store = {
    profilesRoot,
    list() {
      return [
        {
          profileId: "default",
          name: "Default",
          channels: [],
          defaultWorkspaceRoot: workspaceDir,
          workspaceAllowlist: [workspaceDir],
        },
        {
          profileId: "review-bot",
          name: "Review Bot",
          channels: [{ type: "feishu", appId: "review-app", appSecret: "secret" }],
          defaultWorkspaceRoot: workspaceDir,
          workspaceAllowlist: [workspaceDir],
        },
      ];
    },
  };

  const runPromise = runInteractiveBotsSelector(store, {
    input,
    output,
    launch: async (profile, profilePath, instructionsPath) => {
      selected.push({ profile, profilePath, instructionsPath });
    },
  });
  input.emit("data", "\u001b[B");
  input.emit("data", "\r");

  const didLaunch = await runPromise;

  assert.equal(didLaunch, true);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].profile.profileId, "review-bot");
  assert.match(writes.join(""), /选择一个 bot 进入/);
  assert.match(writes.join(""), /> default/);
  assert.match(writes.join(""), /> review-bot/);
});

test("interactive mya bots selector cancels on q", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-bots-select-id-home-"));
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-bots-select-id-workspace-"));
  const profilesRoot = path.join(homeDir, ".mya", "connect", "hub", "profiles");
  const { input, output, writes } = createFakeInteractiveStreams();
  let launched = false;

  const store = {
    profilesRoot,
    list() {
      return [
        {
          profileId: "default",
          name: "Default",
          channels: [],
          defaultWorkspaceRoot: workspaceDir,
          workspaceAllowlist: [workspaceDir],
        },
        {
          profileId: "review-bot",
          name: "Review Bot",
          channels: [],
          defaultWorkspaceRoot: workspaceDir,
          workspaceAllowlist: [workspaceDir],
        },
      ];
    },
  };

  const runPromise = runInteractiveBotsSelector(store, {
    input,
    output,
    launch: async () => {
      launched = true;
    },
  });
  input.emit("data", "q");

  const didLaunch = await runPromise;

  assert.equal(didLaunch, false);
  assert.equal(launched, false);
  assert.match(writes.join(""), /已取消/);
});

test("top-level mya bots add creates a terminal bot and opens a bot-scoped mya session", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-bot-add-home-"));
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-bot-add-workspace-"));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-bot-add-bin-"));
  const fakeMainPath = path.join(tempDir, "fake-mya.sh");

  fs.writeFileSync(
    fakeMainPath,
    [
      "#!/bin/sh",
      "printf 'argv:%s\\n' \"$*\"",
      "printf 'cwd:%s\\n' \"$PWD\"",
      "printf 'bot_id:%s\\n' \"$MYA_ACTIVE_BOT_ID\"",
      "printf 'hub_profile_id:%s\\n' \"$MYA_HUB_PROFILE_ID\"",
      "printf 'bot_profile:%s\\n' \"$MYA_ACTIVE_BOT_PROFILE_PATH\"",
      "printf 'bot_instructions:%s\\n' \"$MYA_ACTIVE_BOT_INSTRUCTIONS_PATH\"",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(fakeMainPath, 0o755);

  const result = spawnSync(process.execPath, [WRAPPER_PATH, "bots", "add", "Review Bot"], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      HOME: homeDir,
      MYA_CONNECT_MAIN_COMMAND: fakeMainPath,
    },
    encoding: "utf8",
  });

  const profilePath = path.join(
    homeDir,
    ".mya",
    "connect",
    "hub",
    "profiles",
    "review-bot",
    "profile.json",
  );
  const instructionsPath = path.join(
    homeDir,
    ".mya",
    "connect",
    "hub",
    "profiles",
    "review-bot",
    "BOT.md",
  );
  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  const instructions = fs.readFileSync(instructionsPath, "utf8");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /argv:/);
  assert.match(result.stdout, /bot_id:review-bot/);
  assert.match(result.stdout, /hub_profile_id:review-bot/);
  assert.match(
    result.stdout,
    new RegExp(`bot_instructions:(?:/private)?${instructionsPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );
  assert.match(
    result.stdout,
    new RegExp(`cwd:(?:/private)?${workspaceDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );
  assert.equal(profile.profileId, "review-bot");
  assert.equal(profile.name, "Review Bot");
  assert.deepEqual(profile.channels, []);
  assert.equal(normalizeMacTmpPath(profile.defaultWorkspaceRoot), normalizeMacTmpPath(workspaceDir));
  assert.deepEqual(
    profile.workspaceAllowlist.map((entry) => normalizeMacTmpPath(entry)),
    [normalizeMacTmpPath(workspaceDir)],
  );
  assert.match(instructions, /^# Review Bot/m);
  assert.match(instructions, /bot-specific operating guidance/i);
  assert.match(instructions, /^## Runtime Capabilities$/m);
});

test("top-level mya bots add reuses an existing bot profile without overwriting identity fields", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-bot-reuse-home-"));
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-bot-reuse-workspace-"));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-bot-reuse-bin-"));
  const fakeMainPath = path.join(tempDir, "fake-mya.sh");

  fs.writeFileSync(
    fakeMainPath,
    "#!/bin/sh\nprintf 'bot_id:%s\\n' \"$MYA_ACTIVE_BOT_ID\"\n",
    "utf8",
  );
  fs.chmodSync(fakeMainPath, 0o755);

  const profilePath = path.join(
    homeDir,
    ".mya",
    "connect",
    "hub",
    "profiles",
    "review-bot",
    "profile.json",
  );
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(
    profilePath,
    JSON.stringify({
      profileId: "review-bot",
      name: "Review Bot",
      role: "reviewer",
      purpose: "Review risky changes",
      channels: [],
      defaultWorkspaceRoot: workspaceDir,
      workspaceAllowlist: [workspaceDir],
    }, null, 2),
    "utf8",
  );
  const instructionsPath = path.join(path.dirname(profilePath), "BOT.md");
  fs.writeFileSync(
    instructionsPath,
    "# Review Bot\n\n- Always review migrations carefully.\n",
    "utf8",
  );

  const result = spawnSync(process.execPath, [WRAPPER_PATH, "bots", "add", "Review Bot"], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      HOME: homeDir,
      MYA_CONNECT_MAIN_COMMAND: fakeMainPath,
    },
    encoding: "utf8",
  });

  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  const instructions = fs.readFileSync(instructionsPath, "utf8");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /bot_id:review-bot/);
  assert.equal(profile.role, "reviewer");
  assert.equal(profile.purpose, "Review risky changes");
  assert.match(instructions, /Always review migrations carefully/);
});

test("top-level mya bots remove deletes a saved bot profile", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-bot-remove-home-"));
  const profileDir = path.join(
    homeDir,
    ".mya",
    "connect",
    "hub",
    "profiles",
    "review-bot",
  );
  const profilePath = path.join(profileDir, "profile.json");

  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(
    profilePath,
    JSON.stringify({
      profileId: "review-bot",
      name: "Review Bot",
      channels: [],
    }, null, 2),
    "utf8",
  );

  const result = runNode(["bots", "remove", "review-bot"], { HOME: homeDir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /已移除|removed/i);
  assert.equal(fs.existsSync(profileDir), false);
});

test("top-level mya serve status surfaces the managed runtime state", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-status-home-"));
  const result = runNode(["serve", "status"], { HOME: homeDir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /mya service 当前未运行。/);
});

test("top-level mya serve logs surfaces audit history or an empty-log message", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-logs-home-"));
  const result = runNode(["serve", "logs"], { HOME: homeDir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /audit log 当前为空|logs 当前为空/);
});

test("top-level mya serve does not expose duplicated tasks command", () => {
  const result = runNode(["serve", "tasks"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr || result.stdout, /未知|help|用法/i);
});

test("top-level mya status now forwards to the main mya binary", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-status-forward-"));
  const fakeMainPath = path.join(tempDir, "fake-mya.sh");

  fs.writeFileSync(
    fakeMainPath,
    "#!/bin/sh\nprintf 'forwarded:%s\\n' \"$*\"\n",
    "utf8",
  );
  fs.chmodSync(fakeMainPath, 0o755);

  const result = runNode(["status"], {
    MYA_CONNECT_MAIN_COMMAND: fakeMainPath,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /forwarded:status/);
});

test("top-level mya tasks now forward to the main mya binary", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-tasks-forward-"));
  const fakeMainPath = path.join(tempDir, "fake-mya.sh");

  fs.writeFileSync(
    fakeMainPath,
    "#!/bin/sh\nprintf 'forwarded:%s\\n' \"$*\"\n",
    "utf8",
  );
  fs.chmodSync(fakeMainPath, 0o755);

  const result = runNode(["tasks"], {
    MYA_CONNECT_MAIN_COMMAND: fakeMainPath,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /forwarded:tasks/);
});

test("plain mya arguments still forward to the main mya binary", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-wrapper-"));
  const fakeMainPath = path.join(tempDir, "fake-mya.sh");

  fs.writeFileSync(
    fakeMainPath,
    "#!/bin/sh\nprintf 'forwarded:%s\\n' \"$*\"\n",
    "utf8",
  );
  fs.chmodSync(fakeMainPath, 0o755);

  const result = runNode(["--version"], {
    MYA_CONNECT_MAIN_COMMAND: fakeMainPath,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /forwarded:--version/);
});

test("top-level mya --help includes product commands as well as core help", () => {
  const result = runNode(["--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: mya \[options\] \[command\] \[prompt\]/);
  assert.match(result.stdout, /Product Commands:/);
  assert.match(result.stdout, /mya bots add <name>\s+Create a bot in the current workspace and open it/);
  assert.match(result.stdout, /mya wechat login \[bot\]\s+Login WeChat and bind it to a bot/);
  assert.match(result.stdout, /mya serve\s+Start every configured bot\/channel together/);
  assert.match(result.stdout, /WeChat can only be bound to one bot at a time/);
  assert.match(result.stdout, /\/whoru\s+Explain or save the bot's identity and purpose/);
});
