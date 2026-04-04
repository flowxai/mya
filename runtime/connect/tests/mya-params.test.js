const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveEffectiveMyaParams } = require("../src/shared/mya-params");

test("resolveEffectiveMyaParams ignores legacy stored model overrides without an explicit source", () => {
  const params = resolveEffectiveMyaParams({
    stored: {
      model: "sonnet",
      effort: "high",
    },
    defaults: {
      model: "kimi-k2.5",
      effort: "",
    },
  });

  assert.deepEqual(params, {
    model: "kimi-k2.5",
    effort: "",
  });
});

test("resolveEffectiveMyaParams preserves explicit user overrides", () => {
  const params = resolveEffectiveMyaParams({
    stored: {
      model: "sonnet",
      effort: "",
      source: "user",
    },
    defaults: {
      model: "kimi-k2.5",
      effort: "medium",
    },
  });

  assert.deepEqual(params, {
    model: "sonnet",
    effort: "medium",
  });
});
