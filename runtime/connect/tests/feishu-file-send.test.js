const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  downloadFeishuMessageResourceToWorkspace,
  sendFeishuAttachmentReply,
  sendFeishuFileReply,
} = require("../src/infra/feishu/file-send");

test("sendFeishuFileReply uploads a local file and replies with a Feishu file message", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mya-connect-feishu-file-"));
  const filePath = path.join(tempDir, "report.txt");
  await fs.writeFile(filePath, "hello feishu");

  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      assert.equal(url, "https://open.feishu.cn/open-apis/im/v1/files");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer tenant-token");
      assert.ok(options.body instanceof FormData);
      assert.equal(options.body.get("file_type"), "stream");
      assert.equal(options.body.get("file_name"), "report.txt");
      const file = options.body.get("file");
      assert.equal(file.name, "report.txt");
      assert.equal(await file.text(), "hello feishu");
      return Response.json({
        code: 0,
        data: {
          file_key: "file-key-1",
        },
      });
    }

    assert.equal(url, "https://open.feishu.cn/open-apis/im/v1/messages/om_reply_1/reply");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer tenant-token");
    assert.equal(options.headers["Content-Type"], "application/json; charset=utf-8");
    const payload = JSON.parse(options.body);
    assert.equal(payload.msg_type, "file");
    assert.equal(payload.reply_in_thread, true);
    assert.deepEqual(JSON.parse(payload.content), { file_key: "file-key-1" });
    assert.match(payload.uuid, /^[0-9a-f-]{36}$/i);

    return Response.json({ code: 0, data: {} });
  };

  t.after(async () => {
    global.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  await sendFeishuFileReply({
    filePath,
    messageId: "om_reply_1",
    tenantAccessToken: "tenant-token",
    replyInThread: true,
  });

  assert.equal(calls.length, 2);
});

test("sendFeishuAttachmentReply uploads images as image replies", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mya-connect-feishu-image-"));
  const filePath = path.join(tempDir, "photo.png");
  await fs.writeFile(filePath, "fake-image");

  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      assert.equal(url, "https://open.feishu.cn/open-apis/im/v1/images");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer tenant-token");
      assert.ok(options.body instanceof FormData);
      assert.equal(options.body.get("image_type"), "message");
      const file = options.body.get("image");
      assert.equal(file.name, "photo.png");
      assert.equal(await file.text(), "fake-image");
      return Response.json({
        code: 0,
        data: {
          image_key: "img-key-1",
        },
      });
    }

    assert.equal(url, "https://open.feishu.cn/open-apis/im/v1/messages/om_reply_image/reply");
    const payload = JSON.parse(options.body);
    assert.equal(payload.msg_type, "image");
    assert.deepEqual(JSON.parse(payload.content), { image_key: "img-key-1" });

    return Response.json({ code: 0, data: {} });
  };

  t.after(async () => {
    global.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  await sendFeishuAttachmentReply({
    filePath,
    messageId: "om_reply_image",
    tenantAccessToken: "tenant-token",
    replyInThread: false,
  });

  assert.equal(calls.length, 2);
});

test("downloadFeishuMessageResourceToWorkspace stores attachments under .mya/inbox/<profile>/feishu/<conversation>", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mya-connect-feishu-inbox-"));
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    assert.equal(
      url,
      "https://open.feishu.cn/open-apis/im/v1/messages/om_resource_1/resources/file_key_3?type=file"
    );
    assert.equal(options.headers.Authorization, "Bearer tenant-token");
    return new Response(Buffer.from("resource-body"), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
      },
    });
  };

  t.after(async () => {
    global.fetch = originalFetch;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const saved = await downloadFeishuMessageResourceToWorkspace({
    workspaceRoot,
    profileId: "review-bot",
    conversationId: "oc_group_3",
    messageId: "om_resource_1",
    attachment: {
      kind: "file",
      resourceType: "file",
      fileKey: "file_key_3",
      fileName: "report.txt",
    },
    tenantAccessToken: "tenant-token",
  });

  assert.equal(saved.relativePath, ".mya/inbox/review-bot/feishu/oc_group_3/om_resource_1-report.txt");
  assert.equal(await fs.readFile(saved.filePath, "utf8"), "resource-body");
  assert.equal(calls.length, 1);
});
