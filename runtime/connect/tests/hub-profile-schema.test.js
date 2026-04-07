const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeProfile,
  parseProfile,
} = require("../src/hub/profiles/profile-schema");

test("normalizeProfile canonicalizes workers, memory policy, orchestration, and wake schedules", () => {
  const profile = normalizeProfile({
    profileId: " Review Bot ",
    name: " Review Bot ",
    workers: [" reviewer ", "", "researcher", "reviewer"],
    memoryPolicy: {
      inheritanceMode: " inherit ",
      scope: " profile+workspace ",
    },
    orchestration: {
      defaultWorkerType: " reviewer ",
      runInBackground: true,
    },
    wakePolicy: {
      schedules: [
        {
          kind: "schedule",
          cron: "*/5 * * * *",
          workspaceRoot: " /tmp/repo ",
          prompt: " 检查这个仓库的最新状态 ",
          workerType: " reviewer ",
          taskType: " scheduled_job ",
          notification: {
            channelType: " feishu ",
            accountId: " app-review ",
            chatId: " oc_test_chat ",
          },
        },
        {
          kind: "event_file",
          eventFile: "/tmp/review-bot-events.jsonl",
          workspaceRoot: "/tmp/repo",
        },
      ],
      events: [" pull_request_opened ", "", "pull_request_opened"],
    },
    channels: [
      {
        type: " feishu ",
        appId: " app-review ",
        defaultWorkspaceRoot: " /tmp/repo ",
      },
    ],
  });

  assert.equal(profile.profileId, "review-bot");
  assert.equal(profile.name, "Review Bot");
  assert.deepEqual(profile.workers, ["reviewer", "researcher"]);
  assert.deepEqual(profile.memoryPolicy, {
    inheritanceMode: "inherit",
    scope: "profile+workspace",
  });
  assert.deepEqual(profile.orchestration, {
    defaultWorkerType: "reviewer",
    runInBackground: true,
  });
  assert.deepEqual(profile.wakePolicy.events, ["pull_request_opened"]);
  assert.equal(profile.wakePolicy.schedules.length, 2);
  assert.equal(profile.wakePolicy.schedules[0].prompt, "检查这个仓库的最新状态");
  assert.equal(profile.wakePolicy.schedules[0].workerType, "reviewer");
  assert.equal(profile.wakePolicy.schedules[0].taskType, "scheduled_job");
  assert.equal(profile.wakePolicy.schedules[0].workspaceRoot, "/tmp/repo");
  assert.deepEqual(profile.wakePolicy.schedules[0].notification, {
    channelType: "feishu",
    accountId: "app-review",
    chatId: "oc_test_chat",
  });
  assert.equal(profile.channels[0].type, "feishu");
  assert.equal(profile.channels[0].defaultWorkspaceRoot, "/tmp/repo");
});

test("normalizeProfile accepts terminal-only bots without channels", () => {
  const profile = normalizeProfile({
    profileId: "Terminal Bot",
    name: "Terminal Bot",
    channels: [],
    defaultWorkspaceRoot: "/tmp/workspace",
    workspaceAllowlist: ["/tmp/workspace"],
  });

  assert.equal(profile.profileId, "terminal-bot");
  assert.equal(profile.name, "Terminal Bot");
  assert.deepEqual(profile.channels, []);
  assert.equal(profile.defaultWorkspaceRoot, "/tmp/workspace");
});

test("parseProfile rejects profiles without a valid channels array or valid wake rules", () => {
  assert.equal(parseProfile(null), null);
  assert.equal(parseProfile({ profileId: "bad-profile", channels: "oops" }), null);
  assert.equal(
    parseProfile({
      profileId: "bad-schedules",
      channels: [{ type: "wechat", accountId: "wx-main" }],
      wakePolicy: {
        schedules: [{ kind: "schedule" }],
      },
    }),
    null,
  );
});
