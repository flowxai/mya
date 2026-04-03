const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeWeixinIncomingMessage,
  parseCommand,
} = require("../src/infra/weixin/message-utils");
const {
  extractBindPath,
  extractEffortValue,
  extractModelValue,
} = require("../src/shared/command-parsing");

test("parseCommand recognizes /mya commands and leaves normal text as message", () => {
  assert.equal(parseCommand("/mya help"), "help");
  assert.equal(parseCommand("/mya bind /tmp/demo"), "bind");
  assert.equal(parseCommand("/mya model sonnet"), "model");
  assert.equal(parseCommand("/mya effort high"), "effort");
  assert.equal(parseCommand("/mya status"), "inspect_status");
  assert.equal(parseCommand("你好，帮我看下这个目录"), "message");
});

test("command parsing extracts /mya arguments", () => {
  assert.equal(extractBindPath("/mya bind /tmp/demo"), "/tmp/demo");
  assert.equal(extractModelValue("/mya model sonnet"), "sonnet");
  assert.equal(extractEffortValue("/mya effort high"), "high");
});

test("normalizeWeixinIncomingMessage classifies /mya commands", () => {
  const normalized = normalizeWeixinIncomingMessage(
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
    { defaultWorkspaceId: "default" },
    "account-a",
  );

  assert.equal(normalized.command, "where");
  assert.equal(normalized.senderId, "wx-user-1");
  assert.equal(normalized.contextToken, "ctx-1");
  assert.equal(normalized.profileId, "");
});

test("normalizeWeixinIncomingMessage keeps private attachments as conversation input", () => {
  const normalized = normalizeWeixinIncomingMessage(
    {
      from_user_id: "wx-user-1",
      session_id: "wx-user-1",
      message_id: "msg-image-1",
      message_type: 1,
      context_token: "ctx-image-1",
      item_list: [
        {
          type: 2,
          image_item: {
            media: {
              encrypt_query_param: "enc-image-1",
              aes_key: Buffer.alloc(16, 1).toString("base64"),
            },
          },
        },
      ],
    },
    { defaultWorkspaceId: "default" },
    "account-a",
  );

  assert.equal(normalized.command, "message");
  assert.equal(normalized.isGroupChat, false);
  assert.equal(normalized.attachments.length, 1);
  assert.equal(normalized.attachments[0].kind, "image");
  assert.equal(normalized.text, "");
});

test("normalizeWeixinIncomingMessage ignores group attachments without a /mya trigger", () => {
  const normalized = normalizeWeixinIncomingMessage(
    {
      from_user_id: "wx-user-1",
      session_id: "wx-group-1",
      message_id: "msg-image-2",
      message_type: 1,
      context_token: "ctx-image-2",
      item_list: [
        {
          type: 1,
          text_item: {
            text: "大家看下这个图片",
          },
        },
        {
          type: 2,
          image_item: {
            media: {
              encrypt_query_param: "enc-image-2",
              aes_key: Buffer.alloc(16, 2).toString("base64"),
            },
          },
        },
      ],
    },
    { defaultWorkspaceId: "default" },
    "account-a",
  );

  assert.equal(normalized, null);
});

test("normalizeWeixinIncomingMessage turns group attachment triggers into normal message turns", () => {
  const normalized = normalizeWeixinIncomingMessage(
    {
      from_user_id: "wx-user-1",
      session_id: "wx-group-1",
      message_id: "msg-image-3",
      message_type: 1,
      context_token: "ctx-image-3",
      item_list: [
        {
          type: 1,
          text_item: {
            text: "/mya 看下这张图里有什么",
          },
        },
        {
          type: 2,
          image_item: {
            media: {
              encrypt_query_param: "enc-image-3",
              aes_key: Buffer.alloc(16, 3).toString("base64"),
            },
          },
        },
      ],
    },
    { defaultWorkspaceId: "default" },
    "account-a",
  );

  assert.equal(normalized.command, "message");
  assert.equal(normalized.isGroupChat, true);
  assert.equal(normalized.hasBotTrigger, true);
  assert.equal(normalized.text, "看下这张图里有什么");
  assert.equal(normalized.attachments.length, 1);
});

test("normalizeWeixinIncomingMessage carries profileId from runtime config", () => {
  const normalized = normalizeWeixinIncomingMessage(
    {
      from_user_id: "wx-user-2",
      session_id: "session-profile-1",
      message_id: "msg-profile-1",
      message_type: 1,
      context_token: "ctx-profile-1",
      item_list: [
        {
          type: 1,
          text_item: {
            text: "/mya help",
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

  assert.equal(normalized.profileId, "ops-bot");
});
