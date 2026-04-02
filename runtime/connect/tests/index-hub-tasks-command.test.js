const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const INDEX_PATH = "../src/index";
const RUNNER_PATH = "../src/infra/mya/runner";
const { HubTaskRegistry } = require("../src/hub/tasks/task-registry");

test("main lists hub tasks from the default registry", { concurrency: false }, async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-hub-home-"));
  const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-hub-cwd-"));
  const originalHome = process.env.HOME;
  const originalArgv = process.argv.slice();
  const originalCwd = process.cwd();
  const originalLog = console.log;
  const logs = [];
  const registry = new HubTaskRegistry({
    filePath: path.join(homeDir, ".mya", "connect", "hub", "tasks", "registry.json"),
  });

  registry.recordDispatch({
    profileId: "ops-bot",
    trigger: "schedule",
    workspaceRoot: "/tmp/ops",
    taskType: "scheduled_job",
  });

  delete require.cache[require.resolve(INDEX_PATH)];
  process.env.HOME = homeDir;
  process.argv = ["node", "mya", "hub", "tasks", "list"];
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
  assert.ok(logs.some((line) => line.includes("schedule")));
});

test("main resumes a hub task via runMyaPrompt and persists the latest summary", { concurrency: false }, async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-hub-home-"));
  const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-hub-cwd-"));
  const originalHome = process.env.HOME;
  const originalArgv = process.argv.slice();
  const originalCwd = process.cwd();
  const originalLog = console.log;
  const logs = [];
  const registry = new HubTaskRegistry({
    filePath: path.join(homeDir, ".mya", "connect", "hub", "tasks", "registry.json"),
  });
  const task = registry.recordDispatch({
    profileId: "review-bot",
    trigger: "event_file",
    workspaceRoot: "/tmp/review",
    taskType: "background_run",
  });
  registry.markRunning(task.taskId, {
    resumableSessionId: "session-resume-1",
  });

  const runnerModulePath = require.resolve(RUNNER_PATH);
  const originalRunnerModule = require.cache[runnerModulePath];
  require.cache[runnerModulePath] = {
    id: runnerModulePath,
    filename: runnerModulePath,
    loaded: true,
    exports: {
      async runMyaPrompt(spec) {
        assert.equal(spec.workspaceRoot, "/tmp/review");
        assert.equal(spec.resumeSessionId, "session-resume-1");
        return "resumed output";
      },
    },
  };

  delete require.cache[require.resolve(INDEX_PATH)];
  process.env.HOME = homeDir;
  process.argv = ["node", "mya", "hub", "tasks", "resume", task.taskId];
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
    if (originalRunnerModule === undefined) {
      delete require.cache[runnerModulePath];
    } else {
      require.cache[runnerModulePath] = originalRunnerModule;
    }
  }

  const reloadedRegistry = new HubTaskRegistry({
    filePath: path.join(homeDir, ".mya", "connect", "hub", "tasks", "registry.json"),
  });
  const updated = reloadedRegistry.get(task.taskId);
  assert.equal(updated.state, "completed");
  assert.equal(updated.lastOutputSummary, "resumed output");
  assert.ok(logs.some((line) => line.includes("resumed output")));
});
