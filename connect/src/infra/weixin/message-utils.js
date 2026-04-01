const TEXT_ITEM_TYPE = 1;
const IMAGE_ITEM_TYPE = 2;
const VOICE_ITEM_TYPE = 3;
const FILE_ITEM_TYPE = 4;
const BOT_MESSAGE_TYPE = 2;

function normalizeWeixinIncomingMessage(message, config, accountId) {
  if (!message || typeof message !== "object") {
    return null;
  }
  if (Number(message.message_type) === BOT_MESSAGE_TYPE) {
    return null;
  }

  const senderId = normalizeText(message.from_user_id);
  if (!senderId) {
    return null;
  }

  const rawText = extractTextBody(message.item_list);
  const attachments = extractAttachmentItems(message.item_list);
  if (!rawText && !attachments.length) {
    return null;
  }

  const threadKey = normalizeText(message.session_id);
  const isGroupChat = inferGroupChat(threadKey, senderId);
  const trigger = extractBotTriggerText(rawText);
  if (attachments.length > 0 && isGroupChat && !trigger.hasBotTrigger) {
    return null;
  }

  let text = rawText;
  let command = rawText ? parseCommand(rawText) : "message";
  if (attachments.length > 0 && trigger.hasBotTrigger && command === "unknown_command") {
    text = trigger.strippedText;
    command = "message";
  } else if (!rawText && attachments.length > 0) {
    text = "";
    command = "message";
  }

  return {
    provider: "weixin",
    workspaceId: config.defaultWorkspaceId,
    accountId,
    chatId: senderId,
    threadKey,
    senderId,
    messageId: String(message.message_id || "").trim(),
    text,
    rawText,
    command,
    contextToken: normalizeText(message.context_token),
    attachments,
    hasBotTrigger: trigger.hasBotTrigger,
    isGroupChat,
    receivedAt: new Date().toISOString(),
  };
}

function extractTextBody(itemList) {
  if (!Array.isArray(itemList) || !itemList.length) {
    return "";
  }

  for (const item of itemList) {
    if (Number(item?.type) === TEXT_ITEM_TYPE && typeof item?.text_item?.text === "string") {
      return item.text_item.text.trim();
    }
    if (Number(item?.type) === VOICE_ITEM_TYPE && typeof item?.voice_item?.text === "string") {
      return item.voice_item.text.trim();
    }
  }

  return "";
}

function extractAttachmentItems(itemList) {
  if (!Array.isArray(itemList) || !itemList.length) {
    return [];
  }

  const attachments = [];
  for (const item of itemList) {
    if (Number(item?.type) === IMAGE_ITEM_TYPE) {
      const media = normalizeMediaRef(item?.image_item?.media);
      if (media) {
        attachments.push({
          kind: "image",
          media,
          fileName: "",
        });
      }
      continue;
    }

    if (Number(item?.type) === FILE_ITEM_TYPE) {
      const media = normalizeMediaRef(item?.file_item?.media);
      if (media) {
        attachments.push({
          kind: "file",
          media,
          fileName: normalizeText(item?.file_item?.file_name),
        });
      }
    }
  }

  return attachments;
}

function parseCommand(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  const exactCommands = {
    stop: ["stop"],
    where: ["where"],
    inspect_message: ["message"],
    help: ["help"],
    workspace: ["workspace"],
    new: ["new"],
    model: ["model", "model update"],
    effort: ["effort"],
    approve: ["approve", "approve workspace"],
    reject: ["reject"],
  };

  for (const [command, suffixes] of Object.entries(exactCommands)) {
    if (suffixes.some((suffix) => normalized === `/mya ${suffix}` || normalized === `/codex ${suffix}`)) {
      return command;
    }
  }

  if (matchesPrefixCommand(normalized, "switch")) {
    return "switch";
  }
  if (matchesPrefixCommand(normalized, "bind")) {
    return "bind";
  }
  if (matchesPrefixCommand(normalized, "remove")) {
    return "remove";
  }
  if (matchesPrefixCommand(normalized, "send")) {
    return "send";
  }
  if (matchesPrefixCommand(normalized, "model")) {
    return "model";
  }
  if (matchesPrefixCommand(normalized, "effort")) {
    return "effort";
  }
  if (
    normalized === "/mya"
    || normalized.startsWith("/mya ")
    || normalized === "/codex"
    || normalized.startsWith("/codex ")
  ) {
    return "unknown_command";
  }
  return "message";
}

function extractBotTriggerText(text) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) {
    return {
      hasBotTrigger: false,
      strippedText: "",
    };
  }

  const match = normalizedText.match(/^\/(?:mya|codex)(?:\s+([\s\S]*))?$/i);
  if (!match) {
    return {
      hasBotTrigger: false,
      strippedText: normalizedText,
    };
  }

  return {
    hasBotTrigger: true,
    strippedText: String(match[1] || "").trim(),
  };
}

function inferGroupChat(threadKey, senderId) {
  // iLink payloads here do not expose an explicit chat type; in observed payloads,
  // group conversations carry a session_id that differs from the sender's user id.
  return !!threadKey && !!senderId && threadKey !== senderId;
}

function matchesPrefixCommand(text, command) {
  return text.startsWith(`/mya ${command} `) || text.startsWith(`/codex ${command} `);
}

function normalizeMediaRef(media) {
  const encryptQueryParam = normalizeText(media?.encrypt_query_param || media?.encryptQueryParam);
  const aesKey = normalizeText(media?.aes_key || media?.aesKey || media?.aeskey);
  if (!encryptQueryParam) {
    return null;
  }

  return {
    encryptQueryParam,
    aesKey,
  };
}

function markdownToPlainText(text) {
  let result = String(text || "");
  result = result.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => String(code || "").trim());
  result = result.replace(/!\[[^\]]*]\([^)]*\)/g, "");
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  result = result.replace(/`([^`]+)`/g, "$1");
  result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
  result = result.replace(/\*([^*]+)\*/g, "$1");
  result = result.replace(/^>\s?/gm, "");
  result = result.replace(/^\|[\s:|-]+\|$/gm, "");
  result = result.replace(/^\|(.+)\|$/gm, (_, inner) =>
    String(inner || "").split("|").map((cell) => cell.trim()).join("  ")
  );
  return result.trim();
}

function chunkReplyText(text, limit = 3500) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return [];
  }

  const chunks = [];
  let remaining = normalized;
  while (remaining.length > limit) {
    const candidate = remaining.slice(0, limit);
    const splitIndex = Math.max(
      candidate.lastIndexOf("\n\n"),
      candidate.lastIndexOf("\n"),
      candidate.lastIndexOf("。"),
      candidate.lastIndexOf(". "),
      candidate.lastIndexOf(" ")
    );
    const cut = splitIndex > limit * 0.4 ? splitIndex + (candidate[splitIndex] === "\n" ? 0 : 1) : limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks.filter(Boolean);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  chunkReplyText,
  extractTextBody,
  extractAttachmentItems,
  markdownToPlainText,
  matchesPrefixCommand,
  normalizeWeixinIncomingMessage,
  parseCommand,
};
