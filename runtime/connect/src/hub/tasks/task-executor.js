const { spawn } = require("node:child_process");
const { MyaStreamTurn } = require("../../infra/mya/stream-turn");
const { buildProfileRunContext } = require("../agents/profile-run-context");
const { resolveBotInstructionsPath } = require("../profiles/bot-instructions");

class HubTaskExecutor {
  constructor(options = {}) {
    this.taskRegistry = options.taskRegistry || options.registry;
    this.profileStore = options.profileStore || null;
    this.auditLog = options.auditLog || null;
    this.completionNotifier = typeof options.completionNotifier === "function"
      ? options.completionNotifier
      : null;
    this.concurrency = Number.isInteger(options.concurrency) && options.concurrency > 0 ? options.concurrency : 1;
    this.queue = [];
    this.activeRuns = new Map();
    this.pumpPromise = null;
    this.stopping = false;
    const turnFactory = typeof options.turnFactory === "function"
      ? options.turnFactory
      : (config) => new MyaStreamTurn(config, {
        ...(typeof options.spawn === "function" ? { spawn: options.spawn } : {}),
        ...(typeof options.eventSink === "function" ? { eventSink: options.eventSink } : {}),
      });
    const spawnCommand = typeof options.spawnCommand === "function"
      ? options.spawnCommand
      : spawnCommandProcess;
    this.runTask = typeof options.runTask === "function"
      ? options.runTask
      : buildDefaultRunTask({
        profileStore: this.profileStore,
        turnFactory,
        spawnCommand,
      });
  }

  async dispatch(payload) {
    const task = this.ensureTask(payload);
    return this.executeTrackedTask({
      ...payload,
      taskId: task.taskId,
    });
  }

  enqueue(payload) {
    const task = this.ensureTask(payload);
    if (this.stopping) {
      this.failTask(task.taskId, "task cancelled: service stopping");
      return task;
    }
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

  async stop({ reason = "task cancelled: service stopping" } = {}) {
    this.stopping = true;
    const detail = normalizeText(reason) || "task cancelled: service stopping";

    while (this.queue.length > 0) {
      const queued = this.queue.shift();
      if (!queued?.taskId) {
        continue;
      }
      this.failTask(queued.taskId, detail);
      this.appendAudit({
        type: "task_cancel",
        profileId: normalizeText(queued.profileId),
        taskId: normalizeText(queued.taskId),
        actor: "hub",
        detail,
      });
    }

    const cancels = Array.from(this.activeRuns.values()).map((run) => {
      run.stopRequested = true;
      if (typeof run.cancel !== "function") {
        return Promise.resolve();
      }
      return Promise.resolve()
        .then(() => run.cancel(detail))
        .catch(() => {});
    });
    await Promise.allSettled(cancels);
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
    if (this.pumpPromise || this.stopping) {
      return;
    }
    this.pumpPromise = this.pumpQueue()
      .finally(() => {
        this.pumpPromise = null;
        if (!this.stopping && this.queue.length > 0) {
          this.kickPump();
        }
      });
  }

  async pumpQueue() {
    while (!this.stopping && this.queue.length > 0 && this.activeRuns.size < this.concurrency) {
      const payload = this.queue.shift();
      void this.executeTrackedTask(payload).catch(() => {});
    }

    await Promise.allSettled(Array.from(this.activeRuns.values()).map((run) => run.promise));
  }

  async executeTrackedTask(payload = {}) {
    const taskId = normalizeText(payload.taskId);
    const run = {
      taskId,
      cancel: null,
      promise: null,
      stopRequested: false,
    };
    const controls = {
      setStopHandler: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        run.cancel = handler;
        if (run.stopRequested) {
          void Promise.resolve()
            .then(() => handler("task cancelled: service stopping"))
            .catch(() => {});
        }
      },
      isStopping: () => this.stopping === true,
    };

    const promise = this.executeTask(payload, controls)
      .finally(() => {
        this.activeRuns.delete(taskId);
      });
    run.promise = promise;
    this.activeRuns.set(taskId, run);
    return await promise;
  }

  async executeTask(payload = {}, controls = {}) {
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
      const result = await this.runTask(runInput, controls);
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
      await this.notifyTaskLifecycle("completed", completed, runInput);
      return completed;
    } catch (error) {
      const detail = normalizeText(error?.message) || "task failed";
      const failed = this.taskRegistry.failRun(taskId, {
        lastOutputSummary: detail,
      });
      this.appendAudit({
        type: "task_fail",
        profileId,
        taskId,
        actor: "hub",
        detail,
      });
      await this.notifyTaskLifecycle("failed", failed, runInput);
      throw error;
    }
  }

  appendAudit(entry) {
    if (this.auditLog && typeof this.auditLog.append === "function") {
      this.auditLog.append(entry);
    }
  }

  failTask(taskId, detail) {
    if (!this.taskRegistry || typeof this.taskRegistry.failRun !== "function") {
      return null;
    }
    return this.taskRegistry.failRun(taskId, {
      lastOutputSummary: normalizeText(detail) || "task failed",
    });
  }

  async notifyTaskLifecycle(state, task, payload) {
    if (!this.completionNotifier || !task) {
      return null;
    }

    try {
      const result = await this.completionNotifier({
        state,
        task: {
          ...task,
          command: normalizeText(payload?.command),
          prompt: normalizeText(payload?.prompt),
          notification: cloneRecord(payload?.notification),
          metadata: isRecord(payload?.metadata) ? { ...payload.metadata } : {},
        },
        payload: { ...payload },
      });
      this.appendAudit({
        type: "task_notify",
        profileId: normalizeText(task.profileId),
        taskId: normalizeText(task.taskId),
        actor: "hub",
        detail: normalizeText(result?.detail || `${state}`) || `${state}`,
      });
      return result;
    } catch (error) {
      this.appendAudit({
        type: "task_notify_fail",
        profileId: normalizeText(task.profileId),
        taskId: normalizeText(task.taskId),
        actor: "hub",
        detail: normalizeText(error?.message) || "notify failed",
      });
      return null;
    }
  }
}

function buildDefaultRunTask(options = {}) {
  const profileStore = options.profileStore || null;
  const turnFactory = typeof options.turnFactory === "function"
    ? options.turnFactory
    : (config) => new MyaStreamTurn(config);
  const spawnCommand = typeof options.spawnCommand === "function"
    ? options.spawnCommand
    : spawnCommandProcess;

  return async function runTask(input = {}, controls = {}) {
    const profile = isRecord(input.profile)
      ? input.profile
      : resolveProfile(profileStore, input.profileId);
    const profileRunContext = buildProfileRunContext({
      profile,
      requestedType: input.requestedWorkerType,
      inheritedMemoryNamespace: input.inheritedMemoryNamespace,
      workspaceRoot: input.workspaceRoot,
    });

    if (normalizeText(input.command)) {
      const commandRun = await spawnCommand(buildCommandInvocation(input, profileRunContext));
      const handle = normalizeCommandHandle(commandRun);
      controls.setStopHandler?.((reason) => (
        typeof handle.stop === "function"
          ? handle.stop(reason)
          : undefined
      ));
      const commandResult = await handle.promise;
      return normalizeCommandTaskResult(input.command, commandResult);
    }

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
    controls.setStopHandler?.(() => turn.stop());

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
    "请处理这次后台任务，必要时读取/修改代码或运行命令。",
    "完成后输出一份详细中文汇报，不要只给一句总结。",
    "至少包含：执行状态、关键步骤、关键结果/统计数字、需要关注的事项、异常或风险、建议的下一步。",
    ...buildTaskSpecificReportingGuidance({ metadata }),
  ].filter(Boolean).join("\n");
}

function buildTaskSpecificReportingGuidance({ command = "", metadata = {} } = {}) {
  if (!looksLikeMailTask(command, metadata)) {
    return [];
  }

  return [
    "邮件类任务时，汇报不要停留在笼统摘要，要围绕邮件内容本身展开。",
    "请按重要程度排序，逐封说明需要关注的邮件。",
    "每封重点邮件至少写清：发件人、主题、时间、为什么重要、截止时间或时间要求、需要采取的动作。",
    "如果正文里有关键细节、附件、链接、课程安排、缴费、作业、会议或回复要求，也要明确说明。",
    "如果没有需要关注的邮件，要说明扫描范围、总邮件数，以及为什么判定无需处理。",
  ];
}

function looksLikeMailTask(command = "", metadata = {}) {
  const normalizedCommand = normalizeText(command).toLowerCase();
  if (/(mail|email|imap|on_wake\.py)/.test(normalizedCommand)) {
    return true;
  }

  return Object.values(metadata).some((value) => {
    const normalized = normalizeText(String(value)).toLowerCase();
    return /(mail|email|imap)/.test(normalized);
  });
}

function buildCommandInvocation(input, profileRunContext) {
  const command = normalizeText(input.command);
  return {
    command,
    cwd: normalizeText(input.workspaceRoot),
    env: {
      ...process.env,
      ...(input.baseUrl || profileRunContext?.baseUrl
        ? { ANTHROPIC_BASE_URL: input.baseUrl || profileRunContext.baseUrl }
        : {}),
      ...(input.apiKey || profileRunContext?.apiKey
        ? { ANTHROPIC_API_KEY: input.apiKey || profileRunContext.apiKey }
        : {}),
      ...(input.authToken || profileRunContext?.authToken
        ? { ANTHROPIC_AUTH_TOKEN: input.authToken || profileRunContext.authToken }
        : {}),
      ...(input.model || profileRunContext?.model
        ? { ANTHROPIC_MODEL: input.model || profileRunContext.model }
        : {}),
      ...(normalizeText(input.profileId) ? { MYA_ACTIVE_BOT_ID: normalizeText(input.profileId) } : {}),
      ...(normalizeText(input.profileId) ? { MYA_ACTIVE_BOT_PROFILE_ID: normalizeText(input.profileId) } : {}),
      ...(normalizeText(input.profileId) ? { MYA_HUB_PROFILE_ID: normalizeText(input.profileId) } : {}),
      ...(normalizeText(input.profileId)
        ? { MYA_ACTIVE_BOT_INSTRUCTIONS_PATH: resolveBotInstructionsPath(normalizeText(input.profileId)) }
        : {}),
      ...(profileRunContext?.memoryNamespace
        ? { MYA_HUB_MEMORY_NAMESPACE: profileRunContext.memoryNamespace }
        : {}),
    },
  };
}

function normalizeCommandHandle(result) {
  if (result && typeof result === "object" && result.promise && typeof result.promise.then === "function") {
    return {
      promise: result.promise,
      stop: typeof result.stop === "function" ? result.stop.bind(result) : null,
    };
  }

  return {
    promise: Promise.resolve(result),
    stop: null,
  };
}

function normalizeCommandTaskResult(command, result = {}) {
  const exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : 0;
  const signal = normalizeText(result?.signal);
  const stdout = normalizeCommandOutput(result?.stdout);
  const stderr = normalizeCommandOutput(result?.stderr);
  const durationMs = Number.isFinite(result?.durationMs) ? Math.max(0, Math.round(result.durationMs)) : 0;
  const report = buildCommandTaskReport({
    command,
    exitCode,
    signal,
    stdout,
    stderr,
    durationMs,
  });

  if (exitCode !== 0 || signal) {
    throw new Error(report);
  }

  return {
    sessionId: "",
    result: report,
  };
}

function buildCommandTaskReport({ command, exitCode, signal = "", stdout = "", stderr = "", durationMs = 0 }) {
  const normalizedCommand = normalizeText(command) || "(unknown-command)";
  const success = exitCode === 0 && !normalizeText(signal);
  const lines = [
    "[mya command task report]",
    "",
    `STATUS     ${success ? "SUCCESS" : "FAILED"}`,
    `EXIT CODE  ${exitCode}`,
    `SIGNAL     ${normalizeText(signal) || "none"}`,
    `DURATION   ${durationMs > 0 ? `${durationMs}ms` : "unknown"}`,
    `COMMAND    ${normalizedCommand}`,
    "",
    "STDOUT",
    stdout || "(empty)",
    "",
    "STDERR",
    stderr || "(empty)",
  ];
  return lines.join("\n");
}

function spawnCommandProcess(invocation = {}) {
  const command = normalizeText(invocation.command);
  if (!command) {
    throw new Error("task command is required");
  }

  const child = spawn(command, {
    cwd: normalizeText(invocation.cwd) || process.cwd(),
    env: isRecord(invocation.env) ? invocation.env : process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";
  let settled = false;

  const promise = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      settled = true;
      resolve({
        exitCode: Number.isInteger(exitCode) ? exitCode : 0,
        signal: normalizeText(signal),
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });
  });

  return {
    promise,
    async stop() {
      if (settled) {
        return { stopped: true, forced: false };
      }

      const didTerminate = child.kill("SIGTERM");
      if (!didTerminate) {
        return { stopped: false, forced: false };
      }
      if (await settlesWithin(promise, 500)) {
        return { stopped: true, forced: false };
      }

      const didKill = child.kill("SIGKILL");
      if (!didKill) {
        return { stopped: false, forced: true };
      }
      await settlesWithin(promise, 500);
      return { stopped: settled, forced: true };
    },
  };
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

function cloneRecord(value) {
  return isRecord(value) ? { ...value } : {};
}

function normalizeCommandOutput(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function settlesWithin(promise, timeoutMs) {
  const settled = await Promise.race([
    Promise.resolve(promise).then(() => true, () => true),
    sleep(timeoutMs).then(() => false),
  ]);
  return settled === true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  HubTaskExecutor,
  buildHubTaskPrompt,
  buildDefaultRunTask,
};
