const fs = require("fs");
const path = require("path");
const {
  getHubStateRoot,
} = require("../../shared/runtime-paths");

function getDefaultPolicyStorePath() {
  return path.join(getHubStateRoot(), "policies.json");
}

class PolicyStore {
  constructor(options = {}) {
    this.filePath = options.filePath || getDefaultPolicyStorePath();
    this.ensureParentDirectory();
    this.state = this.load();
  }

  ensureParentDirectory() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  save() {
    this.ensureParentDirectory();
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  list() {
    return { ...this.state };
  }

  get(profileId) {
    const normalizedProfileId = normalizeText(profileId);
    if (!normalizedProfileId) {
      return null;
    }
    const policy = this.state[normalizedProfileId];
    return policy ? { ...policy } : null;
  }

  set(profileId, policy) {
    const normalizedProfileId = normalizeText(profileId);
    if (!normalizedProfileId) {
      throw new Error("PolicyStore requires a profileId");
    }

    this.state[normalizedProfileId] = normalizePolicy(policy);
    this.save();
    return this.get(normalizedProfileId);
  }
}

function normalizePolicy(value) {
  const policy = isRecord(value) ? value : {};
  return {
    allowedUsers: normalizeStringList(policy.allowedUsers),
    allowedChats: normalizeStringList(policy.allowedChats),
    workspaceAllowlist: normalizeStringList(policy.workspaceAllowlist),
    defaultPermissionMode: normalizeText(policy.defaultPermissionMode),
    wakeEnabled: policy.wakeEnabled !== false,
    workersEnabled: policy.workersEnabled !== false,
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizeText(item)).filter(Boolean);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  PolicyStore,
  getDefaultPolicyStorePath,
};
