const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const os = require("os");
const path = require("path");

const { HubTaskRegistry } = require("../src/hub/tasks/task-registry");
const {
  HubTaskExecutor,
  buildHubTaskPrompt,
  buildDefaultRunTask,
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

test("HubTaskExecutor notifies channel runtimes after task completion", async () => {
  const filePath = path.join(os.tmpdir(), `mya-connect-hub-executor-${Date.now()}-${Math.random()}.json`);
  const taskRegistry = new HubTaskRegistry({ filePath });
  const notifications = [];
  const executor = new HubTaskExecutor({
    taskRegistry,
    completionNotifier(event) {
      notifications.push(event);
      return {
        detail: "notified",
      };
    },
    async runTask() {
      return {
        sessionId: "session-456",
        result: "日报已发送",
      };
    },
  });

  const record = await executor.dispatch({
    profileId: "mail-bot",
    trigger: "schedule",
    workspaceRoot: "/workspace/mail",
    prompt: "生成日报并通知用户。",
  });

  assert.equal(record.state, "completed");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].state, "completed");
  assert.equal(notifications[0].task.profileId, "mail-bot");
  assert.equal(notifications[0].task.lastOutputSummary, "日报已发送");
});

test("HubTaskExecutor.stop cancels active tasks and drains queued work", async () => {
  const filePath = path.join(os.tmpdir(), `mya-connect-hub-executor-${Date.now()}-${Math.random()}.json`);
  const taskRegistry = new HubTaskRegistry({ filePath });
  const executor = new HubTaskExecutor({
    taskRegistry,
    concurrency: 1,
    async runTask(input, controls = {}) {
      return await new Promise((resolve, reject) => {
        controls.setStopHandler?.(() => {
          reject(new Error(`task cancelled: ${input.taskId}`));
        });
      });
    },
  });

  const running = executor.enqueue({
    profileId: "ops-bot",
    trigger: "schedule",
    workspaceRoot: "/workspace/ops",
    prompt: "执行值班巡检，并汇总异常。",
  });
  const queued = executor.enqueue({
    profileId: "ops-bot",
    trigger: "schedule",
    workspaceRoot: "/workspace/ops",
    prompt: "执行第二个后台任务。",
  });

  await sleep(25);

  const stopResult = await Promise.race([
    executor.stop(),
    sleep(200).then(() => "__timeout__"),
  ]);

  assert.notEqual(stopResult, "__timeout__");
  assert.equal(taskRegistry.get(running.taskId)?.state, "failed");
  assert.match(taskRegistry.get(running.taskId)?.lastOutputSummary || "", /cancelled|stopping/i);
  assert.equal(taskRegistry.get(queued.taskId)?.state, "failed");
  assert.match(taskRegistry.get(queued.taskId)?.lastOutputSummary || "", /cancelled|stopping/i);
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

test("buildHubTaskPrompt does not turn command-based schedules into agent instructions", () => {
  const prompt = buildHubTaskPrompt({
    profileId: "mail-bot",
    trigger: "schedule",
    workspaceRoot: "/workspace/mail",
    command: "cd /workspace/mail && python3 on_wake.py",
  });

  assert.match(prompt, /mail-bot/);
  assert.match(prompt, /\/workspace\/mail/);
  assert.match(prompt, /请处理这次后台任务/);
  assert.doesNotMatch(prompt, /执行这个命令/);
  assert.doesNotMatch(prompt, /python3 on_wake\.py/);
});

test("buildDefaultRunTask executes command schedules directly in the shell", async () => {
  const shellInvocations = [];
  let stopHandler = null;
  const runTask = buildDefaultRunTask({
    turnFactory() {
      throw new Error("turnFactory should not be used for command schedules");
    },
    async spawnCommand(input) {
      shellInvocations.push(input);
      return {
        exitCode: 0,
        stdout: "邮件扫描完成\n共 3 封重点邮件",
        stderr: "",
      };
    },
  });

  const result = await runTask({
    profileId: "mail-bot",
    workspaceRoot: "/workspace/mail",
    command: "cd /workspace/mail && python3 on_wake.py",
    model: "kimi-k2.5",
    baseUrl: "https://api.example.com",
    apiKey: "sk-test",
  }, {
    setStopHandler(handler) {
      stopHandler = handler;
    },
  });

  assert.equal(shellInvocations.length, 1);
  assert.equal(shellInvocations[0].cwd, "/workspace/mail");
  assert.equal(shellInvocations[0].command, "cd /workspace/mail && python3 on_wake.py");
  assert.equal(shellInvocations[0].env.ANTHROPIC_BASE_URL, "https://api.example.com");
  assert.equal(shellInvocations[0].env.ANTHROPIC_API_KEY, "sk-test");
  assert.equal(shellInvocations[0].env.ANTHROPIC_MODEL, "kimi-k2.5");
  assert.equal(typeof stopHandler, "function");
  assert.match(result.result, /\[mya command task report\]/);
  assert.match(result.result, /STATUS\s+SUCCESS/);
  assert.match(result.result, /COMMAND\s+cd \/workspace\/mail && python3 on_wake\.py/);
  assert.match(result.result, /邮件扫描完成/);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
