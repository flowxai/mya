const test = require("node:test");
const assert = require("node:assert/strict");

const { buildHelpText } = require("../src/index");

test("buildHelpText documents productized bot commands instead of profile management", () => {
  const helpText = buildHelpText();

  assert.match(helpText, /mya bots/);
  assert.match(helpText, /mya bots add <name>/);
  assert.match(helpText, /mya bots remove <name>/);
  assert.doesNotMatch(helpText, /mya bots check/);
  assert.doesNotMatch(helpText, /mya connect hub profiles list/);
});
