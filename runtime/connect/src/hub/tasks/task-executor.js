const { MyaStreamTurn } = require("../../infra/mya/stream-turn");

class HubTaskExecutor {
  constructor(options = {}) {
    this.taskRegistry = options.taskRegistry || options.registry;
    this.profileStore = options.profileStore || null;
    this.auditLog = options.auditLog || null;
    this.concurrency = Number.isInteger(options.concurrency) && options.concurrency > 0 ? options.concurrency : 1;
    this.queue = [];
    this.activeRuns = new Map();
    this.pumpPromise = null;
    const turnFactory = typeof options.turnFactory === "function"
      ? options.turnFactory
      : (config) => new MyaStreamTurn(config, {
        ...(typeof options.spawn === "function" ? { spawn: options.spawn } : {}),
        ...(typeof options.eventSink === "function" ? { eventSink: options.eventSink } : {}),
      });
    this.runTask = typeof options.runTask === "function"
      ? options.runTask
      : buildDefaultRunTask({
        profileStore: this.profileStore,
        turnFactory,
      });
  }

  async dispatch(payload) {
    const task = this.ensureTask(payload);
    return this.executeTask({
      ...payload,
      taskId: task.taskId,
    });
  }

  enqueue(payload) {
    const task = this.ensureTask(payload);
    this.queue.push({
      ...payload,
      taskId: task.taskId,
    });
    this.kickPump();
    return task;
  }

  async waitForIdle() {
    while (this.queue.length > 0 || this.activeRuns.size > 0 || this.pumpPromise) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(10);
    }
  }

  async stop() {
    await this.waitForIdle();
  }

  ensureTask(payload = {}) {
    const taskId = normalizeText(payload.taskId);
    if (taskId) {
      const existing = this.taskRegistry?.get(taskId);
      if (existing) {
        return existing;
      }
    }

    return this.taskRegistry.recordDispatch({
      taskId,
      profileId: normalizeText(payload.profileId),
      trigger: normalizeText(payload.trigger) || "manual",
      workspaceRoot: normalizeText(payload.workspaceRoot),
      taskType: normalizeText(payload.taskType) || "background_run",
    });
  }

  kickPump() {
    if (this.pumpPromise) {
      return;
    }
    this.pumpPromise = this.pumpQueue()
      .finally(() => {
        this.pumpPromise = null;
        if (this.queue.length > 0) {
          this.kickPump();
        }
      });
  }

  async pumpQueue() {
    while (this.queue.length > 0 && this.activeRuns.size < this.concurrency) {
      const payload = this.queue.shift();
      const promise = this.executeTask(payload)
        .catch(() => {})
        .finally(() => {
          this.activeRuns.delete(payload.taskId);
        });
      this.activeRuns.set(payload.taskId, promise);
    }

    await Promise.allSettled(Array.from(this.activeRuns.values()));
  }

  async executeTask(payload = {}) {
    const taskId = normalizeText(payload.taskId);
    const profileId = normalizeText(payload.profileId);
    const trigger = normalizeText(payload.trigger) || "manual";
    const workspaceRoot = normalizeText(payload.workspaceRoot);
    const runInput = {
      ...payload,
      taskId,
      profileId,
      trigger,
      workspaceRoot,
      prompt: buildHubTaskPrompt(payload),
      requestedWorkerType: normalizeText(payload.workerType || payload.requestedWorkerType),
    };

    this.taskRegistry.startRun({
      taskId,
      profileId,
      trigger,
      workspaceRoot,
    });
    this.appendAudit({
      type: "task_start",
      profileId,
      taskId,
      actor: "hub",
      detail: `${trigger} ${workspaceRoot}`.trim(),
    });

    try {
      const result = await this.runTask(runInput);
      const completed = this.taskRegistry.completeRun(taskId, {
        resumableSessionId: normalizeText(result?.sessionId || result?.resumableSessionId),
        lastOutputSummary: normalizeText(result?.result || result?.lastOutputSummary),
      });
      this.appendAudit({
        type: "task_complete",
        profileId,
        taskId,
        actor: "hub",
        detail: completed?.lastOutputSummary || "completed",
      });
      return completed;
    } catch (error) {
      const detail = normalizeText(error?.message) || "task failed";
      this.taskRegistry.failRun(taskId, {
        lastOutputSummary: detail,
      });
      this.appendAudit({
        type: "task_fail",
        profileId,
        taskId,
        actor: "hub",
        detail,
      });
      throw error;
    }
  }

  appendAudit(entry) {
    if (this.auditLog && typeof this.auditLog.append === "function") {
      this.auditLog.append(entry);
    }
  }
}

function buildDefaultRunTask(options = {}) {
  const profileStore = options.profileStore || null;
  const turnFactory = typeof options.turnFactory === "function"
    ? options.turnFactory
    : (config) => new MyaStreamTurn(config);

  return async function runTask(input = {}) {
    const profile = isRecord(input.profile)
      ? input.profile
      : resolveProfile(profileStore, input.profileId);
    const turn = turnFactory({
      myaCommand: normalizeText(input.myaCommand) || "mya",
      workspaceRoot: normalizeText(input.workspaceRoot),
      permissionMode: normalizeText(input.permissionMode),
      enableAutoMode: input.enableAutoMode === true,
      profileId: normalizeText(input.profileId),
      profile,
      model: normalizeText(input.model),
      effort: normalizeText(input.effort),
      requestedWorkerType: normalizeText(input.requestedWorkerType),
      inheritedMemoryNamespace: normalizeText(input.inheritedMemoryNamespace),
    });

    return turn.run(input.prompt);
  };
}

function buildHubTaskPrompt(payload = {}) {
  const explicitPrompt = normalizeText(payload.prompt);
  if (explicitPrompt) {
    return explicitPrompt;
  }

  const profileId = normalizeText(payload.profileId) || "(unknown-profile)";
  const trigger = normalizeText(payload.trigger) || "manual";
  const workspaceRoot = normalizeText(payload.workspaceRoot) || "(unknown-workspace)";
  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  const metadataSuffix = Object.keys(metadata).length > 0
    ? `metadata=${JSON.stringify(metadata)}`
    : "";

  return [
    `profile=${profileId}`,
    `trigger=${trigger}`,
    `workspace=${workspaceRoot}`,
    metadataSuffix,
    "请处理这次后台任务，必要时读取/修改代码或运行命令，并在完成后输出简短中文摘要。",
  ].filter(Boolean).join("\n");
}

function resolveProfile(profileStore, profileId) {
  if (!profileStore || typeof profileStore.get !== "function") {
    return null;
  }
  const normalizedProfileId = normalizeText(profileId);
  if (!normalizedProfileId) {
    return null;
  }
  return profileStore.get(normalizedProfileId);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  HubTaskExecutor,
  buildHubTaskPrompt,
  buildDefaultRunTask,
};
