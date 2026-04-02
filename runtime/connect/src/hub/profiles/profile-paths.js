const path = require("path");
const {
  getHubProfilesRoot,
} = require("../../shared/runtime-paths");

function normalizeProfileId(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function resolveProfilesRoot(options = {}) {
  const explicitProfilesRoot = typeof options.profilesRoot === "string" ? options.profilesRoot.trim() : "";
  if (explicitProfilesRoot) {
    return explicitProfilesRoot;
  }
  return getHubProfilesRoot(options);
}

function resolveProfileDirectory(profileId, options = {}) {
  return path.join(resolveProfilesRoot(options), normalizeProfileId(profileId));
}

function resolveProfilePath(profileId, options = {}) {
  return path.join(resolveProfileDirectory(profileId, options), "profile.json");
}

module.exports = {
  normalizeProfileId,
  resolveProfileDirectory,
  resolveProfilePath,
  resolveProfilesRoot,
};
