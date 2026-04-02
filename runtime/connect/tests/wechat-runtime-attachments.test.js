const test = require("node:test");
const assert = require("node:assert/strict");
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
