const test = require("node:test");
const assert = require("node:assert/strict");

const { buildWechatTurnInputText } = require("../src/app/wechat-runtime");

test("buildWechatTurnInputText includes saved attachment paths and user text", () => {
  const text = buildWechatTurnInputText(
    {
      text: "帮我总结一下这两个附件",
    },
    [
      {
        kind: "image",
        relativePath: ".my_agent/inbox/wechat/room-1/msg-1-image-1.png",
      },
      {
        kind: "file",
        relativePath: ".my_agent/inbox/wechat/room-1/msg-1-report.pdf",
      },
    ],
  );

  assert.match(text, /微信用户发送了附件/);
  assert.match(text, /image: \.my_agent\/inbox\/wechat\/room-1\/msg-1-image-1\.png/);
  assert.match(text, /file: \.my_agent\/inbox\/wechat\/room-1\/msg-1-report\.pdf/);
  assert.match(text, /用户说明：/);
  assert.match(text, /帮我总结一下这两个附件/);
});

test("buildWechatTurnInputText creates a default prompt for attachment-only messages", () => {
  const text = buildWechatTurnInputText(
    {
      text: "",
    },
    [
      {
        kind: "image",
        relativePath: ".my_agent/inbox/wechat/room-1/msg-2-image-1.png",
      },
    ],
  );

  assert.match(text, /请先查看这些附件/);
  assert.match(text, /msg-2-image-1\.png/);
});
