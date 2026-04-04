const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const os = require("os");
const path = require("path");

const { WechatRuntime, buildWechatTurnInputText } = require("../src/app/wechat-runtime");

function createRuntime(overrides = {}) {
  return new WechatRuntime({
    sessionsFile: path.join(os.tmpdir(), `mya-connect-wechat-runtime-${Date.now()}-${Math.random()}.json`),
    workspaceAllowlist: [],
    permissionMode: "default",
    enableAutoMode: false,
    ...overrides,
  });
}

test("buildWechatTurnInputText includes saved attachment paths and user text", () => {
  const text = buildWechatTurnInputText(
    {
      text: "帮我总结一下这两个附件",
    },
    [
      {
        kind: "image",
        relativePath: ".mya/inbox/wechat/room-1/msg-1-image-1.png",
      },
      {
        kind: "file",
        relativePath: ".mya/inbox/wechat/room-1/msg-1-report.pdf",
      },
    ],
  );

  assert.match(text, /微信用户发送了附件/);
  assert.match(text, /image: \.mya\/inbox\/wechat\/room-1\/msg-1-image-1\.png/);
  assert.match(text, /file: \.mya\/inbox\/wechat\/room-1\/msg-1-report\.pdf/);
  assert.match(text, /用户说明：/);
  assert.match(text, /帮我总结一下这两个附件/);
});

test("buildWechatTurnInputText creates a default prompt for attachment-only messages", () => {
  const text = buildWechatTurnInputText(
    {
      text: "",
    },
    [
      {
        kind: "image",
        relativePath: ".mya/inbox/wechat/room-1/msg-2-image-1.png",
      },
    ],
  );

  assert.match(text, /请先查看这些附件/);
  assert.match(text, /msg-2-image-1\.png/);
});

test("WechatRuntime normalizes injected profile context and forwards it into turn execution", async () => {
  const injectedSessionsFile = path.join(
    os.tmpdir(),
    `mya-connect-wechat-runtime-profile-${Date.now()}-${Math.random()}.json`
  );
  const runtime = createRuntime({
    profileContext: {
      profileId: " ops-bot ",
      channelInstanceId: " wechat-main ",
      workspaceAllowlist: [" /tmp/wechat-a ", "", "/tmp/wechat-b"],
      memoryNamespace: " profiles/ops ",
      sessionsFile: injectedSessionsFile,
    },
  });
  let captured = null;

  runtime.prepareTurnInput = async () => ({
    text: "hello from wechat",
    content: "hello from wechat",
  });
  runtime.executeTurnRun = async (input) => {
    captured = input;
    return { reply: "ok" };
  };

  const reply = await runtime.runConversation({
    bindingKey: "binding",
    workspaceRoot: "/tmp/wechat-a",
    normalized: {
      text: "hello from wechat",
    },
  });

  assert.equal(reply, "ok");
  assert.deepEqual(runtime.runtimeContext, {
    profile: null,
    profileId: "ops-bot",
    channelInstanceId: "wechat-main",
    workspaceAllowlist: ["/tmp/wechat-a", "/tmp/wechat-b"],
    memoryNamespace: "profiles/ops",
    sessionsFile: injectedSessionsFile,
  });
  assert.equal(runtime.config.profileId, "ops-bot");
  assert.equal(runtime.config.channelInstanceId, "wechat-main");
  assert.equal(runtime.config.memoryNamespace, "profiles/ops");
  assert.deepEqual(runtime.config.workspaceAllowlist, ["/tmp/wechat-a", "/tmp/wechat-b"]);
  assert.equal(runtime.sessionStore.filePath, injectedSessionsFile);
  assert.deepEqual(captured.runtimeContext, runtime.runtimeContext);
});

test("WechatRuntime bypasses the queue for /mya status", () => {
  const runtime = createRuntime();

  assert.equal(runtime.shouldBypassQueue({ command: "inspect_status" }), true);
  assert.equal(runtime.shouldBypassQueue({ command: "inspect_message" }), false);
});

test("buildRecentConversationText includes live tool and progress details", () => {
  const runtime = createRuntime({
    profileContext: {
      profileId: "review-bot",
    },
  });
  const bindingKey = "binding";
  const workspaceRoot = "/tmp/repo";

  runtime.sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, "session-123", {
    workspaceId: "default",
    accountId: "wx-account",
    senderId: "wx-user-1",
  });
  runtime.sessionStore.appendRecentConversationEntry(bindingKey, workspaceRoot, {
    role: "user",
    text: "帮我看看这个报错",
  });
  runtime.activeTurnByRuntimeKey.set(runtime.buildRuntimeKey(bindingKey, workspaceRoot), {
    bindingKey,
    workspaceRoot,
    runtimeContext: runtime.runtimeContext,
    turn: null,
    status: "running",
    pendingPermission: null,
    lastToolUse: {
      type: "tool_use",
      toolName: "Bash",
      toolUseId: "tool-1",
    },
    lastProgress: {
      type: "tool_progress",
      toolName: "Bash",
      toolUseId: "tool-1",
      elapsedTimeSeconds: 12,
    },
    startedAt: "2026-04-03T07:40:00.000Z",
    lastEventAt: "2026-04-03T07:40:12.000Z",
  });

  const text = runtime.buildRecentConversationText(bindingKey, workspaceRoot, {
    now: new Date("2026-04-03T07:40:15.000Z"),
  });

  assert.match(text, /\[mya status\]/);
  assert.match(text, /BOT\s+review-bot/);
  assert.match(text, /STATE\s+RUNNING/);
  assert.match(text, /HEALTH\s+HEALTHY/);
  assert.match(text, /CURRENT\s+Bash/);
  assert.match(text, /STEP\s+正在执行 Bash \(12s\)/);
  assert.match(text, /- user: 帮我看看这个报错/);
});

test("buildStatusText includes live tool and progress details without conversation history", () => {
  const runtime = createRuntime({
    profileContext: {
      profileId: "review-bot",
    },
  });
  const bindingKey = "binding";
  const workspaceRoot = "/tmp/repo";

  runtime.sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, "session-123", {
    workspaceId: "default",
    accountId: "wx-account",
    senderId: "wx-user-1",
  });
  runtime.sessionStore.appendRecentConversationEntry(bindingKey, workspaceRoot, {
    role: "user",
    text: "帮我看看这个报错",
  });
  runtime.activeTurnByRuntimeKey.set(runtime.buildRuntimeKey(bindingKey, workspaceRoot), {
    bindingKey,
    workspaceRoot,
    runtimeContext: runtime.runtimeContext,
    turn: null,
    status: "running",
    pendingPermission: null,
    lastToolUse: {
      type: "tool_use",
      toolName: "Bash",
      toolUseId: "tool-1",
    },
    lastProgress: {
      type: "tool_progress",
      toolName: "Bash",
      toolUseId: "tool-1",
      elapsedTimeSeconds: 12,
    },
    startedAt: "2026-04-03T07:40:00.000Z",
    lastEventAt: "2026-04-03T07:40:12.000Z",
  });

  const text = runtime.buildStatusText(bindingKey, workspaceRoot, {
    now: new Date("2026-04-03T07:40:15.000Z"),
  });

  assert.match(text, /\[mya status\]/);
  assert.match(text, /BOT\s+review-bot/);
  assert.match(text, /STATE\s+RUNNING/);
  assert.match(text, /HEALTH\s+HEALTHY/);
  assert.match(text, /STUCK\s+NO/);
  assert.match(text, /CURRENT\s+Bash/);
  assert.match(text, /STEP\s+正在执行 Bash/);
  assert.match(text, /BACKGROUND\s+running:0\s+queued:0\s+failed:0/);
  assert.doesNotMatch(text, /recent:/);
  assert.doesNotMatch(text, /帮我看看这个报错/);
});

test("buildStatusText does not present stale tools as current work after the bot is idle", () => {
  const runtime = createRuntime({
    profileContext: {
      profileId: "review-bot",
    },
  });
  const bindingKey = "binding";
  const workspaceRoot = "/tmp/repo";
  runtime.sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, "session-123", {
    workspaceId: "default",
    accountId: "wx-account",
    senderId: "wx-user-1",
  });
  runtime.recentStatusByRuntimeKey.set(runtime.buildRuntimeKey(bindingKey, workspaceRoot), {
    runtimeContext: runtime.runtimeContext,
    status: "idle",
    pendingPermission: null,
    lastToolUse: {
      type: "tool_use",
      toolName: "Bash",
      toolUseId: "tool-1",
      input: { command: "npm test" },
    },
    lastProgress: null,
    lastError: "",
    lastResultSummary: "已完成 PR 检查",
    startedAt: "2026-04-03T07:40:00.000Z",
    lastEventAt: "2026-04-03T07:40:12.000Z",
    lastUpdatedAt: "2026-04-03T07:40:20.000Z",
    finishedAt: "2026-04-03T07:40:20.000Z",
  });

  const text = runtime.buildStatusText(bindingKey, workspaceRoot, {
    now: new Date("2026-04-03T07:40:25.000Z"),
  });

  assert.match(text, /STATE\s+IDLE/);
  assert.match(text, /CURRENT\s+none/);
  assert.match(text, /LAST\s+assistant -> 已完成 PR 检查/);
  assert.match(text, /BACKGROUND\s+running:0\s+queued:0\s+failed:0/);
});

test("buildStatusText marks a running turn as stuck after a long silent period", () => {
  const runtime = createRuntime({
    profileContext: {
      profileId: "review-bot",
    },
  });
  const bindingKey = "binding";
  const workspaceRoot = "/tmp/repo";

  runtime.sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, "session-123", {
    workspaceId: "default",
    accountId: "wx-account",
    senderId: "wx-user-1",
  });
  runtime.activeTurnByRuntimeKey.set(runtime.buildRuntimeKey(bindingKey, workspaceRoot), {
    bindingKey,
    workspaceRoot,
    runtimeContext: runtime.runtimeContext,
    turn: null,
    status: "running",
    pendingPermission: null,
    lastToolUse: {
      type: "tool_use",
      toolName: "Bash",
      toolUseId: "tool-1",
    },
    lastProgress: null,
    startedAt: "2026-04-03T07:40:00.000Z",
    lastEventAt: "2026-04-03T07:40:00.000Z",
  });

  const text = runtime.buildStatusText(bindingKey, workspaceRoot, {
    now: new Date("2026-04-03T07:40:31.000Z"),
  });

  assert.match(text, /HEALTH\s+DEGRADED/);
  assert.match(text, /STUCK\s+YES \(31s no progress\)/);
  assert.match(text, /WAITING\s+tool output/);
});

test("WechatRuntime sends a progress update for long-running tools", async () => {
  const runtime = createRuntime({
    profileContext: {
      profileId: "review-bot",
    },
  });
  const turn = new EventEmitter();
  const replies = [];
  const active = {
    bindingKey: "binding",
    workspaceRoot: "/tmp/repo",
    runtimeContext: runtime.runtimeContext,
    turn,
    status: "running",
    pendingPermission: null,
    lastToolUse: null,
    lastProgress: null,
    progressNotificationsSent: new Set(),
  };
  const normalized = {
    senderId: "wx-user-1",
    contextToken: "ctx-1",
    profileId: "review-bot",
    accountId: "wx-account",
  };

  runtime.sendReplyToNormalized = async (_normalized, text) => {
    replies.push(text);
  };
  runtime.attachTurnEventHandlers(active, normalized);

  turn.emit("event", {
    type: "tool_use",
    toolName: "Bash",
    toolUseId: "tool-1",
    input: { command: "npm test" },
  });
  turn.emit("event", {
    type: "tool_progress",
    toolName: "Bash",
    toolUseId: "tool-1",
    elapsedTimeSeconds: 12,
  });

  assert.equal(active.lastProgress.toolName, "Bash");
  assert.equal(replies.length, 1);
  assert.match(replies[0], /当前还在处理中/);
  assert.match(replies[0], /current-tool: Bash/);
  assert.match(replies[0], /progress: Bash \(12s\)/);
});

test("WechatRuntime stop confirms the running turn is actually stopped", async () => {
  const runtime = createRuntime({
    defaultWorkspaceRoot: "/tmp/repo",
    profileContext: {
      profileId: "review-bot",
    },
  });
  const normalized = {
    provider: "weixin",
    profileId: "review-bot",
    workspaceId: "default",
    accountId: "wx-account",
    chatId: "wx-user-1",
    threadKey: "wx-user-1",
    senderId: "wx-user-1",
    messageId: "message-1",
    text: "/mya stop",
    rawText: "/mya stop",
    command: "stop",
    contextToken: "ctx-1",
    attachments: [],
    hasBotTrigger: true,
    isGroupChat: false,
    receivedAt: new Date().toISOString(),
  };
  const bindingKey = runtime.sessionStore.buildBindingKey(normalized);
  runtime.sessionStore.setActiveWorkspaceRoot(bindingKey, "/tmp/repo");
  runtime.activeTurnByRuntimeKey.set(runtime.buildRuntimeKey(bindingKey, "/tmp/repo"), {
    bindingKey,
    workspaceRoot: "/tmp/repo",
    runtimeContext: runtime.runtimeContext,
    turn: {
      async stop() {
        return { stopped: true, forced: true };
      },
    },
    status: "running",
    pendingPermission: null,
    lastToolUse: null,
    lastProgress: null,
  });

  const replies = [];
  runtime.sendReplyToNormalized = async (_normalized, text) => {
    replies.push(text);
  };

  await runtime.handleStopCommand(normalized);

  assert.equal(replies.length, 1);
  assert.match(replies[0], /已强制停止当前任务/);
});

test("WechatRuntime notifyTaskCompletion sends the summary to the latest bound user", async () => {
  const runtime = createRuntime({
    accountId: "wx-main",
    profileContext: {
      profileId: "mail-bot",
    },
  });
  const bindingKey = "mail-bot:default:wx-main:user-1";
  const workspaceRoot = "/tmp/mail-bot";
  const sent = [];

  runtime.account = {
    accountId: "wx-main",
    token: "token",
    baseUrl: "https://example.com",
  };
  runtime.sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, "session-789", {
    workspaceId: "default",
    accountId: "wx-main",
    senderId: "user-1",
    contextToken: "ctx-1",
  });
  runtime.sendReplyToUser = async (userId, text, contextToken) => {
    sent.push({ userId, text, contextToken });
  };

  const result = await runtime.notifyTaskCompletion({
    profileId: "mail-bot",
    trigger: "schedule",
    workspaceRoot,
    taskId: "task-789",
    state: "completed",
    updatedAt: "2026-04-04T04:14:04.367Z",
    command: "python3 on_wake.py",
    lastOutputSummary: "日报已发送",
  });

  assert.equal(result.delivered, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].userId, "user-1");
  assert.equal(sent[0].contextToken, "ctx-1");
  assert.match(sent[0].text, /\[mya scheduled task report\]/);
  assert.match(sent[0].text, /TASK ID\s+task-789/);
  assert.match(sent[0].text, /COMMAND\s+python3 on_wake\.py/);
  assert.match(sent[0].text, /REPORT/);
  assert.match(sent[0].text, /日报已发送/);
});
