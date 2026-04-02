const test = require("node:test");
const assert = require("node:assert/strict");

const { buildProfileRunContext } = require("../src/hub/agents/profile-run-context");

test("buildProfileRunContext falls back to orchestration.defaultWorkerType when no worker is explicitly requested", () => {
  const context = buildProfileRunContext({
    profile: {
      profileId: "review-bot",
      workers: ["reviewer", "researcher"],
      orchestration: {
        defaultWorkerType: "researcher",
      },
    },
  });

  assert.equal(context.workerPolicy.allowed, true);
  assert.equal(context.workerPolicy.requestedType, "researcher");
});
