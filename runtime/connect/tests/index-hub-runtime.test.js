const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildHelpText,
  buildHubSupervisorStatusSnapshot,
  createHubTaskDispatchBridge,
  isHubStatusHeartbeatFresh,
  runHubSupervisorMaintenanceTick,
} = require("../src/index");

test("buildHelpText documents hub runtime commands", () => {
  const helpText = buildHelpText();

  assert.match(helpText, /mya serve/);
  assert.match(helpText, /advanced service\/debug commands still exist: mya serve status\|restart\|stop\|logs/);
  assert.doesNotMatch(helpText, /mya serve tasks/);
  assert.doesNotMatch(helpText, /legacy hub commands:/);
});

test("hub supervisor status snapshots include heartbeat and running state", () => {
  const status = buildHubSupervisorStatusSnapshot({
    pid: 123,
    profiles: [{ profileId: "review-bot", channelType: "feishu", accountId: "review-app", state: "running" }],
  });

  assert.equal(status.pid, 123);
  assert.equal(status.state, "running");
  assert.ok(status.heartbeatAt);
  assert.ok(isHubStatusHeartbeatFresh(status));
});

test("runHubSupervisorMaintenanceTick advances scheduled work and records dispatch audits", async () => {
  const tickCalls = [];
  const auditEntries = [];
  const statusWrites = [];
  const now = new Date("2026-04-03T10:00:00Z");

  const result = await runHubSupervisorMaintenanceTick({
    hubRuntime: {
      async tick(value) {
        tickCalls.push(value);
        return {
          active: [
            {
              key: "ops:wechat:wx-main",
              profileId: "ops",
              type: "wechat",
              accountId: "wx-main",
              state: "running",
            },
          ],
          dispatches: [
            {
              profileId: "ops",
              trigger: "schedule",
              taskId: "task-1",
            },
          ],
        };
      },
    },
    auditLog: {
      append(entry) {
        auditEntries.push(entry);
      },
    },
    writeStatus(status) {
      statusWrites.push(status);
    },
    now,
  });

  assert.deepEqual(tickCalls, [now]);
  assert.equal(result.dispatches.length, 1);
  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0].type, "task_dispatch");
  assert.equal(auditEntries[0].taskId, "task-1");
  assert.equal(statusWrites.length, 1);
  assert.equal(statusWrites[0].profiles[0].profileId, "ops");
});

test("createHubTaskDispatchBridge enriches payloads with stored profile defaults before execution", async () => {
  const dispatched = [];
  const bridge = createHubTaskDispatchBridge({
    profileStore: {
      get(profileId) {
        return {
          profileId,
          defaultModel: "sonnet",
          defaultEffort: "medium",
          permissionMode: "plan",
          workers: ["researcher"],
          memoryPolicy: {
            inheritanceMode: "profile",
          },
        };
      },
    },
    taskExecutor: {
      async dispatch(payload) {
        dispatched.push(payload);
        return {
          taskId: payload.taskId || "task-bridge",
        };
      },
    },
  });

  await bridge.dispatch({
    profileId: "ops-bot",
    trigger: "schedule",
    taskId: "task-bridge",
    workspaceRoot: "/workspace/ops",
  });

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].profile.profileId, "ops-bot");
  assert.equal(dispatched[0].permissionMode, "plan");
  assert.equal(dispatched[0].model, "sonnet");
  assert.equal(dispatched[0].effort, "medium");
});
