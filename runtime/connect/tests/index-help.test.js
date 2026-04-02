const test = require("node:test");
const assert = require("node:assert/strict");

const { buildHelpText } = require("../src/index");

test("buildHelpText uses the productized mya command surface", () => {
  const helpText = buildHelpText();

  assert.match(helpText, /用法: mya <command>/);
  assert.match(helpText, /bot commands:/);
  assert.match(helpText, /channel commands:/);
  assert.match(helpText, /mya wechat login \[bot\]\s+Login WeChat and bind the single WeChat entry to a bot/);
  assert.match(helpText, /mya feishu login \[bot\]\s+Save Feishu app credentials for a bot/);
  assert.match(helpText, /mya bots\s+List saved bots/);
  assert.match(helpText, /mya bots add <name>\s+Create a bot in the current workspace and open it/);
  assert.match(helpText, /mya bots remove <name>\s+Remove a saved bot and its BOT\.md/);
  assert.match(helpText, /mya serve\s+Start every configured bot\/channel together/);
  assert.match(helpText, /\/whoru\s+Explain or save the bot's identity and purpose/);
  assert.match(helpText, /writes both profile\.json and BOT\.md/i);
  assert.match(helpText, /WeChat can only be bound to one bot at a time/);
  assert.match(helpText, /advanced service\/debug commands still exist: mya serve status\|restart\|stop\|logs, mya wechat start, mya feishu start/);
  assert.doesNotMatch(helpText, /mya bots check/);
  assert.doesNotMatch(helpText, /mya status/);
  assert.doesNotMatch(helpText, /mya tasks$/);
  assert.doesNotMatch(helpText, /mya serve tasks/);
  assert.doesNotMatch(helpText, /^mya connect /m);
  assert.doesNotMatch(helpText, /mya-connect wechat login/);
});
