const fs = require("fs");

const { normalizeProfile, parseProfile } = require("./profile-schema");
const {
  normalizeProfileId,
  resolveProfileDirectory,
  resolveProfilePath,
  resolveProfilesRoot,
} = require("./profile-paths");

class HubProfileStore {
  constructor(options = {}) {
    this.profilesRoot = resolveProfilesRoot(options);
  }

  ensureProfilesRoot() {
    fs.mkdirSync(this.profilesRoot, { recursive: true });
  }

  save(profile) {
    const normalizedProfile = normalizeProfile(profile);
    const profileDirectory = resolveProfileDirectory(normalizedProfile.profileId, {
      profilesRoot: this.profilesRoot,
    });
    const filePath = resolveProfilePath(normalizedProfile.profileId, {
      profilesRoot: this.profilesRoot,
    });

    fs.mkdirSync(profileDirectory, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(normalizedProfile, null, 2), "utf8");
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // best effort
    }

    return normalizedProfile;
  }

  get(profileId) {
    const normalizedProfileId = normalizeProfileId(profileId);
    if (!normalizedProfileId) {
      return null;
    }

    try {
      const filePath = resolveProfilePath(normalizedProfileId, {
        profilesRoot: this.profilesRoot,
      });
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const profile = parseProfile(parsed);
      if (!profile || profile.profileId !== normalizedProfileId) {
        return null;
      }

      return profile;
    } catch {
      return null;
    }
  }

  list() {
    this.ensureProfilesRoot();

    return fs.readdirSync(this.profilesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.get(entry.name))
      .filter(Boolean)
      .sort((left, right) => left.profileId.localeCompare(right.profileId));
  }

  remove(profileId) {
    const normalizedProfileId = normalizeProfileId(profileId);
    if (!normalizedProfileId) {
      return false;
    }

    const profileDirectory = resolveProfileDirectory(normalizedProfileId, {
      profilesRoot: this.profilesRoot,
    });
    if (!fs.existsSync(profileDirectory)) {
      return false;
    }

    try {
      fs.rmSync(profileDirectory, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = {
  HubProfileStore,
};
