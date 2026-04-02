const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { HubScheduler } = require("../src/hub/scheduler/scheduler");
const { HubTaskRegistry } = require("../src/hub/tasks/task-registry");

test("HubScheduler dispatches a profile wake run on matching cron rule", async () => {
  const calls = [];
  const filePath = path.join(os.tmpdir(), `mya-connect-hub-scheduler-${Date.now()}-${Math.random()}.json`);
  const registry = new HubTaskRegistry({ filePath });
  const scheduler = new HubScheduler({
    registry,
    dispatcher: {
      async dispatch(payload) {
        calls.push(payload);
      },
    },
  });

  scheduler.load([
    {
      profileId: "ops-bot",
      kind: "schedule",
      cron: "*/5 * * * *",
      workspaceRoot: "/tmp/ops",
      prompt: "执行巡检并汇总异常。",
      workerType: "researcher",
      taskType: "scheduled_job",
      metadata: {
        source: "nightly",
      },
    },
  ]);

  await scheduler.tick(new Date("2026-04-03T10:00:00Z"));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].profileId, "ops-bot");
  assert.equal(calls[0].trigger, "schedule");
  assert.equal(calls[0].prompt, "执行巡检并汇总异常。");
  assert.equal(calls[0].workerType, "researcher");
  assert.equal(calls[0].taskType, "scheduled_job");
  assert.deepEqual(calls[0].metadata, { source: "nightly" });
  assert.equal(registry.list().length, 1);
  assert.equal(registry.list()[0].profileId, "ops-bot");
});

test("HubScheduler dispatches queued event-file entries and clears the source file", async () => {
  const calls = [];
  const registryPath = path.join(os.tmpdir(), `mya-connect-hub-scheduler-${Date.now()}-${Math.random()}.json`);
  const eventFile = path.join(os.tmpdir(), `mya-connect-hub-event-${Date.now()}-${Math.random()}.jsonl`);
  fs.writeFileSync(
    eventFile,
    `${JSON.stringify({ profileId: "review-bot", workspaceRoot: "/tmp/review", note: "new pr" })}\n`,
    "utf8"
  );
  const registry = new HubTaskRegistry({ filePath: registryPath });
  const scheduler = new HubScheduler({
    registry,
    dispatcher: {
      async dispatch(payload) {
        calls.push(payload);
      },
    },
  });

  scheduler.load([
    {
      profileId: "review-bot",
      kind: "event_file",
      eventFile,
    },
  ]);

  await scheduler.tick(new Date("2026-04-03T10:01:00Z"));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].profileId, "review-bot");
  assert.equal(calls[0].trigger, "event_file");
  assert.equal(fs.readFileSync(eventFile, "utf8"), "");
});
