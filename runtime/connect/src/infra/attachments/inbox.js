const fs = require("fs/promises");
const path = require("path");

const { getMimeFromFilename } = require("../weixin/media-mime");

const INBOX_ROOT = ".mya/inbox";

async function persistInboxAttachments({
  workspaceRoot,
  profileId = "",
  channel,
  conversationId,
  senderId = "",
  attachments,
}) {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  const inboxDir = resolveInboxDirectory({
    workspaceRoot: normalizedWorkspaceRoot,
    profileId,
    channel,
    conversationId,
  });
  if (!inboxDir) {
    throw new Error("persistInboxAttachments requires workspaceRoot, channel, and conversationId");
  }
  await fs.mkdir(inboxDir, { recursive: true });

  const savedAttachments = [];
  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    const fileName = normalizeFileName(attachment.fileName, attachment.mimeType, attachment.kind, index);
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const diskName = `${timestamp}-${fileName}`;
    const localPath = path.join(inboxDir, diskName);
    await fs.writeFile(localPath, attachment.data);

    savedAttachments.push({
      kind: attachment.kind,
      fileName: attachment.fileName || fileName,
      mimeType: attachment.mimeType || getMimeFromFilename(fileName),
      size: attachment.data.length,
      senderId: normalizeText(senderId),
      localPath,
      relativePath: normalizeRelativePath(path.relative(normalizedWorkspaceRoot, localPath)),
      data: attachment.data,
      savedAt: new Date().toISOString(),
    });
  }

  await writeInboxIndex(
    inboxDir,
    sanitizeSegment(channel),
    sanitizeSegment(conversationId),
    sanitizeSegment(profileId),
    savedAttachments
  );
  return savedAttachments;
}

function buildMyaAttachmentInput({ userText, attachments }) {
  const normalizedText = normalizeText(userText);
  const normalizedAttachments = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
  if (!normalizedAttachments.length) {
    return normalizedText;
  }

  const lines = [
    "收到以下附件，已保存到当前项目工作区：",
    ...normalizedAttachments.map((attachment) =>
      `- [${attachment.kind}] ${attachment.relativePath}${attachment.fileName ? ` (original: ${attachment.fileName})` : ""}`
    ),
    "",
    "如需处理普通文件，请直接读取上面的本地路径；图片已作为内联图像一并提供。",
    "",
    normalizedText || "用户未附加文本说明，请先根据附件内容继续处理。",
  ];

  const imageBlocks = normalizedAttachments
    .filter((attachment) => isImageAttachment(attachment))
    .map((attachment) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mimeType,
        data: attachment.data.toString("base64"),
      },
    }));

  if (!imageBlocks.length) {
    return lines.join("\n");
  }

  return [
    {
      type: "text",
      text: lines.join("\n"),
    },
    ...imageBlocks,
  ];
}

async function writeInboxIndex(inboxDir, channel, conversationId, profileId, attachments) {
  const indexPath = path.join(inboxDir, "index.json");
  const existing = await readInboxIndex(indexPath);
  existing.profileId = profileId;
  existing.channel = channel;
  existing.conversationId = conversationId;
  existing.attachments.push(
    ...attachments.map((attachment) => ({
      kind: attachment.kind,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      senderId: attachment.senderId,
      savedAt: attachment.savedAt,
      relativePath: attachment.relativePath,
    }))
  );
  await fs.writeFile(indexPath, `${JSON.stringify(existing, null, 2)}\n`);
}

async function readInboxIndex(indexPath) {
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.attachments)) {
      return parsed;
    }
  } catch {}

  return {
    profileId: "",
    channel: "",
    conversationId: "",
    attachments: [],
  };
}

function resolveInboxDirectory({ workspaceRoot, profileId = "", channel, conversationId }) {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  const normalizedChannel = sanitizeSegment(channel);
  const normalizedConversationId = sanitizeSegment(conversationId);
  if (!normalizedWorkspaceRoot || !normalizedChannel || !normalizedConversationId) {
    return "";
  }

  return path.join(
    normalizedWorkspaceRoot,
    ...buildInboxDirectoryParts({ profileId, channel: normalizedChannel, conversationId: normalizedConversationId })
  );
}

function buildInboxDirectoryParts({ profileId = "", channel, conversationId }) {
  const normalizedProfileId = sanitizeSegment(profileId);
  const normalizedChannel = sanitizeSegment(channel);
  const normalizedConversationId = sanitizeSegment(conversationId);
  const parts = [".mya", "inbox"];
  if (normalizedProfileId) {
    parts.push(normalizedProfileId);
  }
  parts.push(normalizedChannel, normalizedConversationId);
  return parts;
}

function normalizeWorkspaceRoot(workspaceRoot) {
  return typeof workspaceRoot === "string" && workspaceRoot.trim()
    ? path.resolve(workspaceRoot.trim())
    : "";
}

function normalizeFileName(fileName, mimeType, kind, index) {
  const rawName = normalizeText(fileName);
  const ext = path.extname(rawName).toLowerCase();
  const baseName = sanitizeFileName(ext ? path.basename(rawName, ext) : rawName);
  const safeExt = ext || extensionForMime(mimeType, kind);
  const resolvedBase = baseName || `${kind || "attachment"}-${index + 1}`;
  return `${resolvedBase}${safeExt}`;
}

function extensionForMime(mimeType, kind) {
  const normalizedMimeType = normalizeText(mimeType).toLowerCase();
  if (normalizedMimeType === "image/png") {
    return ".png";
  }
  if (normalizedMimeType === "image/jpeg") {
    return ".jpg";
  }
  if (normalizedMimeType === "image/webp") {
    return ".webp";
  }
  if (normalizedMimeType === "application/pdf") {
    return ".pdf";
  }
  return kind === "image" ? ".bin" : ".dat";
}

function sanitizeSegment(value) {
  const normalized = normalizeText(value).replace(/[^\p{L}\p{N}._-]+/gu, "_");
  return normalized.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

function sanitizeFileName(value) {
  return sanitizeSegment(value).slice(0, 80);
}

function normalizeRelativePath(value) {
  return String(value || "").split(path.sep).join("/");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isImageAttachment(attachment) {
  return normalizeText(attachment.mimeType).toLowerCase().startsWith("image/");
}

module.exports = {
  INBOX_ROOT,
  buildMyaAttachmentInput,
  buildInboxDirectoryParts,
  persistInboxAttachments,
  resolveInboxDirectory,
};
