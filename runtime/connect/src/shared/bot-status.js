const { HubTaskRegistry } = require("../hub/tasks/task-registry");

const STUCK_THRESHOLD_SECONDS = 20;
const FIELD_WIDTH = 10;

function buildBotWorkStatusText(options) {
  return buildBotWorkStatusLines(options).join("\n");
}

function buildBotWorkStatusLines({
  botName = "",
  channelType = "",
  workspaceRoot = "",
  sessionId = "",
  active = null,
  snapshot = null,
  recentEntries = [],
  now = new Date(),
  taskRegistryFile = "",
} = {}) {
  const source = active || snapshot || null;
  const stuck = getStuckInfo(source, now);
  const taskSummary = getTaskSummary(botName, { taskRegistryFile });

  return [
    "[mya status]",
    "",
    formatField("BOT", botName || "default"),
    formatField("CHANNEL", channelType || "unknown"),
    formatField("WORKSPACE", workspaceRoot || "(none)"),
    formatField("SESSION", sessionId || "(none)"),
    "",
    formatField("STATE", normalizeStateLabel(source?.status)),
    formatField("HEALTH", getHealthLabel(source, stuck)),
    formatField("STUCK", stuck.label),
    formatField("RUNTIME", getRuntimeLabel(source, now)),
    "",
    formatField("CURRENT", getCurrentToolLabel(source)),
    formatField("STEP", getStepLabel(source, stuck)),
    formatField("WAITING", getWaitingLabel(source, stuck)),
    "",
    formatField("LAST", getLastActionLabel(source, recentEntries)),
    formatField("RESULT", getResultLabel(source)),
    formatField("ERROR", normalizeText(source?.lastError) || "none"),
    "",
    formatField(
      "BACKGROUND",
      `running:${taskSummary.running} queued:${taskSummary.queued} failed:${taskSummary.failed}`
    ),
    formatField("UPDATED", normalizeText(source?.lastUpdatedAt || source?.lastEventAt || source?.finishedAt) || toIsoString(now)),
  ];
}

function formatField(label, value) {
  const normalizedLabel = String(label || "");
  const width = Math.max(FIELD_WIDTH, normalizedLabel.length + 1);
  return `${normalizedLabel.padEnd(width)}${normalizeText(value) || "(none)"}`;
}

function getTaskSummary(profileId, { taskRegistryFile = "" } = {}) {
  const summary = { running: 0, queued: 0, failed: 0 };
  const normalizedProfileId = normalizeText(profileId);
  if (!normalizedProfileId) {
    return summary;
  }

  try {
    const registry = new HubTaskRegistry({ filePath: taskRegistryFile || undefined });
    for (const task of registry.list()) {
      if (normalizeText(task.profileId) !== normalizedProfileId) {
        continue;
      }
      if (task.state === "running") {
        summary.running += 1;
      } else if (task.state === "queued") {
        summary.queued += 1;
      } else if (task.state === "failed") {
        summary.failed += 1;
      }
    }
  } catch {
    return summary;
  }

  return summary;
}

function getStuckInfo(source, now) {
  if (!source || source.status !== "running" || source.pendingPermission) {
    return { isStuck: false, label: "NO" };
  }

  const lastEvent = parseTimestamp(source.lastEventAt) || parseTimestamp(source.startedAt);
  if (!lastEvent) {
    return { isStuck: false, label: "NO" };
  }

  const elapsedSeconds = Math.max(0, Math.floor((toDate(now).getTime() - lastEvent.getTime()) / 1000));
  if (elapsedSeconds < STUCK_THRESHOLD_SECONDS) {
    return { isStuck: false, label: "NO" };
  }

  return {
    isStuck: true,
    label: `YES (${elapsedSeconds}s no progress)`,
  };
}

function getHealthLabel(source, stuck) {
  if (source?.pendingPermission || source?.status === "requires_action") {
    return "BLOCKED";
  }
  if (normalizeText(source?.lastError) || stuck.isStuck) {
    return "DEGRADED";
  }
  return "HEALTHY";
}

function getRuntimeLabel(source, now) {
  const startedAt = parseTimestamp(source?.startedAt);
  if (!startedAt) {
    return "-";
  }
  const finishedAt = parseTimestamp(source?.finishedAt) || toDate(now);
  const elapsedSeconds = Math.max(0, Math.floor((finishedAt.getTime() - startedAt.getTime()) / 1000));
  return `${elapsedSeconds}s`;
}

function getCurrentToolLabel(source) {
  if (!source || !["running", "requires_action", "stopping"].includes(normalizeText(source.status))) {
    return "none";
  }
  return normalizeText(source?.lastToolUse?.toolName)
    || normalizeText(source?.lastProgress?.toolName)
    || "none";
}

function getStepLabel(source, stuck) {
  if (!source) {
    return "等待新消息";
  }
  if (source.pendingPermission || source.status === "requires_action") {
    return "等待权限确认";
  }
  if (source.status === "stopping") {
    return "正在停止当前任务";
  }
  if (source.status === "idle") {
    return normalizeText(source.lastResultSummary) ? "上一轮已完成" : "等待新消息";
  }
  if (source.status === "stopped") {
    return "已停止当前任务";
  }
  if (source.status === "error") {
    return "上一轮执行失败";
  }
  const progressTool = normalizeText(source?.lastProgress?.toolName);
  if (progressTool) {
    const seconds = Math.max(0, Number(source?.lastProgress?.elapsedTimeSeconds || 0));
    return `正在执行 ${progressTool} (${seconds}s)`;
  }
  const toolName = normalizeText(source?.lastToolUse?.toolName);
  if (toolName) {
    return `正在执行 ${toolName}`;
  }
  if (source.status === "running") {
    return stuck.isStuck ? "当前回合没有新进展" : "正在处理消息";
  }
  return "等待新消息";
}

function getWaitingLabel(source, stuck) {
  if (source?.pendingPermission || source?.status === "requires_action") {
    return "permission approval";
  }
  if (stuck.isStuck) {
    return "tool output";
  }
  return "none";
}

function getLastActionLabel(source, recentEntries) {
  if (source?.pendingPermission) {
    const detail = normalizeText(source.pendingPermission.commandPreview)
      || normalizeText(source.pendingPermission.description)
      || normalizeText(source.pendingPermission.toolName)
      || "permission request";
    const toolName = normalizeText(source.pendingPermission.toolName) || "tool";
    return `${toolName} -> ${detail}`;
  }

  if (normalizeText(source?.lastResultSummary)) {
    return `assistant -> ${source.lastResultSummary}`;
  }

  const toolUse = describeToolUse(source?.lastToolUse);
  if (toolUse) {
    return toolUse;
  }

  const assistantEntry = Array.isArray(recentEntries)
    ? [...recentEntries].reverse().find((entry) => entry?.role === "assistant" && normalizeText(entry?.text))
    : null;
  if (assistantEntry) {
    return `assistant -> ${summarizeText(assistantEntry.text)}`;
  }

  return "none";
}

function getResultLabel(source) {
  if (!source) {
    return "idle";
  }
  if (normalizeText(source.lastError) || source.status === "error") {
    return "failed";
  }
  if (source.pendingPermission || source.status === "requires_action") {
    return "waiting";
  }
  if (source.status === "stopping") {
    return "stopping";
  }
  if (source.status === "stopped") {
    return "stopped";
  }
  if (source.status === "running") {
    return "in_progress";
  }
  if (source.status === "idle" && normalizeText(source.lastResultSummary)) {
    return "completed";
  }
  return "idle";
}

function normalizeStateLabel(status) {
  switch (normalizeText(status)) {
    case "requires_action":
      return "WAITING";
    case "running":
      return "RUNNING";
    case "stopping":
      return "STOPPING";
    case "stopped":
      return "STOPPED";
    case "error":
      return "ERROR";
    default:
      return "IDLE";
  }
}

function describeToolUse(event) {
  const toolName = normalizeText(event?.toolName);
  if (!toolName) {
    return "";
  }

  const input = event?.input && typeof event.input === "object" ? event.input : {};
  const detail = normalizeText(input.command)
    || normalizeText(input.filePath)
    || normalizeText(input.path)
    || normalizeText(input.targetFile)
    || normalizeText(input.target_file)
    || normalizeText(input.url)
    || normalizeText(input.pattern);

  return detail ? `${toolName} -> ${detail}` : toolName;
}

function summarizeText(value, maxLength = 80) {
  const normalized = normalizeText(value).replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseTimestamp(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value || Date.now());
}

function toIsoString(value) {
  return toDate(value).toISOString();
}

module.exports = {
  buildBotWorkStatusLines,
  buildBotWorkStatusText,
  summarizeText,
};
