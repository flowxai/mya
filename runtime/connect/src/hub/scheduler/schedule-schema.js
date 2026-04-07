const path = require("path");

function normalizeScheduleRule(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    return null;
  }

  const profileId = normalizeText(rule.profileId);
  const kind = normalizeText(rule.kind) || "schedule";
  if (!profileId) {
    return null;
  }
  if (kind !== "schedule" && kind !== "event_file") {
    return null;
  }

  const normalizedRule = {
    profileId,
    kind,
    workspaceRoot: normalizeText(rule.workspaceRoot),
    cron: normalizeText(rule.cron),
    eventFile: normalizeEventFile(rule.eventFile),
    prompt: normalizeText(rule.prompt),
    command: normalizeText(rule.command),
    workerType: normalizeText(rule.workerType),
    taskType: normalizeText(rule.taskType),
    notification: normalizeNotification(rule.notification),
    metadata: isRecord(rule.metadata) ? { ...rule.metadata } : {},
    enabled: rule.enabled !== false,
  };

  if (kind === "schedule" && !normalizedRule.cron) {
    return null;
  }
  if (kind === "event_file" && !normalizedRule.eventFile) {
    return null;
  }

  return normalizedRule;
}

function normalizeScheduleRules(rules) {
  if (!Array.isArray(rules)) {
    return [];
  }
  return rules.map((rule) => normalizeScheduleRule(rule)).filter(Boolean);
}

function matchesCronDate(cronExpression, date) {
  const cron = normalizeText(cronExpression);
  if (!cron) {
    return false;
  }

  const fields = cron.split(/\s+/);
  if (fields.length !== 5) {
    return false;
  }

  const currentDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(currentDate.getTime())) {
    return false;
  }

  const localMinute = currentDate.getMinutes();
  const localHour = currentDate.getHours();
  const localDayOfMonth = currentDate.getDate();
  const localMonth = currentDate.getMonth() + 1;
  const localDayOfWeek = currentDate.getDay();

  return (
    matchesCronField(fields[0], localMinute, 0, 59)
    && matchesCronField(fields[1], localHour, 0, 23)
    && matchesCronField(fields[2], localDayOfMonth, 1, 31)
    && matchesCronField(fields[3], localMonth, 1, 12)
    && matchesCronField(fields[4], localDayOfWeek, 0, 6)
  );
}

function matchesCronField(field, value, min, max) {
  const normalized = normalizeText(field);
  if (!normalized || normalized === "*") {
    return true;
  }

  return normalized.split(",").some((part) => {
    const trimmed = normalizeText(part);
    if (!trimmed) {
      return false;
    }
    if (trimmed.startsWith("*/")) {
      const step = Number.parseInt(trimmed.slice(2), 10);
      return Number.isInteger(step) && step > 0 && value % step === 0;
    }

    const numeric = Number.parseInt(trimmed, 10);
    return Number.isInteger(numeric) && numeric >= min && numeric <= max && numeric === value;
  });
}

function normalizeEventFile(value) {
  const normalized = normalizeText(value);
  return normalized ? path.resolve(normalized) : "";
}

function normalizeNotification(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized = {};
  for (const key of [
    "runtimeKey",
    "channelType",
    "accountId",
    "bindingKey",
    "workspaceRoot",
    "userId",
    "contextToken",
    "chatId",
  ]) {
    const text = normalizeText(value[key]);
    if (text) {
      normalized[key] = text;
    }
  }
  return normalized;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  matchesCronDate,
  normalizeScheduleRule,
  normalizeScheduleRules,
};
