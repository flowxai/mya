const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { downloadIncomingWeixinAttachments } = require("../src/infra/weixin/media-receive");

function encryptForWechat(buf, key) {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(buf), cipher.final()]);
}

test("downloadIncomingWeixinAttachments stores decrypted images in the workspace inbox", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mya-connect-wechat-inbox-"));
  const key = crypto.randomBytes(16);
  const plaintext = Buffer.from("wechat-image");
  const ciphertext = encryptForWechat(plaintext, key);
  const fetchCalls = [];
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    fetchCalls.push(String(url));
    return new Response(new Uint8Array(ciphertext), {
      status: 200,
      headers: {
        "content-type": "image/png",
      },
    });
  };

  t.after(async () => {
    global.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const saved = await downloadIncomingWeixinAttachments({
    workspaceRoot: tempDir,
    profileId: "ops-bot",
    conversationKey: "wx-group-1",
    messageId: "msg-image-1",
    cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
    attachments: [
      {
        kind: "image",
        media: {
          encryptQueryParam: "enc-image-1",
          aesKey: key.toString("base64"),
        },
      },
    ],
  });

  assert.equal(fetchCalls[0], "https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=enc-image-1");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].kind, "image");
  assert.equal(saved[0].relativePath, ".mya/inbox/ops-bot/wechat/wx-group-1/msg-image-1-image-1.png");

  const stored = await fs.readFile(path.join(tempDir, saved[0].relativePath));
  assert.deepEqual(stored, plaintext);
});

test("downloadIncomingWeixinAttachments keeps file names for inbound files", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mya-connect-wechat-file-"));
  const key = crypto.randomBytes(16);
  const plaintext = Buffer.from("wechat-file");
  const ciphertext = encryptForWechat(plaintext, key);
  const originalFetch = global.fetch;

  global.fetch = async () => new Response(new Uint8Array(ciphertext), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
    },
  });

  t.after(async () => {
    global.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const saved = await downloadIncomingWeixinAttachments({
    workspaceRoot: tempDir,
    profileId: "ops-bot",
    conversationKey: "wx-user-1",
    messageId: "msg-file-1",
    cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
    attachments: [
      {
        kind: "file",
        fileName: "report.pdf",
        media: {
          encryptQueryParam: "enc-file-1",
          aesKey: key.toString("base64"),
        },
      },
    ],
  });

  assert.equal(saved[0].relativePath, ".mya/inbox/ops-bot/wechat/wx-user-1/msg-file-1-report.pdf");
  const stored = await fs.readFile(path.join(tempDir, saved[0].relativePath));
  assert.deepEqual(stored, plaintext);
});
