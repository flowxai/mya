const test = require("node:test");
const assert = require("node:assert/strict");

const { buildHelpText } = require("../src/index");

test("buildHelpText uses mya connect as the public command shape", () => {
  const helpText = buildHelpText();

  assert.match(helpText, /用法: mya connect <channel> <command>/);
  assert.match(helpText, /mya connect wechat login/);
  assert.match(helpText, /mya connect feishu start/);
  assert.doesNotMatch(helpText, /mya-connect wechat login/);
});
