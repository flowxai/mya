const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

const { HubRuntime } = require("../src/hub/runtime/hub-runtime");
const { RuntimeRegistry } = require("../src/hub/runtime/runtime-registry");
const { ProfileRuntimeFactory } = require("../src/hub/runtime/profile-runtime-factory");
const { HubScheduler } = require("../src/hub/scheduler/scheduler");
const { HubTaskRegistry } = require("../src/hub/tasks/task-registry");

function createRuntime() {
  return {
    async start() {},
    async stop() {},
  };
}

test("HubRuntime loads profile wake schedules and dispatches them on scheduler ticks", async () => {
  const dispatched = [];
  const taskFile = path.join(os.tmpdir(), `mya-connect-hub-runtime-scheduler-${Date.now()}-${Math.random()}.json`);
  const registry = new HubTaskRegistry({ filePath: taskFile });
  const scheduler = new HubScheduler({
    registry,
    dispatcher: {
      async dispatch(payload) {
        dispatched.push(payload);
      },
    },
  });
  const profileStore = {
    list() {
      return [
        {
          profileId: "ops-bot",
          workers: ["researcher"],
          channels: [
            { type: "wechat", accountId: "wx-main" },
          ],
          wakePolicy: {
            schedules: [
              {
                kind: "schedule",
                cron: "*/5 * * * *",
                workspaceRoot: "/tmp/ops",
                prompt: "执行例行巡检并输出摘要。",
                workerType: "researcher",
                taskType: "scheduled_job",
              },
            ],
          },
        },
      ];
    },
  };

  const hubRuntime = new HubRuntime({
    profileStore,
    runtimeRegistry: new RuntimeRegistry(),
    profileRuntimeFactory: new ProfileRuntimeFactory({
      builders: {
        wechat: () => ({ runtime: createRuntime() }),
      },
    }),
    scheduler,
  });

  await hubRuntime.start();
  await hubRuntime.runSchedulerTick(new Date("2026-04-03T10:00:00Z"));

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].profileId, "ops-bot");
  assert.equal(dispatched[0].trigger, "schedule");
  assert.equal(dispatched[0].workspaceRoot, "/tmp/ops");
  assert.equal(dispatched[0].prompt, "执行例行巡检并输出摘要。");
  assert.equal(dispatched[0].workerType, "researcher");
  assert.equal(dispatched[0].taskType, "scheduled_job");

  const tasks = registry.list();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].profileId, "ops-bot");
  assert.equal(tasks[0].trigger, "schedule");
});
