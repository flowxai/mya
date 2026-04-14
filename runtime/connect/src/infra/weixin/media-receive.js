const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const { resolveInboxDirectory } = require("../attachments/inbox");
const { getExtensionFromMime } = require("./media-mime");

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

function buildCdnDownloadUrl({ cdnBaseUrl, encryptedQueryParam }) {
  const base = ensureTrailingSlash(String(cdnBaseUrl || ""));
  return `${base}download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}

function decodeAesKey(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  try {
    const base64 = Buffer.from(normalized, "base64");
    if (base64.length === 16) {
      return base64;
    }

    const decodedHex = base64.toString("utf8").trim();
    if (/^[0-9a-f]{32}$/i.test(decodedHex)) {
      return Buffer.from(decodedHex, "hex");
    }
  } catch {}

  if (/^[0-9a-f]{32}$/i.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }

  return null;
}

function decryptWechatMediaBuffer(buffer, aesKey) {
  const key = decodeAesKey(aesKey);
  if (!key) {
    return buffer;
  }

  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

async function downloadIncomingWeixinAttachments({
  workspaceRoot,
  profileId = "",
  conversationKey,
  messageId,
  cdnBaseUrl,
  attachments,
}) {
  const inboxDirectory = resolveInboxDirectory({
    workspaceRoot,
    profileId,
    channel: "wechat",
    conversationId: sanitizePathSegment(conversationKey, "conversation"),
  });
  await fs.mkdir(inboxDirectory, { recursive: true });

  const saved = [];
  for (const [index, attachment] of (attachments || []).entries()) {
    const encryptedQueryParam = normalizeText(attachment?.media?.encryptQueryParam);
    if (!encryptedQueryParam) {
      throw new Error("微信附件缺少 encrypt_query_param");
    }

    const response = await fetch(buildCdnDownloadUrl({
      cdnBaseUrl,
      encryptedQueryParam,
    }));
    if (!response.ok) {
      throw new Error(`微信附件下载失败: ${response.status} ${response.statusText}`);
    }

    const encryptedBuffer = Buffer.from(await response.arrayBuffer());
    const plaintext = decryptWechatMediaBuffer(
      encryptedBuffer,
      attachment?.media?.aesKey,
    );
    const contentType = normalizeContentType(response.headers.get("content-type"));
    const fileName = buildStoredFileName({
      kind: attachment.kind,
      fileName: attachment.fileName,
      contentType,
      index,
      messageId,
    });
    const absolutePath = path.join(inboxDirectory, fileName);
    await fs.writeFile(absolutePath, plaintext);

    saved.push({
      kind: attachment.kind,
      fileName,
      localPath: absolutePath,
      absolutePath,
      relativePath: path.relative(workspaceRoot, absolutePath).split(path.sep).join("/"),
      mimeType: contentType,
      contentType,
      data: plaintext,
    });
  }

  return saved;
}

function buildStoredFileName({ kind, fileName, contentType, index, messageId }) {
  const safePrefix = sanitizePathSegment(messageId, "message");
  const sanitizedFileName = sanitizeFileName(fileName);
  if (sanitizedFileName) {
    return `${safePrefix}-${sanitizedFileName}`;
  }

  const ext = getExtensionFromMime(contentType) || (kind === "image" ? ".jpg" : ".bin");
  return `${safePrefix}-${sanitizePathSegment(kind, "attachment")}-${index + 1}${ext}`;
}

function sanitizeFileName(value) {
  const baseName = path.basename(String(value || "").trim());
  if (!baseName) {
    return "";
  }

  return baseName
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function sanitizePathSegment(value, fallback = "unknown") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || fallback;
}

function normalizeContentType(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  buildCdnDownloadUrl,
  buildStoredFileName,
  decodeAesKey,
  decryptWechatMediaBuffer,
  downloadIncomingWeixinAttachments,
};
