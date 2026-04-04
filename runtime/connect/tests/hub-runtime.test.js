const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");

const {
  HubRuntime,
  collectHubScheduleRules,
} = require("../src/hub/runtime/hub-runtime");
const { RuntimeRegistry } = require("../src/hub/runtime/runtime-registry");
const { ProfileRuntimeFactory } = require("../src/hub/runtime/profile-runtime-factory");
const { HubScheduler } = require("../src/hub/scheduler/scheduler");
const { HubTaskRegistry } = require("../src/hub/tasks/task-registry");

function createRuntime(name, events) {
  return {
    name,
    async start() {
      events.push(`start:${name}`);
    },
    async stop() {
      events.push(`stop:${name}`);
    },
  };
}

test("ProfileRuntimeFactory creates one runtime definition per enabled profile channel", () => {
  const factory = new ProfileRuntimeFactory({
    builders: {
      wechat: ({ profile, channel }) => ({
        runtime: { profileId: profile.profileId, accountId: channel.accountId },
      }),
      feishu: ({ profile, channel }) => ({
        runtime: { profileId: profile.profileId, appId: channel.accountId },
      }),
    },
  });

  const definitions = factory.createProfileRuntimes({
    profileId: "ops",
    channels: [
      { type: "wechat", accountId: "wx-main" },
      { type: "feishu", accountId: "fs-main", enabled: true },
      { type: "wechat", accountId: "wx-disabled", enabled: false },
      { type: "", accountId: "missing-type" },
    ],
  });

  assert.deepEqual(
    definitions.map((entry) => ({
      key: entry.key,
      type: entry.type,
      accountId: entry.accountId,
      profileId: entry.profileId,
    })),
    [
      {
        key: "ops:wechat:wx-main",
        type: "wechat",
        accountId: "wx-main",
        profileId: "ops",
      },
      {
        key: "ops:feishu:fs-main",
        type: "feishu",
        accountId: "fs-main",
        profileId: "ops",
      },
    ],
  );
});

test("RuntimeRegistry reconciles runtimes and reuses existing entries with the same key", async () => {
  const events = [];
  const registry = new RuntimeRegistry();

  const initialDefinitions = [
    {
      key: "ops:wechat:wx-main",
      profileId: "ops",
      type: "wechat",
      accountId: "wx-main",
      runtime: createRuntime("wx-main", events),
    },
    {
      key: "ops:feishu:fs-main",
      profileId: "ops",
      type: "feishu",
      accountId: "fs-main",
      runtime: createRuntime("fs-main", events),
    },
  ];

  const firstPass = await registry.reconcile(initialDefinitions);
  const secondPass = await registry.reconcile([
    initialDefinitions[0],
    {
      key: "ops:feishu:fs-next",
      profileId: "ops",
      type: "feishu",
      accountId: "fs-next",
      runtime: createRuntime("fs-next", events),
    },
  ]);

  assert.equal(firstPass.started.length, 2);
  assert.equal(firstPass.stopped.length, 0);
  assert.equal(secondPass.started.length, 1);
  assert.equal(secondPass.stopped.length, 1);
  assert.equal(registry.size, 2);
  assert.deepEqual(
    registry.list().map((entry) => entry.key),
    ["ops:feishu:fs-next", "ops:wechat:wx-main"],
  );
  assert.deepEqual(events, [
    "start:wx-main",
    "start:fs-main",
    "stop:fs-main",
    "start:fs-next",
  ]);
});

test("RuntimeRegistry can notify runtimes scoped to a profile", async () => {
  const notifications = [];
  const registry = new RuntimeRegistry();

  await registry.reconcile([
    {
      key: "ops:wechat:wx-main",
      profileId: "ops",
      type: "wechat",
      accountId: "wx-main",
      runtime: {
        async start() {},
        async stop() {},
        async notifyTaskCompletion(task) {
          notifications.push(["ops", task.taskId]);
          return { delivered: true };
        },
      },
    },
    {
      key: "review:feishu:review-app",
      profileId: "review",
      type: "feishu",
      accountId: "review-app",
      runtime: {
        async start() {},
        async stop() {},
        async notifyTaskCompletion(task) {
          notifications.push(["review", task.taskId]);
          return { delivered: true };
        },
      },
    },
  ]);

  const results = await registry.notifyProfile("ops", "notifyTaskCompletion", {
    taskId: "task-123",
  });

  assert.deepEqual(notifications, [["ops", "task-123"]]);
  assert.equal(results.length, 1);
  assert.equal(results[0].profileId, "ops");
});

test("HubRuntime supervises runtimes from the profile store lifecycle", async () => {
  const events = [];
  const profileStore = {
    profiles: [
      {
        profileId: "ops",
        channels: [
          { type: "wechat", accountId: "wx-main" },
          { type: "feishu", accountId: "fs-main" },
        ],
      },
    ],
    list() {
      return this.profiles;
    },
  };
  const hubRuntime = new HubRuntime({
    profileStore,
    runtimeRegistry: new RuntimeRegistry(),
    profileRuntimeFactory: new ProfileRuntimeFactory({
      builders: {
        wechat: ({ channel }) => ({ runtime: createRuntime(`wechat:${channel.accountId}`, events) }),
        feishu: ({ channel }) => ({ runtime: createRuntime(`feishu:${channel.accountId}`, events) }),
      },
    }),
  });

  const started = await hubRuntime.start();
  profileStore.profiles = [
    {
      profileId: "ops",
      channels: [
        { type: "wechat", accountId: "wx-main" },
        { type: "feishu", accountId: "fs-main", enabled: false },
      ],
    },
    {
      profileId: "review",
      channels: [{ type: "feishu", accountId: "review-app" }],
    },
  ];
  const refreshed = await hubRuntime.refresh();
  const status = hubRuntime.status();
  const stopped = await hubRuntime.stop();

  assert.equal(started.started.length, 2);
  assert.equal(refreshed.started.length, 1);
  assert.equal(refreshed.stopped.length, 1);
  assert.deepEqual(
    status.map((entry) => ({
      key: entry.key,
      state: entry.state,
    })),
    [
      { key: "ops:wechat:wx-main", state: "running" },
      { key: "review:feishu:review-app", state: "running" },
    ],
  );
  assert.equal(stopped.stopped.length, 2);
  assert.deepEqual(events, [
    "start:wechat:wx-main",
    "start:feishu:fs-main",
    "stop:feishu:fs-main",
    "start:feishu:review-app",
    "stop:wechat:wx-main",
    "stop:feishu:review-app",
  ]);
});

test("HubRuntime loads wake schedules from profiles during start and refresh", async () => {
  const loadedRules = [];
  const profileStore = {
    profiles: [
      {
        profileId: "ops",
        channels: [{ type: "wechat", accountId: "wx-main" }],
        wakePolicy: {
          schedules: [
            {
              profileId: "ops",
              kind: "schedule",
              cron: "*/5 * * * *",
              workspaceRoot: "/workspace/ops",
            },
          ],
        },
      },
    ],
    list() {
      return this.profiles;
    },
  };
  const hubRuntime = new HubRuntime({
    profileStore,
    runtimeRegistry: new RuntimeRegistry(),
    scheduler: {
      load(rules) {
        loadedRules.push(rules);
        return rules;
      },
    },
    profileRuntimeFactory: new ProfileRuntimeFactory({
      builders: {
        wechat: ({ channel }) => ({ runtime: createRuntime(`wechat:${channel.accountId}`, []) }),
      },
    }),
  });

  await hubRuntime.start();
  profileStore.profiles = [
    {
      profileId: "ops",
      channels: [{ type: "wechat", accountId: "wx-main" }],
      wakePolicy: {
        schedules: [
          {
            profileId: "ops",
            kind: "event_file",
            eventFile: "/tmp/ops-events.jsonl",
          },
        ],
      },
    },
  ];
  await hubRuntime.refresh();

  assert.equal(loadedRules.length, 2);
  assert.deepEqual(loadedRules[0], [
    {
      profileId: "ops",
      kind: "schedule",
      cron: "*/5 * * * *",
      workspaceRoot: "/workspace/ops",
    },
  ]);
  assert.deepEqual(loadedRules[1], [
    {
      profileId: "ops",
      kind: "event_file",
      eventFile: path.resolve("/tmp/ops-events.jsonl"),
    },
  ]);
});

test("HubRuntime delegates scheduler ticks for background wake execution", async () => {
  const tickCalls = [];
  const profileStore = {
    list() {
      return [
        {
          profileId: "ops",
          channels: [{ type: "wechat", accountId: "wx-main" }],
        },
      ];
    },
  };
  const hubRuntime = new HubRuntime({
    profileStore,
    runtimeRegistry: new RuntimeRegistry(),
    scheduler: {
      load() {
        return [];
      },
      async tick(now) {
        tickCalls.push(now);
        return [{ profileId: "ops", trigger: "schedule" }];
      },
    },
    profileRuntimeFactory: new ProfileRuntimeFactory({
      builders: {
        wechat: ({ channel }) => ({ runtime: createRuntime(`wechat:${channel.accountId}`, []) }),
      },
    }),
  });

  await hubRuntime.start();
  const now = new Date("2026-04-03T10:00:00Z");
  const tickResult = await hubRuntime.tick(now);

  assert.deepEqual(tickCalls, [now]);
  assert.deepEqual(tickResult, [{ profileId: "ops", trigger: "schedule" }]);
});

test("collectHubScheduleRules flattens enabled wake schedules across profiles", () => {
  const rules = collectHubScheduleRules([
    {
      profileId: "ops-bot",
      wakePolicy: {
        schedules: [
          {
            kind: "schedule",
            cron: "*/5 * * * *",
            workspaceRoot: "/workspace/ops",
          },
          {
            kind: "event_file",
            eventFile: "/tmp/ops-bot.jsonl",
          },
        ],
      },
    },
    {
      profileId: "review-bot",
      wakePolicy: {
        schedules: [
          {
            kind: "schedule",
            cron: "0 * * * *",
            workspaceRoot: "/workspace/review",
            enabled: false,
          },
        ],
      },
    },
  ]);

  assert.deepEqual(
    rules.map((rule) => ({
      profileId: rule.profileId,
      kind: rule.kind,
      workspaceRoot: rule.workspaceRoot || "",
      cron: rule.cron || "",
      eventFile: rule.eventFile || "",
    })),
    [
      {
        profileId: "ops-bot",
        kind: "schedule",
        workspaceRoot: "/workspace/ops",
        cron: "*/5 * * * *",
        eventFile: "",
      },
      {
        profileId: "ops-bot",
        kind: "event_file",
        workspaceRoot: "",
        cron: "",
        eventFile: path.resolve("/tmp/ops-bot.jsonl"),
      },
    ],
  );
});

test("HubRuntime tick refreshes wake rules and dispatches due scheduled jobs", async () => {
  const dispatches = [];
  const filePath = path.join(os.tmpdir(), `mya-connect-hub-runtime-${Date.now()}-${Math.random()}.json`);
  const registry = new HubTaskRegistry({ filePath });
  const scheduler = new HubScheduler({
    registry,
    dispatcher: {
      async dispatch(payload) {
        dispatches.push(payload);
      },
    },
  });
  const profileStore = {
    profiles: [
      {
        profileId: "ops-bot",
        wakePolicy: {
          schedules: [
            {
              kind: "schedule",
              cron: "*/5 * * * *",
              workspaceRoot: "/workspace/ops",
            },
          ],
        },
        channels: [],
      },
    ],
    list() {
      return this.profiles;
    },
  };
  const hubRuntime = new HubRuntime({
    profileStore,
    runtimeRegistry: new RuntimeRegistry(),
    profileRuntimeFactory: new ProfileRuntimeFactory({ builders: {} }),
    scheduler,
  });

  await hubRuntime.start();
  const dispatchesFromTick = await hubRuntime.tick(new Date("2026-04-03T10:00:00Z"));

  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].profileId, "ops-bot");
  assert.equal(dispatches[0].trigger, "schedule");
  assert.equal(dispatches[0].workspaceRoot, "/workspace/ops");
  assert.deepEqual(dispatchesFromTick, dispatches);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.list()[0].state, "queued");
});
