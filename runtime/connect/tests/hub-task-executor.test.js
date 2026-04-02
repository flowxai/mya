const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const os = require("os");
const path = require("path");

const { HubTaskRegistry } = require("../src/hub/tasks/task-registry");
const {
  HubTaskExecutor,
  buildHubTaskPrompt,
} = require("../src/hub/tasks/task-executor");

test("HubTaskExecutor dispatches a background task and persists the completed state", async () => {
  const filePath = path.join(os.tmpdir(), `mya-connect-hub-executor-${Date.now()}-${Math.random()}.json`);
  const taskRegistry = new HubTaskRegistry({ filePath });
  const taskEvents = [];
  const executor = new HubTaskExecutor({
    taskRegistry,
    async runTask(input) {
      taskEvents.push(input);
      return {
        sessionId: "session-123",
        result: "巡检完成",
      };
    },
  });

  const record = await executor.dispatch({
    profileId: "ops-bot",
    trigger: "schedule",
    workspaceRoot: "/workspace/ops",
    prompt: "执行值班巡检，并汇总异常。",
    permissionMode: "plan",
    enableAutoMode: true,
    workerType: "researcher",
  });

  assert.equal(taskEvents.length, 1);
  assert.equal(taskEvents[0].workspaceRoot, "/workspace/ops");
  assert.equal(taskEvents[0].permissionMode, "plan");
  assert.equal(taskEvents[0].enableAutoMode, true);
  assert.equal(taskEvents[0].requestedWorkerType, "researcher");
  assert.equal(record.state, "completed");
  assert.equal(record.resumableSessionId, "session-123");
  assert.equal(record.lastOutputSummary, "巡检完成");
});

test("HubTaskExecutor marks tasks as failed when the task runner throws", async () => {
  const filePath = path.join(os.tmpdir(), `mya-connect-hub-executor-${Date.now()}-${Math.random()}.json`);
  const taskRegistry = new HubTaskRegistry({ filePath });
  const executor = new HubTaskExecutor({
    taskRegistry,
    async runTask() {
      throw new Error("network offline");
    },
  });

  await assert.rejects(
    executor.dispatch({
      profileId: "review-bot",
      trigger: "event_file",
      workspaceRoot: "/workspace/review",
      prompt: "处理新的 PR 审查任务。",
    }),
    /network offline/,
  );

  const listed = taskRegistry.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].state, "failed");
  assert.equal(listed[0].lastOutputSummary, "network offline");
});

test("buildHubTaskPrompt creates a default instruction when the payload omits prompt text", () => {
  const prompt = buildHubTaskPrompt({
    profileId: "ops-bot",
    trigger: "schedule",
    workspaceRoot: "/workspace/ops",
    metadata: {
      reason: "nightly-check",
    },
  });

  assert.match(prompt, /ops-bot/);
  assert.match(prompt, /schedule/);
  assert.match(prompt, /\/workspace\/ops/);
  assert.match(prompt, /nightly-check/);
});

test("HubTaskExecutor can drive a real stream-json turn and persist resumable session state", async () => {
  const child = createFakeChild();
  const filePath = path.join(os.tmpdir(), `mya-connect-hub-executor-${Date.now()}-${Math.random()}.json`);
  const taskRegistry = new HubTaskRegistry({ filePath });
  const executor = new HubTaskExecutor({
    taskRegistry,
    spawn: async () => child,
  });

  const runPromise = executor.dispatch({
    profileId: "review-bot",
    trigger: "schedule",
    workspaceRoot: "/workspace/review",
    prompt: "开始处理 review 任务。",
    permissionMode: "plan",
  });
  await Promise.resolve();

  child.stdout.emit("data", toNdjson({
    type: "system",
    subtype: "init",
    session_id: "session-stream-1",
  }));
  child.stdout.emit("data", toNdjson({
    type: "result",
    subtype: "success",
    session_id: "session-stream-1",
    is_error: false,
    result: "review 完成",
    permission_denials: [],
  }));
  child.emit("close", 0);

  const record = await runPromise;

  assert.equal(record.state, "completed");
  assert.equal(record.resumableSessionId, "session-stream-1");
  assert.equal(record.lastOutputSummary, "review 完成");
});

function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    writes: [],
    ended: false,
    write(chunk) {
      this.writes.push(String(chunk).trim());
    },
    end() {
      this.ended = true;
    },
  };
  return child;
}

function toNdjson(value) {
  return `${JSON.stringify(value)}\n`;
}
