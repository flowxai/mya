function buildOperatorSummary({
  profileStore,
  runtimeStatus,
  taskRegistry,
  policyStore,
  auditLog,
}) {
  const profiles = safeList(profileStore);
  const activeProfiles = Array.isArray(runtimeStatus?.profiles) ? runtimeStatus.profiles : [];
  const tasks = safeList(taskRegistry);
  const policies = safeObjectList(policyStore);
  const audits = safeAuditList(auditLog);

  return {
    hubEnabled: profiles.length > 0 || activeProfiles.length > 0,
    profileCount: profiles.length,
    activeRuntimeCount: activeProfiles.length,
    taskCount: tasks.length,
    policyCount: Object.keys(policies).length,
    recentAuditCount: audits.length,
  };
}

function safeList(source) {
  if (!source || typeof source.list !== "function") {
    return [];
  }
  const value = source.list();
  return Array.isArray(value) ? value : [];
}

function safeObjectList(source) {
  if (!source || typeof source.list !== "function") {
    return {};
  }
  const value = source.list();
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeAuditList(source) {
  if (!source || typeof source.list !== "function") {
    return [];
  }
  const value = source.list(20);
  return Array.isArray(value) ? value : [];
}

module.exports = {
  buildOperatorSummary,
};
