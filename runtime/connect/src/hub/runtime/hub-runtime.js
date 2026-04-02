const { RuntimeRegistry } = require("./runtime-registry");
const { ProfileRuntimeFactory } = require("./profile-runtime-factory");
const { normalizeScheduleRules } = require("../scheduler/schedule-schema");

class HubRuntime {
  constructor(options = {}) {
    this.profileStore = options.profileStore;
    this.runtimeRegistry = options.runtimeRegistry || new RuntimeRegistry();
    this.profileRuntimeFactory =
      options.profileRuntimeFactory || new ProfileRuntimeFactory(options.profileRuntimeFactoryOptions);
    this.scheduler = options.scheduler || null;
  }

  async start() {
    return this.refresh();
  }

  async refresh() {
    const profiles = this.listProfiles();
    this.loadWakeRules(profiles);
    const definitions = profiles.flatMap((profile) => this.profileRuntimeFactory.createProfileRuntimes(profile));

    return this.runtimeRegistry.reconcile(definitions);
  }

  async tick(now = new Date()) {
    await this.refresh();
    const dispatches = this.scheduler && typeof this.scheduler.tick === "function"
      ? await this.scheduler.tick(now)
      : [];
    return Array.isArray(dispatches) ? dispatches : [];
  }

  async runSchedulerTick(now = new Date()) {
    return this.tick(now);
  }

  status() {
    return this.runtimeRegistry.list();
  }

  async stop() {
    return this.runtimeRegistry.stopAll();
  }

  listProfiles() {
    if (!this.profileStore || typeof this.profileStore.list !== "function") {
      throw new TypeError("Hub runtime requires a profile store with a list() method.");
    }

    const profiles = this.profileStore.list();
    return Array.isArray(profiles) ? profiles.filter(Boolean) : [];
  }

  loadWakeRules(profiles = this.listProfiles()) {
    if (!this.scheduler || typeof this.scheduler.load !== "function") {
      return [];
    }

    const rules = collectHubScheduleRules(profiles);
    this.scheduler.load(rules);
    return rules;
  }
}

function collectHubScheduleRules(profiles) {
  if (!Array.isArray(profiles)) {
    return [];
  }

  const rules = [];
  for (const profile of profiles) {
    const profileId = normalizeText(profile?.profileId || profile?.id);
    const wakePolicy = isRecord(profile?.wakePolicy) ? profile.wakePolicy : {};
    const schedules = Array.isArray(wakePolicy.schedules) ? wakePolicy.schedules : [];

    for (const schedule of schedules) {
      if (!isRecord(schedule) || schedule.enabled === false) {
        continue;
      }
      rules.push({
        ...schedule,
        profileId: normalizeText(schedule.profileId) || profileId,
      });
    }
  }

  return normalizeScheduleRules(rules).map((rule) => stripEmptyScheduleFields(rule));
}

function stripEmptyScheduleFields(rule) {
  const normalizedRule = {};
  for (const [key, value] of Object.entries(rule || {})) {
    if (key === "enabled") {
      continue;
    }
    if (typeof value === "string" && !value.trim()) {
      continue;
    }
    if (isRecord(value) && Object.keys(value).length === 0) {
      continue;
    }
    normalizedRule[key] = value;
  }
  return normalizedRule;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function createHubRuntime(options) {
  return new HubRuntime(options);
}

module.exports = {
  HubRuntime,
  collectHubScheduleRules,
  createHubRuntime,
};
