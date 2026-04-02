const { resolveWorkerPolicy } = require("./worker-policy");

function resolveProfileRunContext({
  profile,
  requestedType = "",
  inheritedMemoryNamespace = "",
  workspaceRoot = "",
} = {}) {
  const profileId = normalizeText(profile?.profileId || profile?.id);
  const memoryPolicy = isRecord(profile?.memoryPolicy) ? profile.memoryPolicy : {};
  const memoryInheritanceMode = normalizeText(memoryPolicy.inheritanceMode) || "profile";
  const orchestration = isRecord(profile?.orchestration) ? profile.orchestration : {};
  const effectiveRequestedType = normalizeText(requestedType) || normalizeText(orchestration.defaultWorkerType);
  const workerPolicy = resolveWorkerPolicy({
    profile,
    requestedType: effectiveRequestedType,
  });

  return {
    profileId,
    workspaceRoot: normalizeText(workspaceRoot),
    model: normalizeText(profile?.defaultModel),
    effort: normalizeText(profile?.defaultEffort),
    baseUrl: normalizeText(profile?.baseUrl),
    apiKey: normalizeText(profile?.apiKey),
    authToken: normalizeText(profile?.authToken),
    permissionMode: normalizeText(profile?.permissionMode) || "default",
    workerPolicy,
    memoryInheritanceMode,
    memoryNamespace: resolveMemoryNamespace({
      profileId,
      memoryInheritanceMode,
      inheritedMemoryNamespace,
    }),
  };
}

function resolveMemoryNamespace({ profileId, memoryInheritanceMode, inheritedMemoryNamespace }) {
  if (memoryInheritanceMode === "inherit") {
    const inherited = normalizeText(inheritedMemoryNamespace);
    if (inherited) {
      return inherited;
    }
  }

  if (!profileId) {
    return "";
  }

  return `profiles/${profileId}`;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  buildProfileRunContext: resolveProfileRunContext,
  resolveProfileRunContext,
};
