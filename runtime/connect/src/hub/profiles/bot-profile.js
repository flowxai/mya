const { resolveConnectPermissionMode } = require("../../shared/settings");
const { normalizeProfile, parseProfile } = require("./profile-schema");
const { normalizeProfileId } = require("./profile-paths");

const DEFAULT_BOT_NAME = "default";

function buildDefaultBotProfile({
  name,
  workspaceRoot,
  permissionMode = "",
  settings,
} = {}) {
  const trimmedName = normalizeText(name);
  const profileId = normalizeProfileId(trimmedName);
  if (!profileId) {
    throw new TypeError("Bot name is required.");
  }

  const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    throw new TypeError("Bot workspaceRoot is required.");
  }

  return normalizeProfile({
    profileId,
    name: trimmedName || profileId,
    channels: [],
    defaultWorkspaceRoot: normalizedWorkspaceRoot,
    workspaceAllowlist: [normalizedWorkspaceRoot],
    permissionMode: resolveConnectPermissionMode({
      explicitValues: [permissionMode],
      settings,
      fallback: "default",
    }),
    memoryPolicy: {
      inheritanceMode: "profile",
      scope: "bot",
    },
    identity: {
      status: "bootstrap",
      role: "",
      purpose: "",
      style: "",
      ownerAddress: "",
      language: "中文",
    },
  });
}

function ensureBotProfile(store, {
  name = DEFAULT_BOT_NAME,
  workspaceRoot = process.cwd(),
  settings,
} = {}) {
  if (!store || typeof store.get !== "function" || typeof store.save !== "function") {
    throw new TypeError("ensureBotProfile requires a profile store.");
  }

  const requestedName = normalizeText(name) || DEFAULT_BOT_NAME;
  const profileId = normalizeProfileId(requestedName);
  let profile = store.get(profileId);
  let created = false;

  if (!profile) {
    profile = store.save(buildDefaultBotProfile({
      name: requestedName,
      workspaceRoot,
      settings,
    }));
    created = true;
  }

  return {
    created,
    profile,
    profileId,
  };
}

function bindWechatChannel(store, targetProfileId, {
  accountId,
} = {}) {
  const normalizedTargetProfileId = normalizeProfileId(targetProfileId);
  const normalizedAccountId = normalizeText(accountId);
  if (!normalizedTargetProfileId) {
    throw new TypeError("bindWechatChannel requires a target profileId.");
  }
  if (!normalizedAccountId) {
    throw new TypeError("bindWechatChannel requires an accountId.");
  }

  const profiles = typeof store.list === "function" ? store.list() : [];
  const reassignedFrom = [];
  let targetProfile = null;

  for (const current of profiles) {
    const parsed = parseProfile(current);
    if (!parsed) {
      continue;
    }

    if (parsed.profileId === normalizedTargetProfileId) {
      targetProfile = parsed;
      continue;
    }

    const filteredChannels = (Array.isArray(parsed.channels) ? parsed.channels : [])
      .filter((channel) => normalizeText(channel?.type).toLowerCase() !== "wechat");
    if (filteredChannels.length !== (Array.isArray(parsed.channels) ? parsed.channels.length : 0)) {
      reassignedFrom.push(parsed.profileId);
      store.save({
        ...parsed,
        channels: filteredChannels,
      });
    }
  }

  if (!targetProfile) {
    targetProfile = store.get(normalizedTargetProfileId);
  }
  if (!targetProfile) {
    throw new Error(`Bot not found: ${normalizedTargetProfileId}`);
  }

  const existingWechat = (Array.isArray(targetProfile.channels) ? targetProfile.channels : [])
    .find((channel) => normalizeText(channel?.type).toLowerCase() === "wechat");
  const preserved = existingWechat && typeof existingWechat === "object" ? existingWechat : {};
  const mergedChannel = {
    ...preserved,
    type: "wechat",
    accountId: normalizedAccountId,
    defaultWorkspaceRoot: normalizeText(
      preserved.defaultWorkspaceRoot || targetProfile.defaultWorkspaceRoot || targetProfile.workspaceAllowlist?.[0]
    ),
    permissionMode: normalizeText(preserved.permissionMode || targetProfile.permissionMode),
  };

  const nextChannels = (Array.isArray(targetProfile.channels) ? targetProfile.channels : [])
    .filter((channel) => normalizeText(channel?.type).toLowerCase() !== "wechat");
  nextChannels.push(mergedChannel);

  const savedProfile = store.save({
    ...targetProfile,
    channels: nextChannels,
  });

  return {
    profile: savedProfile,
    reassignedFrom,
  };
}

function bindFeishuChannel(store, targetProfileId, {
  appId,
  appSecret,
} = {}) {
  const normalizedTargetProfileId = normalizeProfileId(targetProfileId);
  const normalizedAppId = normalizeText(appId);
  const normalizedAppSecret = normalizeText(appSecret);
  if (!normalizedTargetProfileId) {
    throw new TypeError("bindFeishuChannel requires a target profileId.");
  }
  if (!normalizedAppId || !normalizedAppSecret) {
    throw new TypeError("bindFeishuChannel requires appId and appSecret.");
  }

  const profiles = typeof store.list === "function" ? store.list() : [];
  const reassignedFrom = [];
  let targetProfile = null;

  for (const current of profiles) {
    const parsed = parseProfile(current);
    if (!parsed) {
      continue;
    }

    if (parsed.profileId === normalizedTargetProfileId) {
      targetProfile = parsed;
      continue;
    }

    const filteredChannels = (Array.isArray(parsed.channels) ? parsed.channels : [])
      .filter((channel) => {
        const type = normalizeText(channel?.type).toLowerCase();
        const channelAppId = normalizeText(channel?.appId || channel?.accountId);
        return type !== "feishu" || channelAppId !== normalizedAppId;
      });
    if (filteredChannels.length !== (Array.isArray(parsed.channels) ? parsed.channels.length : 0)) {
      reassignedFrom.push(parsed.profileId);
      store.save({
        ...parsed,
        channels: filteredChannels,
      });
    }
  }

  if (!targetProfile) {
    targetProfile = store.get(normalizedTargetProfileId);
  }
  if (!targetProfile) {
    throw new Error(`Bot not found: ${normalizedTargetProfileId}`);
  }

  const existingFeishu = (Array.isArray(targetProfile.channels) ? targetProfile.channels : [])
    .find((channel) => normalizeText(channel?.type).toLowerCase() === "feishu");
  const preserved = existingFeishu && typeof existingFeishu === "object" ? existingFeishu : {};
  const mergedChannel = {
    ...preserved,
    type: "feishu",
    appId: normalizedAppId,
    appSecret: normalizedAppSecret,
    defaultWorkspaceRoot: normalizeText(
      preserved.defaultWorkspaceRoot || targetProfile.defaultWorkspaceRoot || targetProfile.workspaceAllowlist?.[0]
    ),
    permissionMode: normalizeText(preserved.permissionMode || targetProfile.permissionMode),
  };

  const nextChannels = (Array.isArray(targetProfile.channels) ? targetProfile.channels : [])
    .filter((channel) => normalizeText(channel?.type).toLowerCase() !== "feishu");
  nextChannels.push(mergedChannel);

  const savedProfile = store.save({
    ...targetProfile,
    channels: nextChannels,
  });

  return {
    profile: savedProfile,
    replacedExisting: Boolean(existingFeishu),
    reassignedFrom,
  };
}

function hasConfiguredBotIdentity(profile) {
  const parsed = parseProfile(profile);
  if (!parsed) {
    return false;
  }

  const identity = isRecord(parsed.identity) ? parsed.identity : {};
  return Boolean(
    normalizeText(identity.role) ||
      normalizeText(identity.purpose) ||
      normalizeText(parsed.role) ||
      normalizeText(parsed.purpose) ||
      normalizeText(parsed.description),
  );
}

function getBotWorkspaceRoot(profile) {
  const parsed = parseProfile(profile);
  if (!parsed) {
    return "";
  }

  return normalizeText(parsed.defaultWorkspaceRoot)
    || normalizeText(parsed.workspaceAllowlist?.[0]);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  DEFAULT_BOT_NAME,
  bindFeishuChannel,
  bindWechatChannel,
  buildDefaultBotProfile,
  ensureBotProfile,
  getBotWorkspaceRoot,
  hasConfiguredBotIdentity,
};
