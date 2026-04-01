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

  const expectedRelativePath = ".my_agent/inbox/feishu/oc_test_chat/om_attachment_1-image.png";
  const expectedAbsolutePath = path.join(tempDir, expectedRelativePath);

  assert.equal(await fs.readFile(expectedAbsolutePath, "utf8"), "png-bytes");
  assert.equal(replies.at(-1), "attachment processed");
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], new RegExp(expectedRelativePath.replace(/\./g, "\\.")));
});
