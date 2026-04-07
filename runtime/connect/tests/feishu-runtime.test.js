const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { FeishuRuntime } = require("../src/app/feishu-runtime");

function createRuntime(overrides = {}) {
  return new FeishuRuntime({
    appId: "cli_test",
    appSecret: "secret_test",
    sessionsFile: path.join(os.tmpdir(), `mya-connect-feishu-runtime-${Date.now()}-${Math.random()}.json`),
    workspaceAllowlist: [],
    permissionMode: "default",
    enableAutoMode: false,
    ...overrides,
  });
}

function createNormalized(text) {
  return {
    provider: "feishu",
    workspaceId: "default",
    accountId: "cli_test",
    chatId: "oc_test_chat",
    threadKey: "",
    senderId: "user:ou_test_user",
    senderOpenId: "ou_test_user",
    messageId: "om_test_message",
    chatType: "p2p",
    messageType: "text",
    unsupportedMessageType: "",
    text,
    command: "send",
    receivedAt: new Date().toISOString(),
  };
}

test("FeishuRuntime.handleSendCommand sends an existing workspace file", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mya-connect-feishu-runtime-"));
  const filePath = path.join(tempDir, "docs", "report.txt");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "hello");

  const runtime = createRuntime();
  const sentFiles = [];
  const replies = [];

  runtime.resolveWorkspaceContext = async () => ({ bindingKey: "binding", workspaceRoot: tempDir });
  runtime.sendReplyToNormalized = async (_normalized, text) => {
    replies.push(text);
  };
  runtime.sendFileToNormalized = async (_normalized, payload) => {
    sentFiles.push(payload);
  };

  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  await runtime.handleSendCommand(createNormalized("/mya send docs/report.txt"));

  assert.deepEqual(replies, []);
  assert.equal(sentFiles.length, 1);
  assert.equal(sentFiles[0].requestedPath, "docs/report.txt");
  assert.equal(sentFiles[0].filePath, filePath);
});

test("FeishuRuntime.handleSendCommand rejects paths outside the bound workspace", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mya-connect-feishu-runtime-"));
  const runtime = createRuntime();
  const replies = [];

  runtime.resolveWorkspaceContext = async () => ({ bindingKey: "binding", workspaceRoot: tempDir });
  runtime.sendReplyToNormalized = async (_normalized, text) => {
    replies.push(text);
  };
  runtime.sendFileToNormalized = async () => {
    throw new Error("sendFileToNormalized should not be called");
  };

  try {
    await runtime.handleSendCommand(createNormalized("/mya send ../secret.txt"));
    assert.deepEqual(replies, ["只允许发送当前项目目录内的文件。"]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("FeishuRuntime.handleSendCommand reports a missing file", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mya-connect-feishu-runtime-"));
  const runtime = createRuntime();
  const replies = [];

  runtime.resolveWorkspaceContext = async () => ({ bindingKey: "binding", workspaceRoot: tempDir });
  runtime.sendReplyToNormalized = async (_normalized, text) => {
    replies.push(text);
  };
  runtime.sendFileToNormalized = async () => {
    throw new Error("sendFileToNormalized should not be called");
  };

  try {
    await runtime.handleSendCommand(createNormalized("/mya send missing.txt"));
    assert.deepEqual(replies, ["文件不存在: missing.txt"]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("FeishuRuntime.handleNormalized downloads inbound image attachments into the workspace inbox", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mya-connect-feishu-attachment-runtime-"));
  const runtime = createRuntime();
  const replies = [];
  const prompts = [];
  const originalFetch = global.fetch;

  runtime.resolveWorkspaceContext = async () => ({ bindingKey: "binding", workspaceRoot: tempDir });
  runtime.runConversation = async ({ normalized }) => {
    prompts.push(normalized.text);
    return "attachment processed";
  };
  runtime.sendReplyToNormalized = async (_normalized, text) => {
    replies.push(text);
  };
  runtime.getTenantAccessToken = async () => "tenant-token";

  global.fetch = async (url, options = {}) => {
    assert.equal(
      url,
      "https://open.feishu.cn/open-apis/im/v1/messages/om_attachment_1/resources/img_key_runtime?type=image"
    );
    assert.equal(options.headers.Authorization, "Bearer tenant-token");
    return new Response(Buffer.from("png-bytes"), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
      },
    });
  };

  t.after(async () => {
    global.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  await runtime.handleNormalized({
    provider: "feishu",
    workspaceId: "default",
    accountId: "cli_test",
    chatId: "oc_test_chat",
    threadKey: "",
    senderId: "user:ou_test_user",
    senderOpenId: "ou_test_user",
    messageId: "om_attachment_1",
    chatType: "p2p",
    messageType: "image",
    unsupportedMessageType: "",
    text: "",
    command: "",
    receivedAt: new Date().toISOString(),
    attachment: {
      kind: "image",
      resourceType: "image",
      fileKey: "img_key_runtime",
      fileName: "",
    },
  });

  const expectedRelativePath = ".mya/inbox/feishu/oc_test_chat/om_attachment_1-image.png";
  const expectedAbsolutePath = path.join(tempDir, expectedRelativePath);

  assert.equal(await fs.readFile(expectedAbsolutePath, "utf8"), "png-bytes");
  assert.equal(replies.at(-1), "attachment processed");
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], new RegExp(expectedRelativePath.replace(/\./g, "\\.")));
});

test("FeishuRuntime normalizes injected profile context and forwards it into turn execution", async () => {
  const injectedSessionsFile = path.join(
    os.tmpdir(),
    `mya-connect-feishu-runtime-profile-${Date.now()}-${Math.random()}.json`
  );
  const runtime = createRuntime({
    profileContext: {
      profileId: " team-alpha ",
      channelInstanceId: " feishu-primary ",
      workspaceAllowlist: [" /tmp/project-a ", "", "/tmp/project-b"],
      memoryNamespace: " profile/team-alpha ",
      sessionsFile: injectedSessionsFile,
    },
  });
  let captured = null;

  runtime.executeTurnRun = async (input) => {
    captured = input;
    return { reply: "ok" };
  };

  const reply = await runtime.runConversation({
    bindingKey: "binding",
    workspaceRoot: "/tmp/project-a",
    normalized: createNormalized("hello"),
  });

  assert.equal(reply, "ok");
  assert.deepEqual(runtime.runtimeContext, {
    profile: null,
    profileId: "team-alpha",
    channelInstanceId: "feishu-primary",
    workspaceAllowlist: ["/tmp/project-a", "/tmp/project-b"],
    memoryNamespace: "profile/team-alpha",
    sessionsFile: injectedSessionsFile,
  });
  assert.equal(runtime.config.profileId, "team-alpha");
  assert.equal(runtime.config.channelInstanceId, "feishu-primary");
  assert.equal(runtime.config.memoryNamespace, "profile/team-alpha");
  assert.deepEqual(runtime.config.workspaceAllowlist, ["/tmp/project-a", "/tmp/project-b"]);
  assert.equal(runtime.sessionStore.filePath, injectedSessionsFile);
  assert.deepEqual(captured.runtimeContext, runtime.runtimeContext);
});

test("FeishuRuntime bypasses the queue for /mya status", () => {
  const runtime = createRuntime();

  assert.equal(runtime.shouldBypassQueue({ command: "inspect_status" }), true);
  assert.equal(runtime.shouldBypassQueue({ command: "inspect_message" }), false);
});

test("FeishuRuntime buildStatusText renders the bot work panel", () => {
  const runtime = createRuntime({
    profileContext: {
      profileId: "review-bot",
    },
  });
  const bindingKey = "binding";
  const workspaceRoot = "/tmp/repo";

  runtime.sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, "session-123", {
    workspaceId: "default",
    accountId: "cli_test",
    senderId: "user:ou_test_user",
  });
  runtime.activeTurnByRuntimeKey.set(runtime.buildRuntimeKey(bindingKey, workspaceRoot), {
    bindingKey,
    workspaceRoot,
    runtimeContext: runtime.runtimeContext,
    turn: null,
    status: "requires_action",
    pendingPermission: {
      toolName: "Bash",
      commandPreview: "git commit",
    },
    lastToolUse: {
      type: "tool_use",
      toolName: "Bash",
      toolUseId: "tool-1",
    },
    lastProgress: null,
    startedAt: "2026-04-03T07:40:00.000Z",
    lastEventAt: "2026-04-03T07:40:12.000Z",
  });

  const text = runtime.buildStatusText(bindingKey, workspaceRoot);

  assert.match(text, /\[mya status\]/);
  assert.match(text, /BOT\s+review-bot/);
  assert.match(text, /STATE\s+WAITING/);
  assert.match(text, /HEALTH\s+BLOCKED/);
  assert.match(text, /STUCK\s+NO/);
  assert.match(text, /WAITING\s+permission approval/);
  assert.match(text, /LAST\s+Bash -> git commit/);
});

test("FeishuRuntime stop confirms the running turn is actually stopped", async () => {
  const runtime = createRuntime({
    defaultWorkspaceRoot: "/tmp/repo",
    profileContext: {
      profileId: "review-bot",
    },
  });
  const normalized = {
    provider: "feishu",
    workspaceId: "default",
    accountId: "cli_test",
    chatId: "oc_test_chat",
    threadKey: "",
    senderId: "user:ou_test_user",
    senderOpenId: "ou_test_user",
    messageId: "om_test_message",
    chatType: "p2p",
    messageType: "text",
    unsupportedMessageType: "",
    text: "/mya stop",
    command: "stop",
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

test("FeishuRuntime notifyTaskCompletion sends the summary to the latest bound chat", async () => {
  const runtime = createRuntime({
    appId: "cli_test",
    profileContext: {
      profileId: "mail-bot",
    },
  });
  const bindingKey = "mail-bot:default:cli_test:user:ou_test_user";
  const workspaceRoot = "/tmp/mail-bot";
  const sent = [];

  runtime.sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, "session-321", {
    workspaceId: "default",
    accountId: "cli_test",
    senderId: "user:ou_test_user",
    chatId: "oc_test_chat",
  });
  runtime.sendTextToChat = async (chatId, text) => {
    sent.push({ chatId, text });
  };

  const result = await runtime.notifyTaskCompletion({
    profileId: "mail-bot",
    trigger: "schedule",
    workspaceRoot,
    taskId: "task-321",
    state: "completed",
    updatedAt: "2026-04-04T04:14:04.367Z",
    command: "python3 on_wake.py",
    lastOutputSummary: "日报已发送",
  });

  assert.equal(result.delivered, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, "oc_test_chat");
  assert.match(sent[0].text, /\[mya scheduled task report\]/);
  assert.match(sent[0].text, /TASK ID\s+task-321/);
  assert.match(sent[0].text, /COMMAND\s+python3 on_wake\.py/);
  assert.match(sent[0].text, /REPORT/);
  assert.match(sent[0].text, /日报已发送/);
});

test("FeishuRuntime notifyTaskCompletion honors an explicit binding key route", async () => {
  const runtime = createRuntime({
    appId: "cli_test",
    profileContext: {
      profileId: "mail-bot",
    },
  });
  const workspaceRoot = "/tmp/mail-bot";
  const sent = [];

  runtime.sessionStore.setThreadIdForWorkspace("mail-bot:default:cli_test:user:ou_test_user_1", workspaceRoot, "session-1", {
    workspaceId: "default",
    accountId: "cli_test",
    senderId: "user:ou_test_user_1",
    chatId: "oc_test_chat_1",
  });
  runtime.sessionStore.setThreadIdForWorkspace("mail-bot:default:cli_test:user:ou_test_user_2", workspaceRoot, "session-2", {
    workspaceId: "default",
    accountId: "cli_test",
    senderId: "user:ou_test_user_2",
    chatId: "oc_test_chat_2",
  });
  runtime.sendTextToChat = async (chatId, text) => {
    sent.push({ chatId, text });
  };

  const result = await runtime.notifyTaskCompletion({
    profileId: "mail-bot",
    trigger: "schedule",
    workspaceRoot,
    taskId: "task-322",
    state: "completed",
    notification: {
      bindingKey: "mail-bot:default:cli_test:user:ou_test_user_1",
    },
    lastOutputSummary: "日报已发送",
  });

  assert.equal(result.delivered, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, "oc_test_chat_1");
});
