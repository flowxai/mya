const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  getHubStateRoot,
} = require("../../shared/runtime-paths");

function getDefaultAuditLogPath() {
  return path.join(getHubStateRoot(), "audit.log");
}

class AuditLog {
  constructor(options = {}) {
    this.filePath = options.filePath || getDefaultAuditLogPath();
    this.ensureParentDirectory();
  }

  ensureParentDirectory() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  append(event) {
    const entry = normalizeAuditEntry(event);
    fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`);
    return entry;
  }

  list(limit = 100) {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const entries = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => safeParseJson(line))
        .filter(Boolean);
      if (limit <= 0) {
        return entries;
      }
      return entries.slice(-limit);
    } catch {
      return [];
    }
  }
}

function normalizeAuditEntry(event) {
  const record = isRecord(event) ? event : {};
  return {
    eventId: normalizeText(record.eventId) || crypto.randomUUID(),
    timestamp: normalizeText(record.timestamp) || new Date().toISOString(),
    type: normalizeText(record.type),
    profileId: normalizeText(record.profileId),
    actor: normalizeText(record.actor),
    taskId: normalizeText(record.taskId),
    detail: normalizeText(record.detail),
  };
}

function safeParseJson(value) {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  AuditLog,
  getDefaultAuditLogPath,
};
