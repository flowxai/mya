const { normalizeProfileId } = require("./profile-paths");
const { normalizeScheduleRules } = require("../scheduler/schedule-schema");

function normalizeProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new TypeError("Hub profile must be an object.");
  }
  if ("channels" in profile && !Array.isArray(profile.channels)) {
    throw new TypeError("Hub profile channels must be an array.");
  }

  const profileId = normalizeProfileId(profile.profileId);
  if (!profileId) {
    throw new TypeError("Hub profile requires a valid profileId.");
  }

  const normalizedProfile = {
    ...profile,
    profileId,
    channels: normalizeChannels(profile.channels),
    workers: normalizeStringList(profile.workers, { unique: true }),
    identity: normalizeIdentity(profile.identity),
    memoryPolicy: normalizeMemoryPolicy(profile.memoryPolicy),
    orchestration: normalizeOrchestration(profile.orchestration),
    wakePolicy: normalizeWakePolicy(profile.wakePolicy, profileId),
  };

  if (typeof normalizedProfile.name === "string") {
    normalizedProfile.name = normalizedProfile.name.trim();
  }

  if (!normalizedProfile.name) {
    normalizedProfile.name = profileId;
  }

  for (const key of [
    "defaultModel",
    "defaultEffort",
    "defaultWorkspaceRoot",
    "permissionMode",
    "baseUrl",
    "apiKey",
    "authToken",
  ]) {
    if (key in normalizedProfile) {
      normalizedProfile[key] = normalizeText(normalizedProfile[key]);
    }
  }

  if ("workspaceAllowlist" in normalizedProfile) {
    normalizedProfile.workspaceAllowlist = normalizeStringList(normalizedProfile.workspaceAllowlist, {
      unique: true,
    });
  }

  return normalizedProfile;
}

function parseProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return null;
  }

  try {
    return normalizeProfile(profile);
  } catch {
    return null;
  }
}

module.exports = {
  normalizeProfile,
  parseProfile,
};

function normalizeChannels(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((channel) => normalizeChannel(channel))
    .filter(Boolean);
}

function normalizeChannel(channel) {
  if (!channel || typeof channel !== "object" || Array.isArray(channel)) {
    return null;
  }

  const type = normalizeText(channel.type).toLowerCase();
  if (!type) {
    return null;
  }

  const normalizedChannel = {
    ...channel,
    type,
  };

  for (const key of [
    "appId",
    "appSecret",
    "accountId",
    "channelId",
    "defaultWorkspaceRoot",
    "defaultWorkspaceId",
    "permissionMode",
    "defaultModel",
    "defaultEffort",
    "myaCommand",
  ]) {
    if (key in normalizedChannel) {
      normalizedChannel[key] = normalizeText(normalizedChannel[key]);
    }
  }

  if ("workspaceAllowlist" in normalizedChannel) {
    normalizedChannel.workspaceAllowlist = normalizeStringList(normalizedChannel.workspaceAllowlist, {
      unique: true,
    });
  }

  return normalizedChannel;
}

function normalizeMemoryPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const inheritanceMode = normalizeText(value.inheritanceMode);
  const scope = normalizeText(value.scope);
  const normalized = {};

  if (inheritanceMode) {
    normalized.inheritanceMode = inheritanceMode;
  }
  if (scope) {
    normalized.scope = scope;
  }

  return normalized;
}

function normalizeIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized = {};
  for (const key of ["status", "role", "purpose", "style", "description", "ownerAddress", "language"]) {
    const text = normalizeText(value[key]);
    if (text) {
      normalized[key] = text;
    }
  }
  return normalized;
}

function normalizeOrchestration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized = {};
  const defaultWorkerType = normalizeText(value.defaultWorkerType);
  if (defaultWorkerType) {
    normalized.defaultWorkerType = defaultWorkerType;
  }
  if (typeof value.runInBackground === "boolean") {
    normalized.runInBackground = value.runInBackground;
  }

  return normalized;
}

function normalizeWakePolicy(value, profileId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const providedSchedules = Array.isArray(value.schedules) ? value.schedules : [];
  const schedules = normalizeScheduleRules(
    providedSchedules.map((rule) => ({
      profileId,
      ...rule,
      profileId: normalizeText(rule?.profileId) || profileId,
    })),
  );
  if (providedSchedules.length > 0 && schedules.length === 0) {
    throw new TypeError("Hub profile wakePolicy.schedules must contain at least one valid rule.");
  }

  return {
    schedules,
    events: normalizeStringList(value.events, { unique: true }),
  };
}

function normalizeStringList(value, options = {}) {
  if (!Array.isArray(value)) {
    return [];
  }

  const items = value.map((item) => normalizeText(item)).filter(Boolean);
  if (options.unique !== true) {
    return items;
  }

  return Array.from(new Set(items));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}
