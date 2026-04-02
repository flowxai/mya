const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const Lark = require("@larksuiteoapi/node-sdk");

const { SessionStore } = require("../infra/storage/session-store");
const {
  buildApprovalCommandPreview,
  extractApprovalCommandTokens,
  isWorkspaceApprovalCommand,
  matchesCommandPrefix,
} = require("../infra/codex/message-utils");
const {
  downloadFeishuMessageResourceToWorkspace,
  sendFeishuAttachmentReply,
} = require("../infra/feishu/file-send");
const { buildMyaAttachmentInput } = require("../infra/attachments/inbox");
const { MyaStreamTurn } = require("../infra/mya/stream-turn");
const { normalizeFeishuIncomingMessage } = require("../infra/feishu/message-utils");
const { chunkReplyText, markdownToPlainText } = require("../infra/weixin/message-utils");
const {
  extractBindPath,
  extractEffortValue,
  extractModelValue,
  extractRemoveWorkspacePath,
  extractSendPath,
  extractSwitchThreadId,
} = require("../shared/command-parsing");
const {
  isAbsoluteWorkspacePath,
  isWorkspaceAllowed,
  normalizeWorkspacePath,
  pathMatchesWorkspaceRoot,
} = require("../shared/workspace-paths");
const { formatFailureText } = require("../shared/error-text");
const {
  getConnectLogPrefix,
  getPermissionDeniedSource,
} = require("../shared/branding");

const ALLOWED_EFFORTS = new Set(["low", "medium", "high", "max"]);
const TOKEN_ENDPOINT = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";

class FeishuRuntime {
  constructor(config) {
    this.runtimeContext = normalizeFeishuRuntimeContext(config);
    this.config = {
      ...config,
      profileId: this.runtimeContext.profileId,
      channelInstanceId: this.runtimeContext.channelInstanceId,
      workspaceAllowlist: [...this.runtimeContext.workspaceAllowlist],
      memoryNamespace: this.runtimeContext.memoryNamespace,
      sessionsFile: this.runtimeContext.sessionsFile,
      profileContext: {
        ...this.runtimeContext,
        workspaceAllowlist: [...this.runtimeContext.workspaceAllowlist],
      },
    };
    this.sessionStore = new SessionStore({ filePath: this.config.sessionsFile });
    this.wsClient = null;
    this.pendingByBindingKey = new Map();
    this.activeTurnByRuntimeKey = new Map();
    this.tokenCache = {
      token: "",
      expiresAt: 0,
    };
  }

  async start() {
    this.validateConfig();

    const dispatcher = new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data) => {
        this.enqueueIncomingEvent(data);
      },
    });

    this.wsClient = new Lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      loggerLevel: Lark.LoggerLevel.info,
    });

    console.log(
      `${getConnectLogPrefix("feishu")} runtime ready app=${this.config.appId} defaultWorkspace=${this.config.defaultWorkspaceRoot || "(none)"}`
    );

    return this.wsClient.start({ eventDispatcher: dispatcher });
  }

  validateConfig() {
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error(
        "缺少飞书配置。请设置 MYA_CONNECT_FEISHU_APP_ID 和 MYA_CONNECT_FEISHU_APP_SECRET。"
      );
    }

    const defaultWorkspaceRoot = normalizeWorkspacePath(this.config.defaultWorkspaceRoot);
    if (!defaultWorkspaceRoot) {
      return;
    }
    if (!isAbsoluteWorkspacePath(defaultWorkspaceRoot)) {
      throw new Error("MYA_CONNECT_FEISHU_DEFAULT_WORKSPACE 必须是绝对路径");
    }
    if (!isWorkspaceAllowed(defaultWorkspaceRoot, this.config.workspaceAllowlist)) {
      throw new Error("MYA_CONNECT_FEISHU_DEFAULT_WORKSPACE 不在允许绑定的白名单中");
    }
  }

  enqueueIncomingEvent(data) {
    const normalized = normalizeFeishuIncomingMessage(data, this.config);
    if (!normalized) {
      return;
    }

    const bindingKey = this.sessionStore.buildBindingKey(normalized);
    if (this.shouldBypassQueue(normalized)) {
      void this.handleNormalized(normalized).catch((error) => {
        console.error(`${getConnectLogPrefix("feishu")} ${formatFailureText("处理失败", error)}`);
      });
      return;
    }
    const previous = this.pendingByBindingKey.get(bindingKey) || Promise.resolve();
    const next = previous
      .then(() => this.handleNormalized(normalized))
      .catch((error) => {
        console.error(`${getConnectLogPrefix("feishu")} ${formatFailureText("处理失败", error)}`);
      })
      .finally(() => {
        if (this.pendingByBindingKey.get(bindingKey) === next) {
          this.pendingByBindingKey.delete(bindingKey);
        }
      });

    this.pendingByBindingKey.set(bindingKey, next);
  }

  shouldBypassQueue(normalized) {
    return normalized.command === "approve"
      || normalized.command === "reject"
      || normalized.command === "stop";
  }

  async handleNormalized(normalized) {
    if (!this.isUserAllowed(normalized.senderOpenId)) {
      await this.sendReplyToNormalized(normalized, "当前账号未允许该飞书用户控制本机 mya。");
      return;
    }

    if (normalized.unsupportedMessageType) {
      await this.sendReplyToNormalized(
        normalized,
        `当前版本只支持文本消息，暂不支持 ${normalized.unsupportedMessageType}。`
      );
      return;
    }

    if (await this.dispatchTextCommand(normalized)) {
      return;
    }

    const workspaceContext = await this.resolveWorkspaceContext(normalized);
    if (!workspaceContext) {
      return;
    }

    try {
      const conversationInput = normalized.attachment
        ? await this.prepareAttachmentConversation(normalized, workspaceContext.workspaceRoot)
        : normalized;
      const reply = await this.runConversation({
        bindingKey: workspaceContext.bindingKey,
        workspaceRoot: workspaceContext.workspaceRoot,
        normalized: conversationInput,
      });
      await this.sendReplyToNormalized(normalized, reply);
    } catch (error) {
      await this.sendReplyToNormalized(normalized, formatFailureText("处理失败", error));
      throw error;
    }
  }

  isUserAllowed(senderOpenId) {
    if (!Array.isArray(this.config.allowedOpenIds) || !this.config.allowedOpenIds.length) {
      return true;
    }
    return this.config.allowedOpenIds.includes(senderOpenId);
  }

  async dispatchTextCommand(normalized) {
    switch (normalized.command) {
      case "bind":
        await this.handleBindCommand(normalized);
        return true;
      case "where":
        await this.handleWhereCommand(normalized);
        return true;
      case "workspace":
        await this.handleWorkspaceCommand(normalized);
        return true;
      case "new":
        await this.handleNewCommand(normalized);
        return true;
      case "switch":
        await this.handleSwitchCommand(normalized);
        return true;
      case "inspect_message":
        await this.handleMessageCommand(normalized);
        return true;
      case "stop":
        await this.handleStopCommand(normalized);
        return true;
      case "model":
        await this.handleModelCommand(normalized);
        return true;
      case "effort":
        await this.handleEffortCommand(normalized);
        return true;
      case "approve":
      case "reject":
        await this.handleApprovalCommand(normalized);
        return true;
      case "remove":
        await this.handleRemoveCommand(normalized);
        return true;
      case "send":
        await this.handleSendCommand(normalized);
        return true;
      case "help":
        await this.handleHelpCommand(normalized);
        return true;
      case "unknown_command":
        await this.sendReplyToNormalized(normalized, `未知命令。\n\n${this.buildHelpText()}`);
        return true;
      default:
        return false;
    }
  }

  async handleBindCommand(normalized) {
    const rawWorkspaceRoot = extractBindPath(normalized.text);
    if (!rawWorkspaceRoot) {
      await this.sendReplyToNormalized(normalized, "用法: `/mya bind /绝对路径`");
      return;
    }

    const workspaceRoot = normalizeWorkspacePath(rawWorkspaceRoot);
    if (!isAbsoluteWorkspacePath(workspaceRoot)) {
      await this.sendReplyToNormalized(normalized, "只支持绝对路径绑定。");
      return;
    }
    if (!isWorkspaceAllowed(workspaceRoot, this.config.workspaceAllowlist)) {
      await this.sendReplyToNormalized(normalized, "该项目不在允许绑定的白名单中。");
      return;
    }

    const workspaceStats = await this.resolveWorkspaceStats(workspaceRoot);
    if (!workspaceStats.exists) {
      await this.sendReplyToNormalized(normalized, `项目不存在: ${workspaceRoot}`);
      return;
    }
    if (!workspaceStats.isDirectory) {
      await this.sendReplyToNormalized(normalized, `路径非法: ${workspaceRoot}`);
      return;
    }

    const bindingKey = this.sessionStore.buildBindingKey(normalized);
    this.applyDefaultMyaParamsOnBind(bindingKey, workspaceRoot);
    this.sessionStore.setActiveWorkspaceRoot(bindingKey, workspaceRoot);
    const sessionId = this.sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
    const text = sessionId
      ? `已切换到项目，并恢复原会话。\n\nworkspace: ${workspaceRoot}\nsession: ${sessionId}`
      : `已绑定项目。\n\nworkspace: ${workspaceRoot}`;
    await this.sendReplyToNormalized(normalized, text);
  }

  async handleWhereCommand(normalized) {
    const workspaceContext = await this.resolveWorkspaceContext(normalized, false);
    if (!workspaceContext) {
      await this.sendReplyToNormalized(
        normalized,
        this.config.defaultWorkspaceRoot
          ? `默认项目可用，但当前会话尚未持久化绑定。\n\nworkspace: ${normalizeWorkspacePath(this.config.defaultWorkspaceRoot)}`
          : "当前会话还未绑定项目。先发送 `/mya bind /绝对路径`。"
      );
      return;
    }

    const { bindingKey, workspaceRoot } = workspaceContext;
    const hasPendingNewSession = this.sessionStore.hasPendingNewThreadForWorkspace(bindingKey, workspaceRoot);
    const sessionId = this.sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
    const params = this.getMyaParamsForWorkspace(bindingKey, workspaceRoot);
    await this.sendReplyToNormalized(
      normalized,
      [
        `workspace: ${workspaceRoot}`,
        `session: ${hasPendingNewSession ? "(new draft)" : (sessionId || "(none)")}`,
        `model: ${params.model || "(default)"}`,
        `effort: ${params.effort || "(default)"}`,
        `permission-mode: ${this.config.permissionMode}`,
        `auto-mode: ${this.config.enableAutoMode ? "on" : "off"}`,
      ].join("\n")
    );
  }

  async handleWorkspaceCommand(normalized) {
    const bindingKey = this.sessionStore.buildBindingKey(normalized);
    const workspaceRoots = this.sessionStore.listWorkspaceRoots(bindingKey);
    if (!workspaceRoots.length) {
      if (this.config.defaultWorkspaceRoot) {
        await this.sendReplyToNormalized(
          normalized,
          `当前没有显式绑定项目。\n默认项目: ${normalizeWorkspacePath(this.config.defaultWorkspaceRoot)}`
        );
        return;
      }
      await this.sendReplyToNormalized(normalized, "当前会话还没有绑定任何项目。");
      return;
    }

    const activeWorkspaceRoot = this.sessionStore.getActiveWorkspaceRoot(bindingKey);
    const lines = workspaceRoots.map((workspaceRoot) => {
      const sessionId = this.sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
      const hasPendingNewSession = this.sessionStore.hasPendingNewThreadForWorkspace(bindingKey, workspaceRoot);
      const prefix = workspaceRoot === activeWorkspaceRoot ? "* " : "- ";
      const sessionText = hasPendingNewSession
        ? "\n  session: (new draft)"
        : (sessionId ? `\n  session: ${sessionId}` : "");
      return `${prefix}${workspaceRoot}${sessionText}`;
    });
    await this.sendReplyToNormalized(normalized, lines.join("\n"));
  }

  async handleNewCommand(normalized) {
    const workspaceContext = await this.resolveWorkspaceContext(normalized);
    if (!workspaceContext) {
      return;
    }
    const { bindingKey, workspaceRoot } = workspaceContext;
    this.sessionStore.setPendingNewThreadForWorkspace(bindingKey, workspaceRoot, true);
    this.sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
    this.sessionStore.clearRecentConversationEntries(bindingKey, workspaceRoot);
    await this.sendReplyToNormalized(
      normalized,
      `已切换到新会话。\n\nworkspace: ${workspaceRoot}`
    );
  }

  async handleSwitchCommand(normalized) {
    const targetSessionId = extractSwitchThreadId(normalized.text);
    if (!targetSessionId) {
      await this.sendReplyToNormalized(normalized, "用法: `/mya switch <sessionId>`");
      return;
    }

    const workspaceContext = await this.resolveWorkspaceContext(normalized);
    if (!workspaceContext) {
      return;
    }

    const { bindingKey, workspaceRoot } = workspaceContext;
    this.sessionStore.setPendingNewThreadForWorkspace(bindingKey, workspaceRoot, false);
    this.sessionStore.setThreadIdForWorkspace(
      bindingKey,
      workspaceRoot,
      targetSessionId,
      this.buildBindingMetadata(normalized)
    );
    this.sessionStore.clearRecentConversationEntries(bindingKey, workspaceRoot);
    await this.sendReplyToNormalized(
      normalized,
      `已切换会话。\n\nworkspace: ${workspaceRoot}\nsession: ${targetSessionId}`
    );
  }

  async handleMessageCommand(normalized) {
    const workspaceContext = await this.resolveWorkspaceContext(normalized, false);
    if (!workspaceContext) {
      await this.sendReplyToNormalized(normalized, "当前会话还未绑定项目。");
      return;
    }
    await this.sendReplyToNormalized(normalized, this.buildRecentConversationText(
      workspaceContext.bindingKey,
      workspaceContext.workspaceRoot
    ));
  }

  async handleStopCommand(normalized) {
    const active = await this.resolveActiveTurnForNormalized(normalized);
    if (!active) {
      await this.sendReplyToNormalized(normalized, "当前没有运行中的 mya 任务。");
      return;
    }

    await active.turn.interrupt();
    await this.sendReplyToNormalized(normalized, "已发送中断请求，等待 mya 停止当前任务。");
  }

  async handleModelCommand(normalized) {
    const requested = extractModelValue(normalized.text);
    const workspaceContext = await this.resolveWorkspaceContext(normalized, false);
    if (!requested) {
      if (!workspaceContext) {
        await this.sendReplyToNormalized(normalized, `当前模型: ${this.config.defaultModel || "(default)"}`);
        return;
      }
      const current = this.getMyaParamsForWorkspace(workspaceContext.bindingKey, workspaceContext.workspaceRoot);
      await this.sendReplyToNormalized(normalized, `当前模型: ${current.model || this.config.defaultModel || "(default)"}`);
      return;
    }

    if (!workspaceContext) {
      await this.sendReplyToNormalized(normalized, "当前会话还未绑定项目，无法设置模型。");
      return;
    }

    this.sessionStore.setCodexParamsForWorkspace(
      workspaceContext.bindingKey,
      workspaceContext.workspaceRoot,
      {
        model: requested,
        effort: this.getMyaParamsForWorkspace(workspaceContext.bindingKey, workspaceContext.workspaceRoot).effort,
      }
    );
    await this.sendReplyToNormalized(
      normalized,
      `已设置模型。\n\nworkspace: ${workspaceContext.workspaceRoot}\nmodel: ${requested}`
    );
  }

  async handleEffortCommand(normalized) {
    const requested = extractEffortValue(normalized.text);
    const workspaceContext = await this.resolveWorkspaceContext(normalized, false);
    if (!workspaceContext) {
      await this.sendReplyToNormalized(normalized, "当前会话还未绑定项目，无法设置推理强度。");
      return;
    }

    if (!requested) {
      const current = this.getMyaParamsForWorkspace(workspaceContext.bindingKey, workspaceContext.workspaceRoot);
      await this.sendReplyToNormalized(
        normalized,
        `当前推理强度: ${current.effort || this.config.defaultEffort || "(default)"}`
      );
      return;
    }

    if (!ALLOWED_EFFORTS.has(requested)) {
      await this.sendReplyToNormalized(normalized, "只支持 low、medium、high、max。");
      return;
    }

    const current = this.getMyaParamsForWorkspace(workspaceContext.bindingKey, workspaceContext.workspaceRoot);
    this.sessionStore.setCodexParamsForWorkspace(
      workspaceContext.bindingKey,
      workspaceContext.workspaceRoot,
      { model: current.model, effort: requested }
    );
    await this.sendReplyToNormalized(
      normalized,
      `已设置推理强度。\n\nworkspace: ${workspaceContext.workspaceRoot}\neffort: ${requested}`
    );
  }

  async handleApprovalCommand(normalized) {
    const active = await this.resolveActiveTurnForNormalized(normalized);
    if (!active) {
      await this.sendReplyToNormalized(normalized, "当前没有待处理的权限请求。");
      return;
    }

    const pending = active.pendingPermission;
    if (!pending) {
      await this.sendReplyToNormalized(normalized, "当前没有待处理的权限请求。");
      return;
    }

    if (normalized.command === "reject") {
      await active.turn.respondToPermission({
        behavior: "deny",
        message: getPermissionDeniedSource("feishu"),
        decisionClassification: "user_reject",
      });
      active.pendingPermission = null;
      active.status = "running";
      await this.sendReplyToNormalized(normalized, "已拒绝当前权限请求。");
      return;
    }

    const rememberForWorkspace = isWorkspaceApprovalCommand(normalized.text)
      && pending.commandTokens.length > 0;
    if (rememberForWorkspace) {
      this.sessionStore.rememberApprovalCommandPrefix(
        this.buildApprovalScope(active, normalized),
        pending.commandTokens
      );
    }

    await active.turn.respondToPermission({
      behavior: "allow",
      decisionClassification: rememberForWorkspace ? "user_permanent" : "user_temporary",
    });
    active.pendingPermission = null;
    active.status = "running";
    await this.sendReplyToNormalized(
      normalized,
      rememberForWorkspace
        ? `已允许当前权限请求，并记住工作区命令前缀：${pending.commandPreview || pending.description || pending.toolName}`
        : "已允许当前权限请求。"
    );
  }

  async handleRemoveCommand(normalized) {
    const target = extractRemoveWorkspacePath(normalized.text);
    if (!target) {
      await this.sendReplyToNormalized(normalized, "用法: `/mya remove /绝对路径`");
      return;
    }
    const bindingKey = this.sessionStore.buildBindingKey(normalized);
    const workspaceRoot = normalizeWorkspacePath(target);
    this.sessionStore.removeWorkspace(bindingKey, workspaceRoot);
    await this.sendReplyToNormalized(normalized, `已移除项目绑定: ${workspaceRoot}`);
  }

  async handleSendCommand(normalized) {
    const requestedPath = extractSendPath(normalized.text);
    if (!requestedPath) {
      await this.sendReplyToNormalized(normalized, "用法: `/mya send <相对文件路径>`");
      return;
    }

    const workspaceContext = await this.resolveWorkspaceContext(normalized);
    if (!workspaceContext) {
      return;
    }

    const resolvedPath = this.resolveWorkspaceFilePath(workspaceContext.workspaceRoot, requestedPath);
    if (!resolvedPath) {
      await this.sendReplyToNormalized(normalized, "只允许发送当前项目目录内的文件。");
      return;
    }

    let stats = null;
    try {
      stats = await fs.promises.stat(resolvedPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        await this.sendReplyToNormalized(normalized, `文件不存在: ${requestedPath}`);
        return;
      }
      throw error;
    }

    if (!stats.isFile()) {
      await this.sendReplyToNormalized(normalized, `只能发送文件，不能发送目录: ${requestedPath}`);
      return;
    }

    await this.sendFileToNormalized(normalized, {
      requestedPath,
      filePath: resolvedPath,
    });
  }

  async handleHelpCommand(normalized) {
    await this.sendReplyToNormalized(normalized, this.buildHelpText());
  }

  buildHelpText() {
    return [
      "可用命令：",
      "/mya bind /绝对路径",
      "/mya where",
      "/mya workspace",
      "/mya new",
      "/mya switch <sessionId>",
      "/mya message",
      "/mya model",
      "/mya model <modelId>",
      "/mya effort",
      "/mya effort <low|medium|high|max>",
      "/mya send <相对文件路径>",
      "/mya remove /绝对路径",
      "/mya help",
      "",
      "普通文本消息会直接发送给当前项目对应的 mya 会话。",
      "私聊图片/文件会自动保存到 .mya/inbox/feishu 并进入当前 turn；群聊附件需要 @mya 或 /mya 触发。",
      "支持 /mya approve、/mya approve workspace、/mya reject、/mya stop，支持发送当前项目目录内的本地文件。",
    ].join("\n");
  }

  async resolveWorkspaceContext(normalized, sendMissingMessage = true) {
    const bindingKey = this.sessionStore.buildBindingKey(normalized);
    let workspaceRoot = this.sessionStore.getActiveWorkspaceRoot(bindingKey);
    if (!workspaceRoot && this.config.defaultWorkspaceRoot) {
      workspaceRoot = normalizeWorkspacePath(this.config.defaultWorkspaceRoot);
      this.applyDefaultMyaParamsOnBind(bindingKey, workspaceRoot);
      this.sessionStore.setActiveWorkspaceRoot(bindingKey, workspaceRoot);
    }

    if (!workspaceRoot) {
      if (sendMissingMessage) {
        await this.sendReplyToNormalized(
          normalized,
          "当前会话还未绑定项目。先发送 `/mya bind /绝对路径`，或配置 MYA_CONNECT_FEISHU_DEFAULT_WORKSPACE。"
        );
      }
      return null;
    }
    return { bindingKey, workspaceRoot };
  }

  applyDefaultMyaParamsOnBind(bindingKey, workspaceRoot) {
    const current = this.sessionStore.getCodexParamsForWorkspace(bindingKey, workspaceRoot);
    if (current.model || current.effort) {
      return;
    }

    this.sessionStore.setCodexParamsForWorkspace(bindingKey, workspaceRoot, {
      model: this.config.defaultModel || "",
      effort: this.config.defaultEffort || "",
    });
  }

  getMyaParamsForWorkspace(bindingKey, workspaceRoot) {
    const current = this.sessionStore.getCodexParamsForWorkspace(bindingKey, workspaceRoot);
    if (current.model || current.effort) {
      return current;
    }
    return {
      model: this.config.defaultModel || "",
      effort: this.config.defaultEffort || "",
    };
  }

  async runConversation({ bindingKey, workspaceRoot, normalized }) {
    const hadPendingNewSession = this.sessionStore.hasPendingNewThreadForWorkspace(bindingKey, workspaceRoot);
    const existingSessionId = hadPendingNewSession
      ? ""
      : this.sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
    const params = this.getMyaParamsForWorkspace(bindingKey, workspaceRoot);

    try {
      const { reply } = await this.executeTurnRun({
        bindingKey,
        workspaceRoot,
        normalized,
        runtimeContext: this.runtimeContext,
        sessionId: existingSessionId ? "" : (existingSessionId || crypto.randomUUID()),
        resumeSessionId: existingSessionId || "",
        params,
      });
      return reply;
    } catch (error) {
      if (!existingSessionId || !shouldRecreateSession(error)) {
        throw error;
      }

      const recreatedSessionId = crypto.randomUUID();
      this.sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
      const { reply } = await this.executeTurnRun({
        bindingKey,
        workspaceRoot,
        normalized,
        runtimeContext: this.runtimeContext,
        sessionId: recreatedSessionId,
        resumeSessionId: "",
        params,
      });
      return reply;
    }
  }

  async executeTurnRun({
    bindingKey,
    workspaceRoot,
    normalized,
    runtimeContext,
    sessionId,
    resumeSessionId,
    params,
  }) {
    const turn = new MyaStreamTurn({
      myaCommand: this.config.myaCommand,
      workspaceRoot,
      sessionId,
      resumeSessionId,
      model: params.model || "",
      effort: params.effort || "",
      permissionMode: this.config.permissionMode,
      enableAutoMode: this.config.enableAutoMode,
      profileId: runtimeContext?.profileId || "",
      profile: runtimeContext?.profile || null,
      channelInstanceId: runtimeContext?.channelInstanceId || "",
      memoryNamespace: runtimeContext?.memoryNamespace || "",
      runtimeContext,
    });
    const runtimeKey = this.buildRuntimeKey(bindingKey, workspaceRoot);
    const active = {
      bindingKey,
      workspaceRoot,
      runtimeContext: runtimeContext || this.runtimeContext,
      turn,
      status: "running",
      pendingPermission: null,
      lastToolUse: null,
    };
    this.activeTurnByRuntimeKey.set(runtimeKey, active);
    this.attachTurnEventHandlers(active, normalized);

    try {
      const turnInput = normalized.turnContent || normalized.text;
      const result = await turn.run(turnInput);
      const resolvedSessionId = result.sessionId || sessionId || resumeSessionId || "";
      if (resolvedSessionId) {
        this.sessionStore.setThreadIdForWorkspace(
          bindingKey,
          workspaceRoot,
          resolvedSessionId,
          this.buildBindingMetadata(normalized)
        );
      }
      this.sessionStore.setPendingNewThreadForWorkspace(bindingKey, workspaceRoot, false);
      this.sessionStore.appendRecentConversationEntry(bindingKey, workspaceRoot, {
        role: "user",
        text: normalized.text,
      });
      if (result.result) {
        this.sessionStore.appendRecentConversationEntry(bindingKey, workspaceRoot, {
          role: "assistant",
          text: result.result,
        });
      }
      return {
        sessionId: resolvedSessionId,
        reply: result.result || "已完成。",
      };
    } finally {
      if (this.activeTurnByRuntimeKey.get(runtimeKey)?.turn === turn) {
        this.activeTurnByRuntimeKey.delete(runtimeKey);
      }
    }
  }

  attachTurnEventHandlers(active, normalized) {
    active.turn.on("event", (event) => {
      if (event.type === "tool_use") {
        active.lastToolUse = event;
        return;
      }

      if (event.type === "permission_request") {
        const commandTokens = extractApprovalCommandTokens(event.input);
        const commandPreview = buildApprovalCommandPreview(commandTokens);
        active.status = "requires_action";
        active.pendingPermission = {
          ...event,
          commandTokens,
          commandPreview,
        };

        const allowlist = this.sessionStore.getApprovalCommandAllowlist(
          this.buildApprovalScope(active, normalized)
        );
        if (commandTokens.length > 0 && matchesCommandPrefix(commandTokens, allowlist)) {
          void active.turn.respondToPermission({
            behavior: "allow",
            decisionClassification: "user_permanent",
          }).then(() => {
            active.pendingPermission = null;
            active.status = "running";
          }).catch(() => {});
          return;
        }

        void this.sendReplyToNormalized(
          normalized,
          buildPermissionRequestText(active.pendingPermission)
        ).catch(() => {});
        return;
      }

      if (event.type === "permission_cancelled") {
        active.pendingPermission = null;
        active.status = "running";
        return;
      }

      if (event.type === "result") {
        active.pendingPermission = null;
        active.status = "idle";
      }
    });
  }

  buildBindingMetadata(normalized) {
    return {
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    };
  }

  buildApprovalScope(active, normalized) {
    return {
      profileId: active?.runtimeContext?.profileId || normalized?.profileId || "",
      channelType: "feishu",
      accountId: normalized?.accountId || this.config?.appId || "",
      senderId: normalized?.senderId || "",
      workspaceRoot: active?.workspaceRoot || "",
    };
  }

  async resolveWorkspaceStats(workspaceRoot) {
    try {
      const stats = await fs.promises.stat(workspaceRoot);
      return {
        exists: true,
        isDirectory: stats.isDirectory(),
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { exists: false, isDirectory: false };
      }
      throw error;
    }
  }

  async sendFileToNormalized(normalized, { filePath }) {
    const tenantAccessToken = await this.getTenantAccessToken();
    await sendFeishuAttachmentReply({
      filePath,
      messageId: normalized.messageId,
      tenantAccessToken,
      replyInThread: this.config.replyInThread || !!normalized.threadKey,
    });
  }

  async prepareAttachmentConversation(normalized, workspaceRoot) {
    const tenantAccessToken = await this.getTenantAccessToken();
    const downloaded = await downloadFeishuMessageResourceToWorkspace({
      workspaceRoot,
      profileId: this.runtimeContext.profileId,
      conversationId: normalized.chatId,
      messageId: normalized.messageId,
      attachment: normalized.attachment,
      tenantAccessToken,
    });

    const conversationText = buildAttachmentConversationText({
      attachment: normalized.attachment,
      relativePath: downloaded.relativePath,
      note: normalized.text,
    });

    return {
      ...normalized,
      command: "message",
      text: conversationText,
      turnContent: buildMyaAttachmentInput({
        userText: normalized.text,
        attachments: [downloaded],
      }),
      attachment: {
        ...normalized.attachment,
        relativePath: downloaded.relativePath,
        filePath: downloaded.filePath,
      },
    };
  }

  async sendReplyToNormalized(normalized, text) {
    const plainText = markdownToPlainText(text) || "已完成。";
    const chunks = chunkReplyText(plainText, 1500);
    for (const chunk of chunks.length ? chunks : ["已完成。"]) {
      await this.replyToMessage(normalized.messageId, chunk, this.config.replyInThread || !!normalized.threadKey);
    }
  }

  async replyToMessage(messageId, text, replyInThread) {
    const tenantAccessToken = await this.getTenantAccessToken();
    const response = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tenantAccessToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          content: JSON.stringify({ text }),
          msg_type: "text",
          reply_in_thread: !!replyInThread,
          uuid: crypto.randomUUID(),
        }),
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.code !== 0) {
      const detail = payload.msg || `${response.status} ${response.statusText}`;
      throw new Error(`飞书回复失败: ${detail}`);
    }
  }

  resolveWorkspaceFilePath(workspaceRoot, requestedPath) {
    const normalizedWorkspaceRoot = normalizeWorkspacePath(workspaceRoot);
    const rawRequestedPath = String(requestedPath || "").trim();
    if (!normalizedWorkspaceRoot || !rawRequestedPath) {
      return "";
    }

    const candidatePath = path.resolve(normalizedWorkspaceRoot, rawRequestedPath);
    const normalizedCandidatePath = normalizeWorkspacePath(candidatePath);
    if (!pathMatchesWorkspaceRoot(normalizedCandidatePath, normalizedWorkspaceRoot)) {
      return "";
    }
    return candidatePath;
  }

  async getTenantAccessToken() {
    if (this.tokenCache.token && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }

    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
      const detail = payload.msg || `${response.status} ${response.statusText}`;
      throw new Error(`获取飞书 tenant_access_token 失败: ${detail}`);
    }

    const expireSeconds = Number(payload.expire || 7200);
    this.tokenCache = {
      token: payload.tenant_access_token,
      expiresAt: Date.now() + Math.max(60, expireSeconds - 300) * 1000,
    };
    return this.tokenCache.token;
  }

  buildRuntimeKey(bindingKey, workspaceRoot) {
    return `${bindingKey}::${normalizeWorkspacePath(workspaceRoot)}`;
  }

  getActiveTurn(bindingKey, workspaceRoot) {
    return this.activeTurnByRuntimeKey.get(this.buildRuntimeKey(bindingKey, workspaceRoot)) || null;
  }

  async resolveActiveTurnForNormalized(normalized) {
    const workspaceContext = await this.resolveWorkspaceContext(normalized, false);
    if (!workspaceContext) {
      return null;
    }
    return this.getActiveTurn(workspaceContext.bindingKey, workspaceContext.workspaceRoot);
  }

  buildRecentConversationText(bindingKey, workspaceRoot) {
    const sessionId = this.sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot) || "(none)";
    const entries = this.sessionStore.getRecentConversationEntries(bindingKey, workspaceRoot);
    const active = this.getActiveTurn(bindingKey, workspaceRoot);
    const lines = [
      `workspace: ${workspaceRoot}`,
      `session: ${sessionId}`,
      `status: ${active?.status || "idle"}`,
    ];

    if (active?.pendingPermission) {
      lines.push(
        `pending-permission: ${active.pendingPermission.commandPreview || active.pendingPermission.description || active.pendingPermission.toolName}`
      );
    }

    if (!entries.length) {
      lines.push("", "当前项目还没有本地会话摘要。");
      return lines.join("\n");
    }

    lines.push("", "recent:");
    for (const entry of entries) {
      lines.push(`${entry.role === "user" ? "- user" : "- assistant"}: ${entry.text}`);
    }
    return lines.join("\n");
  }
}

function shouldRecreateSession(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("no conversation found with session id")
    || message.includes("failed to resume session")
    || message.includes("no conversation found")
  );
}

module.exports = { FeishuRuntime };

function buildPermissionRequestText(request) {
  const lines = [
    "mya 需要权限才能继续当前任务。",
    `tool: ${request.toolName}`,
  ];
  if (request.description) {
    lines.push(`detail: ${request.description}`);
  }
  if (request.commandPreview) {
    lines.push(`command: ${request.commandPreview}`);
  }
  lines.push(
    "",
    "发送 `/mya approve` 允许一次。",
  );
  if (request.commandTokens.length > 0) {
    lines.push("发送 `/mya approve workspace` 记住当前命令前缀并允许当前请求。");
  }
  lines.push("发送 `/mya reject` 拒绝当前请求。");
  return lines.join("\n");
}

function buildAttachmentConversationText({ attachment, relativePath, note }) {
  const lines = [
    "收到一个来自飞书的附件，已保存到当前工作区。",
    `类型: ${attachment.kind}`,
    `路径: ${relativePath}`,
  ];
  if (attachment.fileName) {
    lines.push(`原始文件名: ${attachment.fileName}`);
  }

  const normalizedNote = stripAttachmentTriggerNote(note);
  if (normalizedNote) {
    lines.push(`附带说明: ${normalizedNote}`);
  }

  return lines.join("\n");
}

function stripAttachmentTriggerNote(note) {
  const text = String(note || "").trim();
  if (!text) {
    return "";
  }
  return text.replace(/^\/mya\b[:\s-]*/i, "").trim();
}

function normalizeFeishuRuntimeContext(config = {}) {
  const injected = isFeishuRecord(config.profileContext) ? config.profileContext : {};
  const workspaceAllowlist = normalizeFeishuRuntimeStringList(
    injected.workspaceAllowlist !== undefined ? injected.workspaceAllowlist : config.workspaceAllowlist
  );

  return Object.freeze({
    profile: isFeishuRecord(injected.profile) ? injected.profile : null,
    profileId: normalizeFeishuRuntimeText(injected.profileId ?? config.profileId),
    channelInstanceId: normalizeFeishuRuntimeText(injected.channelInstanceId ?? config.channelInstanceId),
    workspaceAllowlist: Object.freeze(workspaceAllowlist),
    memoryNamespace: normalizeFeishuRuntimeText(injected.memoryNamespace ?? config.memoryNamespace),
    sessionsFile: normalizeFeishuRuntimeText(injected.sessionsFile ?? config.sessionsFile),
  });
}

function normalizeFeishuRuntimeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeFeishuRuntimeText(item))
    .filter(Boolean);
}

function normalizeFeishuRuntimeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isFeishuRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
