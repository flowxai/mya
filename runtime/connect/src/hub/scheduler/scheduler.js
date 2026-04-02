const fs = require("fs");

const {
  matchesCronDate,
  normalizeScheduleRules,
} = require("./schedule-schema");

class HubScheduler {
  constructor(options = {}) {
    this.registry = options.registry || null;
    this.dispatcher = options.dispatcher || { async dispatch() {} };
    this.rules = [];
    this.lastDispatchKeyByRule = new Map();
  }

  load(rules) {
    this.rules = normalizeScheduleRules(rules);
    return this.rules;
  }

  async tick(now = new Date()) {
    const dispatches = [];

    for (const rule of this.rules) {
      if (rule.kind === "schedule") {
        if (!matchesCronDate(rule.cron, now)) {
          continue;
        }

        const tickKey = toMinuteKey(now);
        const dedupeKey = `${rule.profileId}:${rule.kind}:${rule.cron}:${tickKey}`;
        if (this.lastDispatchKeyByRule.get(dedupeKey)) {
          continue;
        }

        this.lastDispatchKeyByRule.set(dedupeKey, tickKey);
        const task = this.registry?.recordDispatch?.({
          profileId: rule.profileId,
          trigger: "schedule",
          workspaceRoot: rule.workspaceRoot,
          taskType: normalizeText(rule.taskType) || "scheduled_job",
        }) || null;
        const payload = {
          profileId: rule.profileId,
          trigger: "schedule",
          workspaceRoot: rule.workspaceRoot,
          schedule: rule.cron,
          prompt: normalizeText(rule.prompt),
          workerType: normalizeText(rule.workerType),
          taskType: normalizeText(rule.taskType) || "scheduled_job",
          metadata: isRecord(rule.metadata) ? { ...rule.metadata } : {},
          taskId: task?.taskId || "",
          at: new Date(now).toISOString(),
        };
        dispatchWithoutWaiting(this.dispatcher, payload);
        dispatches.push(payload);
        continue;
      }

      if (rule.kind === "event_file") {
        const events = readQueuedEventFile(rule.eventFile);
        if (!events.length) {
          continue;
        }

        clearEventFile(rule.eventFile);
        for (const event of events) {
          const profileId = normalizeText(event.profileId) || rule.profileId;
          const workspaceRoot = normalizeText(event.workspaceRoot) || rule.workspaceRoot;
          const task = this.registry?.recordDispatch?.({
            profileId,
            trigger: "event_file",
            workspaceRoot,
            taskType: "background_run",
          }) || null;
          const payload = {
            ...event,
            profileId,
            workspaceRoot,
            trigger: "event_file",
            prompt: normalizeText(event.prompt),
            workerType: normalizeText(event.workerType),
            taskType: normalizeText(event.taskType) || "background_run",
            metadata: isRecord(event.metadata) ? { ...event.metadata } : {},
            taskId: task?.taskId || "",
          };
          dispatchWithoutWaiting(this.dispatcher, payload);
          dispatches.push(payload);
        }
      }
    }

    return dispatches;
  }
}

function readQueuedEventFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeParseJson(line))
    .filter(Boolean);
}

function clearEventFile(filePath) {
  if (!filePath) {
    return;
  }
  fs.writeFileSync(filePath, "", "utf8");
}

function safeParseJson(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toMinuteKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 16);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function dispatchWithoutWaiting(dispatcher, payload) {
  if (!dispatcher || typeof dispatcher.dispatch !== "function") {
    return;
  }

  try {
    const result = dispatcher.dispatch(payload);
    if (result && typeof result.then === "function") {
      void result.catch(() => {});
    }
  } catch {
    // best effort dispatch; downstream runtime logs executor failures
  }
}

module.exports = {
  HubScheduler,
};
