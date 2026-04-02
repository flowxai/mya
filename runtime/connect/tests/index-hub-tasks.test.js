const test = require("node:test");
const assert = require("node:assert/strict");

const { buildHelpText } = require("../src/index");

test("buildHelpText documents hub task commands", () => {
  const helpText = buildHelpText();

  assert.doesNotMatch(helpText, /mya connect hub tasks list/);
  assert.doesNotMatch(helpText, /mya connect hub tasks resume <taskId>/);
  assert.doesNotMatch(helpText, /mya serve tasks/);
});
