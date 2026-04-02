const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");
const path = require("node:path");
const { getPermissionDeniedSource } = require("../../shared/branding");
const { buildProfileRunContext } = require("../../hub/agents/profile-run-context");
const {
  resolveBotInstructionsPath,
} = require("../../hub/profiles/bot-instructions");
const {
  getHubProfilesRoot,
} = require("../../shared/runtime-paths");

class MyaStreamTurn extends EventEmitter {
  constructor(config, deps = {}) {
    super();
    this.config = config;
    this.spawn = deps.spawn || spawnProcess;
    this.eventSink = typeof deps.eventSink === "function" ? deps.eventSink : null;
    this.child = null;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.pendingPermissionRequest = null;
    this.resultMessage = null;
    this.sessionId = normalizeText(config.sessionId || config.resumeSessionId);
    this.runPromise = null;
    this.taskRegistry = isTaskRegistry(config.taskRegistry) ? config.taskRegistry : null;
    this.taskId = normalizeText(config.taskId);
    this.taskStarted = false;
    this.taskFinalized = false;
  }

  async run(content) {
    if (this.runPromise) {
      throw new Error("MyaStreamTurn can only run once");
    }

    this.runPromise = this.start(content);
    return this.runPromise;
  }

  getPendingPermissionRequest() {
    return this.pendingPermissionRequest;
  }

  async respondToPermission({ behavior, message = "", decisionClassification = "" }) {
    const pending = this.pendingPermissionRequest;
    if (!pending) {
      throw new Error("No pending permission request");
    }

    const response = behavior === "allow"
      ? {
        type: "control_response",
        response: {
          subtype: "success",
          request_id: pending.requestId,
          response: {
            behavior: "allow",
            updatedInput: pending.input,
            toolUseID: pending.toolUseId,
            ...(decisionClassification ? { decisionClassification } : {}),
          },
        },
      }
      : {
        type: "control_response",
        response: {
          subtype: "success",
          request_id: pending.requestId,
          response: {
            behavior: "deny",
            message: message || getPermissionDeniedSource(),
            toolUseID: pending.toolUseId,
            ...(decisionClassification ? { decisionClassification } : {}),
          },
        },
      };

    this.pendingPermissionRequest = null;
    this.writeMessage(response);
  }

  async interrupt() {
    this.writeMessage({
      type: "control_request",
      request_id: crypto.randomUUID(),
      request: {
        subtype: "interrupt",
      },
    });
  }

  async start(content) {
    this.reportTaskStart();
    const invocation = buildMyaStreamInvocation(this.config);
    const child = await this.spawn(invocation);
    this.child = child;

    return await new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        this.handleStdoutChunk(chunk);
      });

      child.stderr.on("data", (chunk) => {
        this.stderrBuffer += String(chunk);
      });

      child.on("error", (error) => {
        this.reportTaskFailure(error);
        reject(error);
      });

      child.on("close", (exitCode) => {
        if (this.resultMessage && Number(exitCode || 0) === 0) {
          resolve({
            sessionId: this.resultMessage.sessionId || this.sessionId,
            result: this.resultMessage.result,
            isError: this.resultMessage.isError,
            permissionDenials: this.resultMessage.permissionDenials,
          });
          return;
        }

        const detail = this.stderrBuffer.trim() || "mya stream turn exited unexpectedly";
        this.reportTaskFailure(new Error(detail));
        reject(new Error(`mya failed: ${detail}`));
      });

      this.writeMessage({
        type: "user",
        session_id: "",
        message: {
          role: "user",
          content: normalizeMessageContent(content),
        },
        parent_tool_use_id: null,
      });
    });
  }

  writeMessage(message) {
    if (!this.child?.stdin) {
      throw new Error("mya process is not running");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  handleStdoutChunk(chunk) {
    this.stdoutBuffer += String(chunk);
    const lines = this.stdoutBuffer.split("\n");
    this.stdoutBuffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      const parsed = safeParseJson(line);
      if (!parsed) {
        continue;
      }
      this.handleMessage(parsed);
    }
  }

  handleMessage(message) {
    if (message.type === "system" && message.subtype === "init") {
      this.sessionId = normalizeText(message.session_id) || this.sessionId;
      this.reportTaskUpdate({
        resumableSessionId: this.sessionId,
      });
      this.emitEvent({
        type: "init",
        sessionId: this.sessionId,
      });
      return;
    }

    if (message.type === "assistant") {
      const sessionId = normalizeText(message.session_id) || this.sessionId;
      const content = Array.isArray(message?.message?.content) ? message.message.content : [];
      for (const block of content) {
        if (block?.type === "text" && normalizeText(block.text)) {
          this.emitEvent({
            type: "assistant_text",
            sessionId,
            text: String(block.text).trim(),
          });
        }
        if (block?.type === "tool_use") {
          this.emitEvent({
            type: "tool_use",
            sessionId,
            toolUseId: normalizeText(block.id),
            toolName: normalizeText(block.name),
            input: isRecord(block.input) ? block.input : {},
          });
        }
      }
      return;
    }

    if (message.type === "tool_progress") {
      const sessionId = normalizeText(message.session_id) || this.sessionId;
      this.emitEvent({
        type: "tool_progress",
        sessionId,
        toolUseId: normalizeText(message.tool_use_id),
        toolName: normalizeText(message.tool_name),
        elapsedTimeSeconds: Number(message.elapsed_time_seconds || 0),
      });
      return;
    }

    if (message.type === "control_request" && message?.request?.subtype === "can_use_tool") {
      this.pendingPermissionRequest = {
        requestId: normalizeText(message.request_id),
        toolName: normalizeText(message.request.tool_name),
        toolUseId: normalizeText(message.request.tool_use_id),
        input: isRecord(message.request.input) ? message.request.input : {},
        description: normalizeText(message.request.description),
      };
      this.emitEvent({
        type: "permission_request",
        sessionId: this.sessionId,
        ...this.pendingPermissionRequest,
      });
      return;
    }

    if (message.type === "control_cancel_request") {
      if (this.pendingPermissionRequest?.requestId === normalizeText(message.request_id)) {
        this.pendingPermissionRequest = null;
        this.emitEvent({
          type: "permission_cancelled",
          sessionId: this.sessionId,
          requestId: normalizeText(message.request_id),
        });
      }
      return;
    }

    if (message.type === "system" && message.subtype === "session_state_changed") {
      this.emitEvent({
        type: "state",
        sessionId: normalizeText(message.session_id) || this.sessionId,
        state: normalizeText(message.state),
      });
      return;
    }

    if (message.type === "result") {
      this.resultMessage = {
        sessionId: normalizeText(message.session_id) || this.sessionId,
        result: normalizeText(message.result),
        isError: !!message.is_error,
        permissionDenials: Array.isArray(message.permission_denials) ? message.permission_denials : [],
      };
      if (this.resultMessage.isError) {
        this.reportTaskFailure(new Error(this.resultMessage.result || "mya task failed"));
      } else {
        this.reportTaskCompletion({
          resumableSessionId: this.resultMessage.sessionId,
          lastOutputSummary: this.resultMessage.result,
        });
      }
      this.pendingPermissionRequest = null;
      this.emitEvent({
        type: "result",
        sessionId: this.resultMessage.sessionId,
        result: this.resultMessage.result,
        isError: this.resultMessage.isError,
        permissionDenials: this.resultMessage.permissionDenials,
      });
      this.child?.stdin?.end();
    }
  }

  emitEvent(event) {
    if (this.eventSink) {
      this.eventSink(event);
    }
    this.emit("event", event);
    this.emitTaskEvent(event);
  }

  reportTaskStart() {
    const metadata = this.getTaskMetadata();
    if (!this.taskRegistry || !metadata.taskId || this.taskStarted) {
      return;
    }
    this.taskStarted = true;
    this.taskRegistry.startRun({
      taskId: metadata.taskId,
      profileId: metadata.profileId,
      trigger: metadata.trigger,
      workspaceRoot: metadata.workspaceRoot,
      state: "running",
      resumableSessionId: this.sessionId,
    });
  }

  reportTaskUpdate(patch) {
    const metadata = this.getTaskMetadata();
    if (!this.taskRegistry || !metadata.taskId || this.taskFinalized) {
      return;
    }
    this.taskRegistry.updateRun(metadata.taskId, patch);
  }

  reportTaskCompletion(patch) {
    const metadata = this.getTaskMetadata();
    if (!this.taskRegistry || !metadata.taskId || this.taskFinalized) {
      return;
    }
    this.taskFinalized = true;
    this.taskRegistry.completeRun(metadata.taskId, patch);
  }

  reportTaskFailure(error) {
    const metadata = this.getTaskMetadata();
    if (!this.taskRegistry || !metadata.taskId || this.taskFinalized) {
      return;
    }
    this.taskFinalized = true;
    this.taskRegistry.failRun(metadata.taskId, {
      resumableSessionId: this.sessionId,
      lastOutputSummary: normalizeText(error?.message),
    });
  }

  getTaskMetadata() {
    const taskContext = isRecord(this.config.taskContext) ? this.config.taskContext : {};
    return {
      taskId: normalizeText(this.taskId || taskContext.taskId),
      profileId: normalizeText(this.config.profileId || taskContext.profileId),
      trigger: normalizeText(this.config.trigger || taskContext.trigger),
      workspaceRoot: normalizeText(this.config.workspaceRoot || taskContext.workspaceRoot || this.config.workspaceRoot),
    };
  }

  emitTaskEvent(event) {
    if (typeof this.config.onTaskEvent !== "function" || !isRecord(this.config.taskContext)) {
      return;
    }

    const taskId = normalizeText(this.config.taskContext.taskId);
    if (!taskId) {
      return;
    }

    const taskEvent = {
      type: normalizeText(event?.type),
      taskId,
      profileId: normalizeText(this.config.taskContext.profileId),
      trigger: normalizeText(this.config.taskContext.trigger),
      sessionId: normalizeText(event?.sessionId),
    };
    if (typeof event?.result === "string") {
      taskEvent.result = normalizeText(event.result);
    }
    if (typeof event?.isError === "boolean") {
      taskEvent.isError = event.isError;
    }
    if (Array.isArray(event?.permissionDenials)) {
      taskEvent.permissionDenials = event.permissionDenials;
    }

    this.config.onTaskEvent(taskEvent);
  }
}

function buildMyaStreamInvocation(input) {
  const profileRunContext = resolveProfileRunContextInput(input);
  const args = [
    "--print",
    "--bare",
    "--verbose",
    "--disable-slash-commands",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--permission-mode",
    input.permissionMode || profileRunContext?.permissionMode || "auto",
  ];

  if (input.enableAutoMode) {
    args.push("--enable-auto-mode");
  }

  if (input.model || profileRunContext?.model) {
    args.push("--model", input.model || profileRunContext.model);
  }

  if (input.effort || profileRunContext?.effort) {
    args.push("--effort", input.effort || profileRunContext.effort);
  }

  if (input.resumeSessionId) {
    args.push("--resume", input.resumeSessionId);
  } else if (input.sessionId) {
    args.push("--session-id", input.sessionId);
  }

  return {
    command: input.myaCommand || "mya",
    args,
    cwd: input.workspaceRoot,
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
      ...(input.profileId ? { MYA_ACTIVE_BOT_ID: input.profileId } : {}),
      ...(input.profileId ? { MYA_ACTIVE_BOT_PROFILE_ID: input.profileId } : {}),
      ...(input.profileId ? { MYA_HUB_PROFILE_ID: input.profileId } : {}),
      ...(input.profileId
        ? { MYA_ACTIVE_BOT_PROFILE_PATH: resolveProfilePath(input.profileId) }
        : {}),
      ...(input.profileId
        ? { MYA_ACTIVE_BOT_INSTRUCTIONS_PATH: resolveBotInstructionsPath(input.profileId) }
        : {}),
      ...(input.memoryNamespace ? { MYA_HUB_MEMORY_NAMESPACE: input.memoryNamespace } : {}),
      ...(input.workerType ? { MYA_HUB_WORKER_TYPE: input.workerType } : {}),
    },
  };
}

function resolveProfileRunContextInput(input) {
  if (input?.profileRunContext && typeof input.profileRunContext === "object") {
    return input.profileRunContext;
  }
  if (input?.profile && typeof input.profile === "object") {
    return buildProfileRunContext({
      profile: input.profile,
      requestedType: input.requestedWorkerType,
      inheritedMemoryNamespace: input.inheritedMemoryNamespace,
    });
  }
  return null;
}

function resolveProfilePath(profileId) {
  const profilesRoot = process.env.MYA_HUB_PROFILES_ROOT
    || getHubProfilesRoot();
  return path.join(profilesRoot, profileId, "profile.json");
}

function spawnProcess(invocation) {
  return spawn(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMessageContent(content) {
  if (Array.isArray(content)) {
    return content;
  }
  return String(content || "");
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isTaskRegistry(value) {
  return !!value
    && typeof value.startRun === "function"
    && typeof value.updateRun === "function"
    && typeof value.completeRun === "function"
    && typeof value.failRun === "function";
}

module.exports = {
  MyaStreamTurn,
  buildMyaStreamInvocation,
};
