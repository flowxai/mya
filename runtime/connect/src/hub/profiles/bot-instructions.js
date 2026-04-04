const fs = require("fs");
const path = require("path");

const {
  resolveProfileDirectory,
} = require("./profile-paths");

const BOT_INSTRUCTIONS_FILE = "BOT.md";
const RUNTIME_CAPABILITIES_HEADING = "Runtime Capabilities";

function resolveBotInstructionsPath(profileId, options = {}) {
  return path.join(
    resolveProfileDirectory(profileId, options),
    BOT_INSTRUCTIONS_FILE,
  );
}

function ensureBotInstructionsFile(profile, options = {}) {
  const filePath = resolveBotInstructionsPath(profile?.profileId, options);
  if (fs.existsSync(filePath)) {
    syncRuntimeCapabilitiesSection(filePath, profile);
    return filePath;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    buildDefaultBotInstructions(profile),
    "utf8",
  );
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best effort
  }
  return filePath;
}

function buildDefaultBotInstructions(profile = {}) {
  const name = normalizeText(profile.name) || normalizeText(profile.profileId) || "New Bot";
  const workspaceRoot = normalizeText(profile.defaultWorkspaceRoot)
    || firstString(profile.workspaceAllowlist)
    || "(set by mya bots add)";

  return [
    `# ${name}`,
    "",
    "This file contains durable, bot-specific operating guidance.",
    "Keep it concise. Write instructions that should apply every time this bot runs.",
    "",
    "## Identity",
    "- Role:",
    "- Purpose:",
    "- Style:",
    "- Owner address:",
    "- Default language: 中文",
    "",
    "## Workspace",
    `- Default workspace: ${workspaceRoot}`,
    "",
    "## Operating Rules",
    "- Preferred response style:",
    "- Guardrails / things to avoid:",
    "- Default workflows to follow:",
    "",
    ...buildRuntimeCapabilitiesSection(profile),
    "",
    "## Notes",
    "- Edit this file directly to teach the bot how it should behave.",
  ].join("\n");
}

function syncRuntimeCapabilitiesSection(filePath, profile = {}) {
  const existing = fs.readFileSync(filePath, "utf8");
  const next = upsertRuntimeCapabilitiesSection(existing, profile);
  if (next === existing) {
    return;
  }
  fs.writeFileSync(filePath, next, "utf8");
}

function upsertRuntimeCapabilitiesSection(source, profile = {}) {
  const normalizedSource = String(source || "").trimEnd();
  const section = buildRuntimeCapabilitiesSection(profile).join("\n");
  const headingPattern = new RegExp(
    `^## ${escapeRegExp(RUNTIME_CAPABILITIES_HEADING)}\\n[\\s\\S]*?(?=^## |\\Z)`,
    "m",
  );

  if (headingPattern.test(normalizedSource)) {
    return normalizedSource.replace(headingPattern, section);
  }

  if (/^## Notes$/m.test(normalizedSource)) {
    return normalizedSource.replace(/^## Notes$/m, `${section}\n\n## Notes`);
  }

  return `${normalizedSource}\n\n${section}`;
}

function buildRuntimeCapabilitiesSection(profile = {}) {
  const scheduleCount = Array.isArray(profile?.wakePolicy?.schedules)
    ? profile.wakePolicy.schedules.filter((entry) => entry && entry.enabled !== false).length
    : 0;
  const eventCount = Array.isArray(profile?.wakePolicy?.events)
    ? profile.wakePolicy.events.filter(Boolean).length
    : 0;

  return [
    `## ${RUNTIME_CAPABILITIES_HEADING}`,
    `- 定时任务能力：支持通过 profile.json 里的 \`wakePolicy.schedules\` 配置定时唤醒。当前已配置定时任务：${scheduleCount}`,
    `- 事件唤醒能力：支持通过 \`wakePolicy.events\` 或 event file 触发后台任务。当前已配置事件触发：${eventCount}`,
    "- 服务心跳能力：当 `mya serve` 运行时，后台 supervisor 会持续写入 heartbeat 和 runtime status。",
    "- 状态查看方式：主机侧用 `mya serve status` 查看服务状态；微信或飞书里用 `/mya status` 查看当前 bot 的工作状态。",
    "- 创建定时任务步骤：",
    "  1. 打开当前 bot 的 `profile.json`。",
    "  2. 在 `wakePolicy.schedules` 里新增一条规则。",
    "  3. 常用字段是：`cron`、`prompt` 或 `command`、`workspaceRoot`、`taskType`、`metadata`。",
    "  4. cron 按本地时间匹配，不是 UTC。",
    "  5. 保存后执行 `mya serve restart` 让新规则生效。",
    "  6. 任务完成后，结果会主动推送回这个 bot 最近活跃的微信或飞书会话。",
    "- 邮件类任务汇报要求：如果这个 bot 负责扫描或整理邮件，汇报时不要只给概括结论，要按邮件内容说明清楚。",
    "  1. 优先按重要程度排序，逐封说明真正需要关注的邮件。",
    "  2. 每封重点邮件至少交代：发件人、主题、时间、为什么重要、截止时间或时间要求、需要采取的动作。",
    "  3. 如果正文里有关键细节、附件、链接、课程安排、缴费、作业或会议要求，要明确写出来，不要笼统带过。",
    "  4. 如果没有需要关注的邮件，也要说清楚扫描范围、总邮件数，以及为什么判定无需处理。",
    "- schedule 示例：",
    "```json",
    "{",
    "  \"wakePolicy\": {",
    "    \"schedules\": [",
    "      {",
    "        \"name\": \"daily-mail-report\",",
    "        \"cron\": \"0 9 * * *\",",
    "        \"command\": \"cd /absolute/workspace/path/mail_service && python3 on_wake.py\",",
    "        \"workspaceRoot\": \"/absolute/workspace/path\",",
    "        \"taskType\": \"scheduled_job\",",
    "        \"metadata\": {",
    "          \"source\": \"mail-report\"",
    "        }",
    "      }",
    "    ]",
    "  }",
    "}",
    "```",
    "- 回答原则：如果用户问你有没有定时任务或心跳设置，要区分“系统支持这个能力”和“当前这个 bot 是否已经配置”。",
  ];
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstString(value) {
  if (!Array.isArray(value)) {
    return "";
  }

  for (const item of value) {
    const normalized = normalizeText(item);
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  BOT_INSTRUCTIONS_FILE,
  buildDefaultBotInstructions,
  ensureBotInstructionsFile,
  upsertRuntimeCapabilitiesSection,
  resolveBotInstructionsPath,
};
