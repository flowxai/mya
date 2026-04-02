const crypto = require("crypto");

const { TaskPersistence } = require("./task-persistence");

class TaskRegistry {
  constructor(options = {}) {
    this.persistence = options.persistence || new TaskPersistence({ filePath: options.filePath });
    this.tasks = new Map();

    for (const task of normalizeTaskList(this.persistence.load())) {
      this.tasks.set(task.taskId, task);
    }
  }

  list() {
    return Array.from(this.tasks.values())
      .map((task) => ({ ...task }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  get(taskId) {
    const normalizedTaskId = normalizeText(taskId);
    if (!normalizedTaskId) {
      return null;
    }
    const task = this.tasks.get(normalizedTaskId);
    return task ? { ...task } : null;
  }

  create(input) {
    const now = new Date().toISOString();
    const task = normalizeTask({
      ...input,
      taskId: normalizeText(input?.taskId) || crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    this.tasks.set(task.taskId, task);
    this.save();
    return { ...task };
  }

  recordDispatch(input) {
    return this.create({
      ...input,
      taskType: normalizeText(input?.taskType) || "background_run",
      state: normalizeText(input?.state) || "queued",
    });
  }

  update(taskId, patch) {
    const current = this.get(taskId);
    if (!current) {
      return null;
    }

    const updated = normalizeTask({
      ...current,
      ...patch,
      taskId: current.taskId,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    });
    this.tasks.set(updated.taskId, updated);
    this.save();
    return { ...updated };
  }

  markRunning(taskId, patch = {}) {
    return this.update(taskId, {
      ...patch,
      state: "running",
    });
  }

  markCompleted(taskId, patch = {}) {
    return this.update(taskId, {
      ...patch,
      state: "completed",
    });
  }

  markFailed(taskId, patch = {}) {
    return this.update(taskId, {
      ...patch,
      state: "failed",
    });
  }

  startRun(input = {}) {
    const taskId = normalizeText(input.taskId);
    if (!taskId) {
      return null;
    }

    if (!this.get(taskId)) {
      return this.create({
        ...input,
        taskId,
        state: "running",
      });
    }

    return this.markRunning(taskId, input);
  }

  updateRun(taskId, patch = {}) {
    return this.update(taskId, patch);
  }

  completeRun(taskId, patch = {}) {
    return this.markCompleted(taskId, patch);
  }

  failRun(taskId, patch = {}) {
    return this.markFailed(taskId, patch);
  }

  getResumeTarget(taskId) {
    const task = this.get(taskId);
    if (!task || !task.resumableSessionId || !task.workspaceRoot) {
      return null;
    }
    return task;
  }

  save() {
    this.persistence.save(this.list());
  }
}

function normalizeTaskList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((task) => normalizeTask(task)).filter(Boolean);
}

function normalizeTask(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    return null;
  }

  const taskId = normalizeText(task.taskId);
  if (!taskId) {
    return null;
  }

  return {
    taskId,
    profileId: normalizeText(task.profileId),
    trigger: normalizeText(task.trigger),
    workspaceRoot: normalizeText(task.workspaceRoot),
    taskType: normalizeText(task.taskType) || "background_run",
    state: normalizeText(task.state) || "queued",
    resumableSessionId: normalizeText(task.resumableSessionId),
    lastOutputSummary: normalizeText(task.lastOutputSummary),
    createdAt: normalizeText(task.createdAt) || new Date().toISOString(),
    updatedAt: normalizeText(task.updatedAt) || new Date().toISOString(),
  };
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  HubTaskRegistry: TaskRegistry,
  TaskRegistry,
};
