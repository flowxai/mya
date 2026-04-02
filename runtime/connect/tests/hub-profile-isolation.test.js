const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { SessionStore } = require("../src/infra/storage/session-store");
const { persistInboxAttachments } = require("../src/infra/attachments/inbox");
const { normalizeFeishuIncomingMessage } = require("../src/infra/feishu/message-utils");
const { normalizeWeixinIncomingMessage } = require("../src/infra/weixin/message-utils");

test("same sender in different profiles does not share session binding keys", () => {
  const filePath = path.join(os.tmpdir(), `mya-connect-session-store-${Date.now()}-${Math.random()}.json`);
  const store = new SessionStore({ filePath });

  const keyA = store.buildBindingKey({
    profileId: "review-bot",
    workspaceId: "default",
    accountId: "feishu-app-a",
    senderId: "user:alice",
  });
  const keyB = store.buildBindingKey({
    profileId: "ops-bot",
    workspaceId: "default",
    accountId: "feishu-app-a",
    senderId: "user:alice",
  });

  assert.notEqual(keyA, keyB);
});

test("persistInboxAttachments partitions inbox paths by profileId", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mya-connect-profile-inbox-"));

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const reviewSaved = await persistInboxAttachments({
    workspaceRoot,
    profileId: "review-bot",
    channel: "feishu",
    conversationId: "chat:oc_group_1",
    senderId: "user:ou_review_user",
    attachments: [
      {
        kind: "file",
        fileName: "review-notes.md",
        mimeType: "text/markdown",
        data: Buffer.from("review"),
      },
    ],
  });
  const opsSaved = await persistInboxAttachments({
    workspaceRoot,
    profileId: "ops-bot",
    channel: "feishu",
    conversationId: "chat:oc_group_1",
    senderId: "user:ou_ops_user",
    attachments: [
      {
        kind: "file",
        fileName: "ops-notes.md",
        mimeType: "text/markdown",
        data: Buffer.from("ops"),
      },
    ],
  });

  assert.match(reviewSaved[0].relativePath, /^\.mya\/inbox\/review-bot\/feishu\/chat_oc_group_1\//);
  assert.match(opsSaved[0].relativePath, /^\.mya\/inbox\/ops-bot\/feishu\/chat_oc_group_1\//);
});

test("normalized incoming messages carry profileId when provided by hub runtime config", () => {
  const feishuNormalized = normalizeFeishuIncomingMessage(
    {
      sender: {
        sender_id: {
          open_id: "ou_user_1",
        },
      },
      message: {
        message_id: "om_test_1",
        chat_id: "oc_p2p_1",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "你好" }),
      },
    },
    {
      appId: "cli_test",
      defaultWorkspaceId: "default",
      enableGroupAtMessages: true,
      profileId: "review-bot",
    }
  );
  const wechatNormalized = normalizeWeixinIncomingMessage(
    {
      from_user_id: "wx-user-1",
      session_id: "session-1",
      message_id: "msg-1",
      message_type: 1,
      context_token: "ctx-1",
      item_list: [
        {
          type: 1,
          text_item: {
            text: "/mya where",
          },
        },
      ],
    },
    {
      defaultWorkspaceId: "default",
      profileId: "ops-bot",
    },
    "account-a",
  );

  assert.equal(feishuNormalized.profileId, "review-bot");
  assert.equal(wechatNormalized.profileId, "ops-bot");
});
