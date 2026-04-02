const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  buildMyaAttachmentInput,
  persistInboxAttachments,
} = require("../src/infra/attachments/inbox");

test("persistInboxAttachments stores attachments under .mya/inbox and records index metadata", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mya-connect-inbox-"));

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const saved = await persistInboxAttachments({
    workspaceRoot,
    profileId: "review-bot",
    channel: "feishu",
    conversationId: "chat:oc_group_1",
    senderId: "user:ou_test_user",
    attachments: [
      {
        kind: "image",
        fileName: "design review.png",
        mimeType: "image/png",
        data: Buffer.from("fake-image"),
      },
      {
        kind: "file",
        fileName: "spec?.pdf",
        mimeType: "application/pdf",
        data: Buffer.from("fake-pdf"),
      },
    ],
  });

  assert.equal(saved.length, 2);
  assert.match(saved[0].relativePath, /^\.mya\/inbox\/review-bot\/feishu\/chat_oc_group_1\//);
  assert.match(saved[1].relativePath, /^\.mya\/inbox\/review-bot\/feishu\/chat_oc_group_1\//);
  assert.equal(await fs.readFile(saved[0].localPath, "utf8"), "fake-image");
  assert.equal(await fs.readFile(saved[1].localPath, "utf8"), "fake-pdf");

  const indexPath = path.join(
    workspaceRoot,
    ".mya",
    "inbox",
    "review-bot",
    "feishu",
    "chat_oc_group_1",
    "index.json"
  );
  const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
  assert.equal(index.profileId, "review-bot");
  assert.equal(index.attachments.length, 2);
  assert.equal(index.attachments[0].kind, "image");
  assert.equal(index.attachments[1].fileName, "spec?.pdf");
});

test("buildMyaAttachmentInput embeds image blocks and references saved file paths", () => {
  const content = buildMyaAttachmentInput({
    userText: "帮我总结这些输入。",
    attachments: [
      {
        kind: "image",
        fileName: "diagram.png",
        mimeType: "image/png",
        relativePath: ".mya/inbox/wechat/user_1/2026-04-01-diagram.png",
        localPath: "/tmp/project/.mya/inbox/wechat/user_1/2026-04-01-diagram.png",
        data: Buffer.from("fake-image"),
      },
      {
        kind: "file",
        fileName: "spec.pdf",
        mimeType: "application/pdf",
        relativePath: ".mya/inbox/wechat/user_1/2026-04-01-spec.pdf",
        localPath: "/tmp/project/.mya/inbox/wechat/user_1/2026-04-01-spec.pdf",
        data: Buffer.from("fake-pdf"),
      },
    ],
  });

  assert.ok(Array.isArray(content));
  assert.equal(content[0].type, "text");
  assert.match(content[0].text, /收到以下附件/);
  assert.match(content[0].text, /\.mya\/inbox\/wechat\/user_1\/2026-04-01-diagram\.png/);
  assert.match(content[0].text, /\.mya\/inbox\/wechat\/user_1\/2026-04-01-spec\.pdf/);
  assert.match(content[0].text, /帮我总结这些输入/);
  assert.deepEqual(content[1], {
    type: "image",
    source: {
      type: "base64",
      media_type: "image/png",
      data: Buffer.from("fake-image").toString("base64"),
    },
  });
});
