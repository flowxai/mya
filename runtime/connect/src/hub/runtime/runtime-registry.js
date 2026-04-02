class RuntimeRegistry {
  constructor() {
    this.entries = new Map();
  }

  get size() {
    return this.entries.size;
  }

  has(key) {
    return this.entries.has(String(key));
  }

  get(key) {
    const entry = this.entries.get(String(key));
    return entry ? { ...entry } : null;
  }

  list() {
    return Array.from(this.entries.values())
      .map((entry) => ({ ...entry }))
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  async reconcile(definitions) {
    const desiredEntries = new Map();
    const normalizedDefinitions = Array.isArray(definitions) ? definitions.filter(Boolean) : [];

    for (const definition of normalizedDefinitions) {
      if (!definition?.key) {
        throw new TypeError("Runtime definitions require a key.");
      }
      if (!definition.runtime) {
        throw new TypeError(`Runtime definition "${definition.key}" requires a runtime instance.`);
      }
      if (desiredEntries.has(definition.key)) {
        throw new Error(`Duplicate runtime definition key "${definition.key}".`);
      }

      desiredEntries.set(definition.key, definition);
    }

    const stopped = [];
    for (const [key, entry] of this.entries) {
      if (desiredEntries.has(key)) {
        continue;
      }

      await this.stopEntry(entry);
      this.entries.delete(key);
      stopped.push({ ...entry });
    }

    const started = [];
    for (const definition of normalizedDefinitions) {
      if (this.entries.has(definition.key)) {
        const current = this.entries.get(definition.key);
        this.entries.set(definition.key, {
          ...current,
          ...definition,
          runtime: current.runtime,
          state: current.state || "running",
        });
        continue;
      }

      const entry = {
        ...definition,
        state: "starting",
      };
      await this.startEntry(entry);
      this.entries.set(entry.key, entry);
      started.push({ ...entry });
    }

    return {
      started,
      stopped,
      active: this.list(),
    };
  }

  async stopAll() {
    const stopped = [];

    for (const [key, entry] of this.entries) {
      await this.stopEntry(entry);
      this.entries.delete(key);
      stopped.push({ ...entry });
    }

    return {
      started: [],
      stopped,
      active: [],
    };
  }

  async startEntry(entry) {
    try {
      if (typeof entry.runtime.start === "function") {
        await entry.runtime.start();
      }
      entry.state = "running";
    } catch (error) {
      entry.state = "failed";
      entry.lastError = error;
      throw error;
    }
  }

  async stopEntry(entry) {
    try {
      if (typeof entry.runtime.stop === "function") {
        await entry.runtime.stop();
      }
      entry.state = "stopped";
    } catch (error) {
      entry.state = "failed";
      entry.lastError = error;
      throw error;
    }
  }
}

module.exports = {
  RuntimeRegistry,
};
