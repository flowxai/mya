const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveWorkerPolicy } = require("../src/hub/agents/worker-policy");
const { buildProfileRunContext } = require("../src/hub/agents/profile-run-context");

test("leader profile can invoke only allowed worker types", () => {
  const policy = resolveWorkerPolicy({
    profile: { id: "review-bot", workers: ["reviewer", "researcher"] },
    requestedType: "coder",
  });

  assert.deepEqual(policy, {
    allowed: false,
    requestedType: "coder",
    allowedWorkers: ["reviewer", "researcher"],
    allowedWorkerTypes: ["reviewer", "researcher"],
    internalOnly: true,
    reason: "requested worker type is not allowed",
    reasonCode: "worker_not_allowed",
  });
});

test("buildProfileRunContext maps profile defaults and memory policy", () => {
  const context = buildProfileRunContext({
    profile: {
      profileId: "review-bot",
      defaultModel: "sonnet",
      defaultEffort: "high",
      permissionMode: "plan",
      workers: ["reviewer", "researcher"],
      memoryPolicy: {
        inheritanceMode: "inherit",
      },
    },
    requestedType: "reviewer",
    inheritedMemoryNamespace: "profiles/leader",
  });

  assert.equal(context.profileId, "review-bot");
  assert.equal(context.model, "sonnet");
  assert.equal(context.effort, "high");
  assert.equal(context.permissionMode, "plan");
  assert.equal(context.memoryInheritanceMode, "inherit");
  assert.equal(context.memoryNamespace, "profiles/leader");
  assert.equal(context.workerPolicy.allowed, true);
});
