const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { SessionStore } = require("../infra/storage/session-store");
const { MyaStreamTurn } = require("../infra/mya/stream-turn");
const {
  buildApprovalCommandPreview,
  extractApprovalCommandTokens,
  isWorkspaceApprovalCommand,
  matchesCommandPrefix,
} = require("../infra/codex/message-utils");
const { getUpdates, sendMessage, getConfig, sendTyping } = require("../infra/weixin/api");
const { buildMyaAttachmentInput } = require("../infra/attachments/inbox");
const { downloadIncomingWeixinAttachments } = require("../infra/weixin/media-receive");
const { sendWeixinMediaFile } = require("../infra/weixin/media-send");
const { resolveSelectedAccount } = require("../infra/weixin/account-store");
const {
  loadPersistedContextTokens,
  persistContextToken,
} = require("../infra/weixin/context-token-store");
const { loadSyncBuffer, saveSyncBuffer } = require("../infra/weixin/sync-buffer-store");
const {
  chunkReplyText,
  markdownToPlainText,
  normalizeWeixinIncomingMessage,
} = require("../infra/weixin/message-utils");
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
  getConnectCommandName,
  getConnectLogPrefix,
  getPermissionDeniedSource,
} = require("../shared/branding");

const SESSION_EXPIRED_ERRCODE = -14;
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const RETRY_DELAY_MS = 2_000;
const BACKOFF_DELAY_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const TYPING_KEEPALIVE_MS = 5_000;
const ALLOWED_EFFORTS = new Set(["low", "medium", "high", "max"]);

class WechatRuntime {
  constructor(config) {
    this.config = config;
    this.sessionStore = new SessionStore({ filePath: config.sessionsFile });
    this.account = null;
    this.contextTokenByUserId = new Map();
    this.typingStopByUserId = new Map();
    this.pendingByBindingKey = new Map();
    this.activeTurnByRuntimeKey = new Map();
  }

  async start() {
    this.account = resolveSelectedAccount(this.config);
    this.validateConfig();
    this.restorePersistedContextTokens();
    console.log(
      `${getConnectLogPrefix("wechat")} runtime ready account=${this.account.accountId} userId=${this.account.userId || "(unknown)"}`
    );
    await this.monitorLoop();
  }

  validateConfig() {
    if (!this.account || !this.account.token) {
      throw new Error(`缺少已登录的微信账号，请先执行 \`${getConnectCommandName()} wechat login\``);
    }
    const defaultWorkspaceRoot = normalizeWorkspacePath(this.config.defaultWorkspaceRoot);
    if (!defaultWorkspaceRoot) {
      return;
    }
    if (!isAbsoluteWorkspacePath(defaultWorkspaceRoot)) {
      throw new Error("MYA_CONNECT_WECHAT_DEFAULT_WORKSPACE 必须是绝对路径");
    }
    if (!isWorkspaceAllowed(defaultWorkspaceRoot, this.config.workspaceAllowlist)) {
      throw new Error("MYA_CONNECT_WECHAT_DEFAULT_WORKSPACE 不在允许绑定的白名单中");
    }
  }

  restorePersistedContextTokens() {
    const persistedTokens = loadPersistedContextTokens(this.config, this.account.accountId);
    let restoredCount = 0;
    for (const [userId, token] of Object.entries(persistedTokens)) {
      this.contextTokenByUserId.set(userId, token);
      restoredCount += 1;
    }
    if (restoredCount > 0) {
      console.log(`${getConnectLogPrefix("wechat")} restored ${restoredCount} persisted context token(s)`);
    }
  }

  rememberContextToken(userId, contextToken) {
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    const normalizedToken = typeof contextToken === "string" ? contextToken.trim() : "";
    if (!normalizedUserId || !normalizedToken || !this.account?.accountId) {
      return;
    }

    this.contextTokenByUserId.set(normalizedUserId, normalizedToken);
    persistContextToken(this.config, this.account.accountId, normalizedUserId, normalizedToken);
  }

  async monitorLoop() {
    let getUpdatesBuf = loadSyncBuffer(this.config, this.account.accountId);
    let nextTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS;
    let consecutiveFailures = 0;

    while (true) {
      try {
        const response = await getUpdates({
          baseUrl: this.account.baseUrl,
          token: this.account.token,
          get_updates_buf: getUpdatesBuf,
          timeoutMs: nextTimeoutMs,
        });

        if (response.longpolling_timeout_ms && response.longpolling_timeout_ms > 0) {
          nextTimeoutMs = response.longpolling_timeout_ms;
        }

        const isApiError =
          (response.ret !== undefined && response.ret !== 0)
          || (response.errcode !== undefined && response.errcode !== 0);
        if (isApiError) {
          if (response.errcode === SESSION_EXPIRED_ERRCODE || response.ret === SESSION_EXPIRED_ERRCODE) {
            throw new Error(`微信会话已失效，请重新执行 \`${getConnectCommandName()} wechat login\``);
          }
          consecutiveFailures += 1;
          console.error(
            `${getConnectLogPrefix("wechat")} getUpdates failed ret=${response.ret} errcode=${response.errcode} errmsg=${response.errmsg || ""}`
          );
          await sleep(consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_DELAY_MS : RETRY_DELAY_MS);
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            consecutiveFailures = 0;
          }
          continue;
        }

        consecutiveFailures = 0;
        if (typeof response.get_updates_buf === "string" && response.get_updates_buf) {
          getUpdatesBuf = response.get_updates_buf;
          saveSyncBuffer(this.config, this.account.accountId, getUpdatesBuf);
        }

        const messages = Array.isArray(response.msgs) ? response.msgs : [];
        for (const message of messages) {
          this.enqueueIncomingMessage(message);
        }
      } catch (error) {
        consecutiveFailures += 1;
        console.error(`${getConnectLogPrefix("wechat")} monitor error (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${error.message}`);
        if (String(error.message || "").includes(`重新执行 \`${getConnectCommandName()} wechat login\``)) {
          throw error;
        }
        await sleep(consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_DELAY_MS : RETRY_DELAY_MS);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0;
        }
      }
    }
  }

  enqueueIncomingMessage(message) {
    const senderId = typeof message?.from_user_id === "string" ? message.from_user_id.trim() : "";
    const contextToken = typeof message?.context_token === "string" ? message.context_token.trim() : "";
    if (senderId && contextToken) {
      this.rememberContextToken(senderId, contextToken);
    }

    const normalized = normalizeWeixinIncomingMessage(message, this.config, this.account.accountId);
    if (!normalized) {
      return;
    }

    const bindingKey = this.sessionStore.buildBindingKey(normalized);
    if (this.shouldBypassQueue(normalized)) {
      void this.handleNormalized(normalized).catch((error) => {
        console.error(`${getConnectLogPrefix("wechat")} ${formatFailureText("处理失败", error)}`);
      });
      return;
    }

    const previous = this.pendingByBindingKey.get(bindingKey) || Promise.resolve();
    const next = previous
      .then(() => this.handleNormalized(normalized))
      .catch((error) => {
        console.error(`${getConnectLogPrefix("wechat")} ${formatFailureText("处理失败", error)}`);
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
    if (!this.isUserAllowed(normalized.senderId)) {
      await this.sendReplyToUser(normalized.senderId, "当前账号未允许该微信号控制本机 mya。", normalized.contextToken);
      return;
    }

    try {
      if (await this.dispatchTextCommand(normalized)) {
        return;
      }

      const workspaceContext = await this.resolveWorkspaceContext(normalized);
      if (!workspaceContext) {
        return;
      }

      await this.startTypingForUser(normalized);
      try {
        const reply = await this.runConversation({
          bindingKey: workspaceContext.bindingKey,
          workspaceRoot: workspaceContext.workspaceRoot,
          normalized,
        });
        await this.sendReplyToNormalized(normalized, reply);
      } finally {
        await this.stopTypingForUser(normalized.senderId);
      }
    } catch (error) {
      await this.stopTypingForUser(normalized.senderId);
      await this.sendReplyToUser(
        normalized.senderId,
        formatFailureText("处理失败", error),
        normalized.contextToken
      );
    }
  }

  isUserAllowed(senderId) {
    if (!Array.isArray(this.config.allowedUserIds) || !this.config.allowedUserIds.length) {
      return true;
    }
    return this.config.allowedUserIds.includes(senderId);
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
    this.sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, targetSessionId, this.buildBindingMetadata(normalized));
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
        message: getPermissionDeniedSource("wechat"),
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
      this.sessionStore.rememberApprovalCommandPrefixForWorkspace(active.workspaceRoot, pending.commandTokens);
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

    await sendWeixinMediaFile({
      filePath: resolvedPath,
      to: normalized.senderId,
      contextToken: normalized.contextToken || this.contextTokenByUserId.get(normalized.senderId) || "",
      baseUrl: this.account.baseUrl,
      token: this.account.token,
      cdnBaseUrl: this.config.cdnBaseUrl,
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
      "私聊图片/文件会自动保存到 .my_agent/inbox/wechat 并进入当前 turn；群聊附件需要 /mya 触发。",
      "支持 /mya approve、/mya approve workspace、/mya reject、/mya stop。",
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
          "当前会话还未绑定项目。先发送 `/mya bind /绝对路径`，或配置 MYA_CONNECT_WECHAT_DEFAULT_WORKSPACE。"
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
    const turnInput = await this.prepareTurnInput({ workspaceRoot, normalized });

    try {
      const { reply } = await this.executeTurnRun({
        bindingKey,
        workspaceRoot,
        normalized,
        turnContent: turnInput.content,
        turnText: turnInput.text,
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
        turnContent: turnInput.content,
        turnText: turnInput.text,
        sessionId: recreatedSessionId,
        resumeSessionId: "",
        params,
      });
      return reply;
    }
  }

  async prepareTurnInput({ workspaceRoot, normalized }) {
    const savedAttachments = await this.downloadIncomingAttachments({ workspaceRoot, normalized });
    const text = buildWechatTurnInputText(normalized, savedAttachments);
    return {
      text,
      content: buildMyaAttachmentInput({
        userText: normalized.text,
        attachments: savedAttachments,
      }) || text,
      savedAttachments,
    };
  }

  async downloadIncomingAttachments({ workspaceRoot, normalized }) {
    if (!Array.isArray(normalized.attachments) || !normalized.attachments.length) {
      return [];
    }

    const conversationKey = normalized.threadKey || normalized.chatId || normalized.senderId || "conversation";
    return downloadIncomingWeixinAttachments({
      workspaceRoot,
      conversationKey,
      messageId: normalized.messageId || crypto.randomUUID(),
      cdnBaseUrl: this.config.cdnBaseUrl,
      attachments: normalized.attachments,
    });
  }

  async executeTurnRun({ bindingKey, workspaceRoot, normalized, turnText, turnContent, sessionId, resumeSessionId, params }) {
    const turn = new MyaStreamTurn({
      myaCommand: this.config.myaCommand,
      workspaceRoot,
      sessionId,
      resumeSessionId,
      model: params.model || "",
      effort: params.effort || "",
      permissionMode: this.config.permissionMode,
      enableAutoMode: this.config.enableAutoMode,
    });
    const runtimeKey = this.buildRuntimeKey(bindingKey, workspaceRoot);
    const active = {
      bindingKey,
      workspaceRoot,
      turn,
      status: "running",
      pendingPermission: null,
      lastToolUse: null,
    };
    this.activeTurnByRuntimeKey.set(runtimeKey, active);
    this.attachTurnEventHandlers(active, normalized);

    try {
      const result = await turn.run(turnContent || turnText);
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
        text: turnText,
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

        const allowlist = this.sessionStore.getApprovalCommandAllowlistForWorkspace(active.workspaceRoot);
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

  async sendReplyToNormalized(normalized, text) {
    return this.sendReplyToUser(normalized.senderId, text, normalized.contextToken);
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

  async sendReplyToUser(userId, text, contextToken = "") {
    const resolvedToken = contextToken || this.contextTokenByUserId.get(userId) || "";
    if (!resolvedToken) {
      throw new Error(`缺少 context_token，无法回复用户 ${userId}`);
    }

    const plainText = markdownToPlainText(text) || "已完成。";
    const chunks = chunkReplyText(plainText);
    for (const chunk of chunks.length ? chunks : ["已完成。"]) {
      await sendMessage({
        baseUrl: this.account.baseUrl,
        token: this.account.token,
        body: {
          msg: {
            client_id: crypto.randomUUID(),
            from_user_id: "",
            to_user_id: userId,
            message_type: 2,
            message_state: 2,
            item_list: [
              {
                type: 1,
                text_item: { text: chunk },
              },
            ],
            context_token: resolvedToken,
          },
        },
      });
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

  async startTypingForUser(normalized) {
    if (!this.config.enableTyping) {
      return;
    }

    await this.stopTypingForUser(normalized.senderId);
    const contextToken = normalized.contextToken || this.contextTokenByUserId.get(normalized.senderId) || "";
    if (!contextToken) {
      return;
    }

    const configResponse = await getConfig({
      baseUrl: this.account.baseUrl,
      token: this.account.token,
      ilinkUserId: normalized.senderId,
      contextToken,
    }).catch(() => null);

    const typingTicket = typeof configResponse?.typing_ticket === "string"
      ? configResponse.typing_ticket.trim()
      : "";
    if (!typingTicket) {
      return;
    }

    const sendStatus = async (status) => {
      await sendTyping({
        baseUrl: this.account.baseUrl,
        token: this.account.token,
        body: {
          ilink_user_id: normalized.senderId,
          typing_ticket: typingTicket,
          status,
        },
      });
    };

    await sendStatus(1).catch(() => {});
    const timer = setInterval(() => {
      sendStatus(1).catch(() => {});
    }, TYPING_KEEPALIVE_MS);

    this.typingStopByUserId.set(normalized.senderId, async () => {
      clearInterval(timer);
      await sendStatus(2).catch(() => {});
    });
  }

  async stopTypingForUser(userId) {
    const stop = this.typingStopByUserId.get(userId);
    if (!stop) {
      return;
    }
    this.typingStopByUserId.delete(userId);
    await stop();
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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

module.exports = { WechatRuntime };

function buildWechatTurnInputText(normalized, savedAttachments) {
  const userText = String(normalized?.text || "").trim();
  const attachments = Array.isArray(savedAttachments) ? savedAttachments : [];
  if (!attachments.length) {
    return userText;
  }

  const lines = [
    "微信用户发送了附件。",
    "附件：",
  ];
  for (const attachment of attachments) {
    lines.push(`- ${attachment.kind}: ${attachment.relativePath}`);
  }

  if (userText) {
    lines.push("", "用户说明：", userText);
  } else {
    lines.push("", "请先查看这些附件，并根据附件内容继续处理。");
  }

  return lines.join("\n");
}

module.exports.buildWechatTurnInputText = buildWechatTurnInputText;

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
