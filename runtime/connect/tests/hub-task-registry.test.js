const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");

const { HubTaskRegistry } = require("../src/hub/tasks/task-registry");

test("HubTaskRegistry records, updates, and lists resumable tasks", () => {
  const filePath = path.join(os.tmpdir(), `mya-connect-hub-tasks-${Date.now()}-${Math.random()}.json`);
  const registry = new HubTaskRegistry({ filePath });

  const created = registry.recordDispatch({
    profileId: "ops-bot",
    trigger: "schedule",
    workspaceRoot: "/tmp/ops",
    taskType: "scheduled_job",
  });

  assert.equal(created.profileId, "ops-bot");
  assert.equal(created.state, "queued");

  const running = registry.markRunning(created.taskId, {
    resumableSessionId: "session-1",
  });
  const completed = registry.markCompleted(created.taskId, {
    lastOutputSummary: "巡检完成",
  });

  assert.equal(running.state, "running");
  assert.equal(completed.state, "completed");
  assert.equal(completed.lastOutputSummary, "巡检完成");

  const listed = registry.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].taskId, created.taskId);
  assert.equal(registry.get(created.taskId).resumableSessionId, "session-1");
});

test("HubTaskRegistry rejects resume for tasks without a resumable session", () => {
  const filePath = path.join(os.tmpdir(), `mya-connect-hub-tasks-${Date.now()}-${Math.random()}.json`);
  const registry = new HubTaskRegistry({ filePath });
  const created = registry.recordDispatch({
    profileId: "review-bot",
    trigger: "message",
    workspaceRoot: "/tmp/review",
    taskType: "interactive_turn",
  });

  assert.equal(registry.getResumeTarget(created.taskId), null);
});

test("HubTaskRegistry exposes stream-turn lifecycle aliases", () => {
  const filePath = path.join(os.tmpdir(), `mya-connect-hub-tasks-${Date.now()}-${Math.random()}.json`);
  const registry = new HubTaskRegistry({ filePath });
  const created = registry.recordDispatch({
    profileId: "ops-bot",
    trigger: "schedule",
    workspaceRoot: "/tmp/ops",
    taskType: "scheduled_job",
  });

  registry.startRun({
    taskId: created.taskId,
    profileId: created.profileId,
    trigger: created.trigger,
    workspaceRoot: created.workspaceRoot,
  });
  registry.updateRun(created.taskId, {
    resumableSessionId: "session-stream",
  });
  registry.completeRun(created.taskId, {
    lastOutputSummary: "ok",
  });

  const task = registry.get(created.taskId);
  assert.equal(task.state, "completed");
  assert.equal(task.resumableSessionId, "session-stream");
  assert.equal(task.lastOutputSummary, "ok");
});

test("HubTaskRegistry exposes stream-turn lifecycle helpers", () => {
  const filePath = path.join(os.tmpdir(), `mya-connect-hub-tasks-${Date.now()}-${Math.random()}.json`);
  const registry = new HubTaskRegistry({ filePath });
  const created = registry.recordDispatch({
    profileId: "ops-bot",
    trigger: "schedule",
    workspaceRoot: "/tmp/ops",
  });

  registry.startRun({
    taskId: created.taskId,
    profileId: created.profileId,
    trigger: created.trigger,
    workspaceRoot: created.workspaceRoot,
    resumableSessionId: "session-start",
  });
  registry.updateRun(created.taskId, {
    resumableSessionId: "session-update",
  });
  registry.completeRun(created.taskId, {
    lastOutputSummary: "完成",
  });

  const task = registry.get(created.taskId);
  assert.equal(task.state, "completed");
  assert.equal(task.resumableSessionId, "session-update");
  assert.equal(task.lastOutputSummary, "完成");
});
