const fs = require("fs");
const path = require("path");

const {
  resolveProfileDirectory,
} = require("./profile-paths");

const BOT_INSTRUCTIONS_FILE = "BOT.md";

function resolveBotInstructionsPath(profileId, options = {}) {
  return path.join(
    resolveProfileDirectory(profileId, options),
    BOT_INSTRUCTIONS_FILE,
  );
}

function ensureBotInstructionsFile(profile, options = {}) {
  const filePath = resolveBotInstructionsPath(profile?.profileId, options);
  if (fs.existsSync(filePath)) {
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
    "This file works like a bot-specific CLAUDE.md.",
    "Keep it concise. Write durable instructions that should apply every time this bot runs.",
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
    "## Notes",
    "- Edit this file directly to teach the bot how it should behave.",
  ].join("\n");
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

module.exports = {
  BOT_INSTRUCTIONS_FILE,
  buildDefaultBotInstructions,
  ensureBotInstructionsFile,
  resolveBotInstructionsPath,
};
