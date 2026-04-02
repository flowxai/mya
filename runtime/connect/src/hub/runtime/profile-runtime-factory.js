function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isChannelEnabled(channel) {
  return Boolean(channel) && channel.enabled !== false;
}

function getChannelAccountId(channel, channelIndex) {
  const candidates = [
    channel?.channelId,
    channel?.accountId,
    channel?.appId,
    channel?.runtimeId,
    channel?.id,
    channel?.name,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeText(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return `channel-${channelIndex + 1}`;
}

function buildRuntimeKey(profileId, type, accountId) {
  return [normalizeText(profileId), normalizeText(type), normalizeText(accountId)].join(":");
}

class ProfileRuntimeFactory {
  constructor(options = {}) {
    this.builders = new Map();

    const builders = options.builders || {};
    for (const [type, builder] of Object.entries(builders)) {
      this.register(type, builder);
    }
  }

  register(type, builder) {
    const normalizedType = normalizeText(type).toLowerCase();
    if (!normalizedType) {
      throw new TypeError("Profile runtime factory requires a channel type.");
    }
    if (typeof builder !== "function") {
      throw new TypeError(`Profile runtime factory builder for "${normalizedType}" must be a function.`);
    }

    this.builders.set(normalizedType, builder);
    return this;
  }

  createProfileRuntimes(profile) {
    const profileId = normalizeText(profile?.profileId || profile?.id);
    if (!profileId) {
      return [];
    }

    const channels = Array.isArray(profile?.channels) ? profile.channels : [];

    return channels
      .map((channel, channelIndex) => this.createChannelRuntime({ profile, profileId, channel, channelIndex }))
      .filter(Boolean);
  }

  createChannelRuntime({ profile, profileId, channel, channelIndex }) {
    if (!isChannelEnabled(channel)) {
      return null;
    }

    const type = normalizeText(channel?.type).toLowerCase();
    if (!type) {
      return null;
    }

    const builder = this.builders.get(type);
    if (!builder) {
      return null;
    }

    const accountId = getChannelAccountId(channel, channelIndex);
    const built = builder({
      profile,
      profileId,
      channel,
      channelIndex,
      type,
      accountId,
      key: buildRuntimeKey(profileId, type, accountId),
    });
    const builtDefinition = built && built.runtime ? built : { runtime: built };

    if (!builtDefinition?.runtime) {
      throw new TypeError(`Profile runtime builder for "${type}" must return a runtime instance.`);
    }

    const key = normalizeText(builtDefinition.key) || buildRuntimeKey(profileId, type, accountId);

    return {
      ...builtDefinition,
      key,
      profileId,
      type,
      accountId: normalizeText(builtDefinition.accountId) || accountId,
      channelIndex,
      profile,
      channel,
      runtime: builtDefinition.runtime,
    };
  }
}

module.exports = {
  ProfileRuntimeFactory,
  buildRuntimeKey,
  getChannelAccountId,
  isChannelEnabled,
};
