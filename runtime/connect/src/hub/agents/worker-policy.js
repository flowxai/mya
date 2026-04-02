function resolveWorkerPolicy({ profile, requestedType }) {
  const allowedWorkers = normalizeWorkerList(profile?.workers);
  const normalizedRequestedType = normalizeText(requestedType);

  if (!normalizedRequestedType) {
    return {
      allowed: true,
      requestedType: "",
      allowedWorkers,
      allowedWorkerTypes: allowedWorkers,
      internalOnly: true,
    };
  }

  if (!allowedWorkers.length || !allowedWorkers.includes(normalizedRequestedType)) {
    return {
      allowed: false,
      requestedType: normalizedRequestedType,
      allowedWorkers,
      allowedWorkerTypes: allowedWorkers,
      internalOnly: true,
      reason: "requested worker type is not allowed",
      reasonCode: "worker_not_allowed",
    };
  }

  return {
    allowed: true,
    requestedType: normalizedRequestedType,
    allowedWorkers,
    allowedWorkerTypes: allowedWorkers,
    internalOnly: true,
  };
}

function normalizeWorkerList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizeText(item)).filter(Boolean);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  resolveWorkerPolicy,
};
