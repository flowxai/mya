const crypto = require("crypto");
const path = require("path");
const fs = require("fs/promises");

const { resolveInboxDirectory } = require("../attachments/inbox");

const FEISHU_OPEN_API_BASE = "https://open.feishu.cn/open-apis";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".ico"]);
const CONTENT_TYPE_TO_EXTENSION = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "image/x-icon": ".ico",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
};

async function sendFeishuAttachmentReply({ filePath, messageId, tenantAccessToken, replyInThread = false }) {
  if (isImageFilePath(filePath)) {
    return sendFeishuImageReply({
      filePath,
      messageId,
      tenantAccessToken,
      replyInThread,
    });
  }
  return sendFeishuFileReply({
    filePath,
    messageId,
    tenantAccessToken,
    replyInThread,
  });
}

async function sendFeishuFileReply({ filePath, messageId, tenantAccessToken, replyInThread = false }) {
  const fileKey = await uploadFeishuFile({ filePath, tenantAccessToken });
  await replyWithFeishuFile({
    fileKey,
    messageId,
    tenantAccessToken,
    replyInThread,
  });

  return {
    fileKey,
    fileName: path.basename(filePath),
  };
}

async function sendFeishuImageReply({ filePath, messageId, tenantAccessToken, replyInThread = false }) {
  const imageKey = await uploadFeishuImage({ filePath, tenantAccessToken });
  await replyWithFeishuImage({
    imageKey,
    messageId,
    tenantAccessToken,
    replyInThread,
  });

  return {
    imageKey,
    fileName: path.basename(filePath),
  };
}

async function downloadFeishuMessageResourceToWorkspace({
  workspaceRoot,
  profileId = "",
  conversationId,
  messageId,
  attachment,
  tenantAccessToken,
}) {
  const response = await fetch(
    `${FEISHU_OPEN_API_BASE}/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(attachment.fileKey)}?type=${encodeURIComponent(attachment.resourceType)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tenantAccessToken}`,
      },
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => `${response.status} ${response.statusText}`);
    throw new Error(`飞书资源下载失败: ${detail}`);
  }

  const targetPath = buildWorkspaceInboxPath({
    workspaceRoot,
    profileId,
    conversationId,
    messageId,
    attachment,
    contentType: normalizeContentType(response.headers.get("content-type")),
  });
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const data = Buffer.from(await response.arrayBuffer());
  const contentType = normalizeContentType(response.headers.get("content-type"));
  await fs.writeFile(targetPath, data);

  return {
    filePath: targetPath,
    localPath: targetPath,
    fileName: path.basename(targetPath),
    relativePath: toPosixPath(path.relative(workspaceRoot, targetPath)),
    kind: attachment.kind,
    mimeType: contentType,
    data,
  };
}

async function uploadFeishuFile({ filePath, tenantAccessToken }) {
  const fileName = path.basename(filePath);
  const fileContents = await fs.readFile(filePath);
  const form = new FormData();
  form.set("file_type", "stream");
  form.set("file_name", fileName);
  form.set("file", new File([fileContents], fileName));

  const response = await fetch(`${FEISHU_OPEN_API_BASE}/im/v1/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tenantAccessToken}`,
    },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  const fileKey = payload?.data?.file_key || "";
  if (!response.ok || payload.code !== 0 || !fileKey) {
    const detail = payload.msg || `${response.status} ${response.statusText}`;
    throw new Error(`飞书文件上传失败: ${detail}`);
  }

  return fileKey;
}

async function uploadFeishuImage({ filePath, tenantAccessToken }) {
  const fileName = path.basename(filePath);
  const fileContents = await fs.readFile(filePath);
  const form = new FormData();
  form.set("image_type", "message");
  form.set("image", new File([fileContents], fileName));

  const response = await fetch(`${FEISHU_OPEN_API_BASE}/im/v1/images`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tenantAccessToken}`,
    },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  const imageKey = payload?.data?.image_key || "";
  if (!response.ok || payload.code !== 0 || !imageKey) {
    const detail = payload.msg || `${response.status} ${response.statusText}`;
    throw new Error(`飞书图片上传失败: ${detail}`);
  }

  return imageKey;
}

async function replyWithFeishuFile({ fileKey, messageId, tenantAccessToken, replyInThread }) {
  const response = await fetch(
    `${FEISHU_OPEN_API_BASE}/im/v1/messages/${encodeURIComponent(messageId)}/reply`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tenantAccessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        content: JSON.stringify({ file_key: fileKey }),
        msg_type: "file",
        reply_in_thread: !!replyInThread,
        uuid: crypto.randomUUID(),
      }),
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) {
    const detail = payload.msg || `${response.status} ${response.statusText}`;
    throw new Error(`飞书文件发送失败: ${detail}`);
  }
}

async function replyWithFeishuImage({ imageKey, messageId, tenantAccessToken, replyInThread }) {
  const response = await fetch(
    `${FEISHU_OPEN_API_BASE}/im/v1/messages/${encodeURIComponent(messageId)}/reply`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tenantAccessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        content: JSON.stringify({ image_key: imageKey }),
        msg_type: "image",
        reply_in_thread: !!replyInThread,
        uuid: crypto.randomUUID(),
      }),
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) {
    const detail = payload.msg || `${response.status} ${response.statusText}`;
    throw new Error(`飞书图片发送失败: ${detail}`);
  }
}

function buildWorkspaceInboxPath({ workspaceRoot, profileId = "", conversationId, messageId, attachment, contentType }) {
  const safeConversationId = sanitizeSegment(conversationId || "conversation");
  const rawFileName = sanitizeFileName(attachment.fileName || "");
  const currentExtension = path.extname(rawFileName);
  const inferredExtension = currentExtension || inferExtension(attachment.kind, contentType);
  const fileStem = currentExtension
    ? rawFileName.slice(0, -currentExtension.length)
    : (rawFileName || attachment.kind);
  const fileName = `${sanitizeSegment(messageId)}-${fileStem}${inferredExtension}`;
  const inboxDirectory = resolveInboxDirectory({
    workspaceRoot,
    profileId,
    channel: "feishu",
    conversationId: safeConversationId,
  });

  return path.join(inboxDirectory, fileName);
}

function inferExtension(kind, contentType) {
  if (CONTENT_TYPE_TO_EXTENSION[contentType]) {
    return CONTENT_TYPE_TO_EXTENSION[contentType];
  }
  return kind === "image" ? ".png" : ".bin";
}

function sanitizeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || "item";
}

function sanitizeFileName(value) {
  const baseName = path.basename(String(value || "").trim());
  if (!baseName) {
    return "";
  }
  return baseName
    .replace(/[^\w.\- ]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeContentType(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function isImageFilePath(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(String(filePath || "")).toLowerCase());
}

function toPosixPath(filePath) {
  return String(filePath || "").split(path.sep).join("/");
}

module.exports = {
  downloadFeishuMessageResourceToWorkspace,
  sendFeishuAttachmentReply,
  sendFeishuFileReply,
};
