const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildDefaultBotInstructions,
  ensureBotInstructionsFile,
} = require("../src/hub/profiles/bot-instructions");

test("buildDefaultBotInstructions describes schedule and heartbeat capabilities", () => {
  const instructions = buildDefaultBotInstructions({
    profileId: "review-bot",
    name: "Review Bot",
    defaultWorkspaceRoot: "/tmp/repo",
    wakePolicy: {
      schedules: [],
      events: [],
    },
  });

  assert.match(instructions, /^## Runtime Capabilities$/m);
  assert.match(instructions, /wakePolicy\.schedules/);
  assert.match(instructions, /当前已配置定时任务：0/);
  assert.match(instructions, /mya serve/);
  assert.match(instructions, /\/mya status/);
  assert.match(instructions, /创建定时任务步骤/);
  assert.match(instructions, /mya serve restart/);
  assert.match(instructions, /cron 按本地时间匹配/);
  assert.match(instructions, /邮件类任务汇报要求/);
  assert.match(instructions, /发件人/);
  assert.match(instructions, /主题/);
  assert.match(instructions, /需要采取的动作/);
});

test("ensureBotInstructionsFile backfills runtime capabilities into an existing BOT.md", () => {
  const profilesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mya-bot-instructions-"));
  const profile = {
    profileId: "ops-bot",
    name: "Ops Bot",
    defaultWorkspaceRoot: "/tmp/ops",
    wakePolicy: {
      schedules: [
        {
          id: "daily-check",
          cron: "0 9 * * *",
          prompt: "check ops health",
        },
      ],
      events: [],
    },
  };
  const instructionsPath = path.join(profilesRoot, "ops-bot", "BOT.md");

  fs.mkdirSync(path.dirname(instructionsPath), { recursive: true });
  fs.writeFileSync(
    instructionsPath,
    [
      "# Ops Bot",
      "",
      "## Identity",
      "- Role: ops",
      "",
      "## Notes",
      "- Existing note.",
    ].join("\n"),
    "utf8",
  );

  ensureBotInstructionsFile(profile, { profilesRoot });

  const updated = fs.readFileSync(instructionsPath, "utf8");

  assert.match(updated, /^## Runtime Capabilities$/m);
  assert.match(updated, /当前已配置定时任务：1/);
  assert.match(updated, /schedule 示例/);
  assert.match(updated, /Existing note\./);

  fs.rmSync(profilesRoot, { recursive: true, force: true });
});
