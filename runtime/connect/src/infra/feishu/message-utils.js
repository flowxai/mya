const { parseCommand } = require("../weixin/message-utils");

function normalizeFeishuIncomingMessage(eventPayload, config) {
  const event = eventPayload && typeof eventPayload.event === "object"
    ? eventPayload.event
    : eventPayload;
  if (!event || typeof event !== "object") {
    return null;
  }

  const message = event.message && typeof event.message === "object" ? event.message : {};
  const sender = event.sender && typeof event.sender === "object" ? event.sender : {};
  const senderOpenId = normalizeText(sender?.sender_id?.open_id);
  const chatId = normalizeText(message.chat_id);
  const messageId = normalizeText(message.message_id);
  const chatType = normalizeText(message.chat_type).toLowerCase();
  const messageType = normalizeText(message.message_type).toLowerCase();
  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  const text = extractTextBody(message.content, mentions);
  const attachment = extractAttachment(messageType, message.content);

  if (!senderOpenId || !chatId || !messageId || !chatType) {
    return null;
  }
  if (chatType === "group" && config.enableGroupAtMessages !== false) {
    if (!mentions.length && !hasMyaTriggerText(text)) {
      return null;
    }
  }

  if (!text && messageType === "text") {
    return null;
  }

  return {
    provider: "feishu",
    profileId: normalizeText(config.profileId),
    workspaceId: config.defaultWorkspaceId,
    accountId: config.appId,
    chatId,
    threadKey: normalizeText(message.thread_id),
    senderId: chatType === "group" ? `chat:${chatId}` : `user:${senderOpenId}`,
    senderOpenId,
    messageId,
    chatType,
    messageType,
    unsupportedMessageType: messageType && !attachment && messageType !== "text" ? messageType : "",
    text,
    command: attachment ? "" : (text ? parseCommand(text) : ""),
    attachment,
    receivedAt: new Date().toISOString(),
  };
}

function extractTextBody(rawContent, mentions) {
  if (typeof rawContent !== "string" || !rawContent.trim()) {
    return "";
  }

  try {
    const parsed = JSON.parse(rawContent);
    let text = typeof parsed?.text === "string" ? parsed.text : "";
    if (!text.trim()) {
      return "";
    }

    for (const mention of Array.isArray(mentions) ? mentions : []) {
      const key = normalizeText(mention?.key);
      if (key) {
        text = text.split(key).join(" ");
      }
      const name = normalizeText(mention?.name);
      if (name) {
        text = text.split(`@${name}`).join(" ");
      }
    }

    return text.replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function extractAttachment(messageType, rawContent) {
  if (messageType !== "image" && messageType !== "file") {
    return null;
  }

  try {
    const parsed = JSON.parse(rawContent);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (messageType === "image") {
      const imageKey = normalizeText(parsed.image_key);
      if (!imageKey) {
        return null;
      }
      return {
        kind: "image",
        resourceType: "image",
        fileKey: imageKey,
        fileName: normalizeText(parsed.file_name || parsed.image_name),
      };
    }

    const fileKey = normalizeText(parsed.file_key);
    if (!fileKey) {
      return null;
    }
    return {
      kind: "file",
      resourceType: "file",
      fileKey,
      fileName: normalizeText(parsed.file_name),
    };
  } catch {
    return null;
  }
}

function hasMyaTriggerText(text) {
  return /^\/(?:mya|codex)(?:\s|$)/i.test(normalizeText(text));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  normalizeFeishuIncomingMessage,
};
