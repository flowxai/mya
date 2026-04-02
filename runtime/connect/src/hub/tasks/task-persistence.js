const fs = require("fs");
const path = require("path");
const {
  getHubStateRoot,
} = require("../../shared/runtime-paths");

function getDefaultHubTasksFilePath() {
  return path.join(getHubStateRoot(), "tasks", "registry.json");
}

class TaskPersistence {
  constructor(options = {}) {
    this.filePath = options.filePath || getDefaultHubTasksFilePath();
    this.ensureParentDirectory();
  }

  ensureParentDirectory() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  save(tasks) {
    this.ensureParentDirectory();
    fs.writeFileSync(this.filePath, JSON.stringify(Array.isArray(tasks) ? tasks : [], null, 2));
  }
}

module.exports = {
  TaskPersistence,
  getDefaultHubTasksFilePath,
};
