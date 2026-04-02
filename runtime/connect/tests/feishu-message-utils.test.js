const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeFeishuIncomingMessage } = require("../src/infra/feishu/message-utils");

const BASE_CONFIG = {
  appId: "cli_test",
  defaultWorkspaceId: "default",
  enableGroupAtMessages: true,
};

test("normalizeFeishuIncomingMessage handles p2p text messages", () => {
  const normalized = normalizeFeishuIncomingMessage(
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
    BASE_CONFIG
  );

  assert.equal(normalized.senderId, "user:ou_user_1");
  assert.equal(normalized.chatId, "oc_p2p_1");
  assert.equal(normalized.text, "你好");
  assert.equal(normalized.command, "message");
  assert.equal(normalized.profileId, "");
});

test("normalizeFeishuIncomingMessage strips group mention placeholders", () => {
  const normalized = normalizeFeishuIncomingMessage(
    {
      sender: {
        sender_id: {
          open_id: "ou_user_2",
        },
      },
      message: {
        message_id: "om_test_2",
        chat_id: "oc_group_1",
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({ text: "@_user_1 /mya where" }),
        mentions: [
          {
            key: "@_user_1",
            name: "mya",
          },
        ],
      },
    },
    BASE_CONFIG
  );

  assert.equal(normalized.senderId, "chat:oc_group_1");
  assert.equal(normalized.text, "/mya where");
  assert.equal(normalized.command, "where");
});

test("normalizeFeishuIncomingMessage ignores non-mentioned group messages", () => {
  const normalized = normalizeFeishuIncomingMessage(
    {
      sender: {
        sender_id: {
          open_id: "ou_user_3",
        },
      },
      message: {
        message_id: "om_test_3",
        chat_id: "oc_group_2",
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({ text: "hello" }),
        mentions: [],
      },
    },
    BASE_CONFIG
  );

  assert.equal(normalized, null);
});

test("normalizeFeishuIncomingMessage handles p2p image attachments", () => {
  const normalized = normalizeFeishuIncomingMessage(
    {
      sender: {
        sender_id: {
          open_id: "ou_user_4",
        },
      },
      message: {
        message_id: "om_test_image_1",
        chat_id: "oc_p2p_image_1",
        chat_type: "p2p",
        message_type: "image",
        content: JSON.stringify({ image_key: "img_key_1" }),
      },
    },
    BASE_CONFIG
  );

  assert.equal(normalized.senderId, "user:ou_user_4");
  assert.equal(normalized.chatId, "oc_p2p_image_1");
  assert.equal(normalized.command, "");
  assert.equal(normalized.unsupportedMessageType, "");
  assert.deepEqual(normalized.attachment, {
    kind: "image",
    resourceType: "image",
    fileKey: "img_key_1",
    fileName: "",
  });
});

test("normalizeFeishuIncomingMessage ignores group file attachments without trigger", () => {
  const normalized = normalizeFeishuIncomingMessage(
    {
      sender: {
        sender_id: {
          open_id: "ou_user_5",
        },
      },
      message: {
        message_id: "om_test_file_1",
        chat_id: "oc_group_file_1",
        chat_type: "group",
        message_type: "file",
        content: JSON.stringify({
          file_key: "file_key_1",
          file_name: "report.pdf",
        }),
        mentions: [],
      },
    },
    BASE_CONFIG
  );

  assert.equal(normalized, null);
});

test("normalizeFeishuIncomingMessage accepts group file attachments when @mya is present", () => {
  const normalized = normalizeFeishuIncomingMessage(
    {
      sender: {
        sender_id: {
          open_id: "ou_user_6",
        },
      },
      message: {
        message_id: "om_test_file_2",
        chat_id: "oc_group_file_2",
        chat_type: "group",
        message_type: "file",
        content: JSON.stringify({
          file_key: "file_key_2",
          file_name: "report.pdf",
          text: "@_user_1 请看这个文件",
        }),
        mentions: [
          {
            key: "@_user_1",
            name: "mya",
          },
        ],
      },
    },
    BASE_CONFIG
  );

  assert.equal(normalized.senderId, "chat:oc_group_file_2");
  assert.equal(normalized.text, "请看这个文件");
  assert.equal(normalized.command, "");
  assert.deepEqual(normalized.attachment, {
    kind: "file",
    resourceType: "file",
    fileKey: "file_key_2",
    fileName: "report.pdf",
  });
});

test("normalizeFeishuIncomingMessage carries profileId from runtime config", () => {
  const normalized = normalizeFeishuIncomingMessage(
    {
      sender: {
        sender_id: {
          open_id: "ou_user_profile",
        },
      },
      message: {
        message_id: "om_profile_1",
        chat_id: "oc_profile_1",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "继续昨天那个任务" }),
      },
    },
    {
      ...BASE_CONFIG,
      profileId: "review-bot",
    }
  );

  assert.equal(normalized.profileId, "review-bot");
});
