const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AuditLog } = require("../src/hub/governance/audit-log");
const { PolicyStore } = require("../src/hub/governance/policy-store");
const { buildOperatorSummary } = require("../src/hub/governance/operator-summary");
const { HubTaskRegistry } = require("../src/hub/tasks/task-registry");

test("records approval, wake, and task events with profile context", () => {
  const filePath = path.join(os.tmpdir(), `mya-connect-audit-${Date.now()}-${Math.random()}.jsonl`);
  const log = new AuditLog({ filePath });

  log.append({ type: "approval", profileId: "review-bot", actor: "alice" });
  log.append({ type: "wake", profileId: "ops-bot", actor: "scheduler" });
  log.append({ type: "task_complete", profileId: "ops-bot", actor: "system" });

  const entries = log.list();
  assert.equal(entries.length, 3);
  assert.equal(entries[0].profileId, "review-bot");
  assert.equal(entries[1].type, "wake");
  assert.equal(entries[2].type, "task_complete");
});

test("PolicyStore persists per-profile governance policy", () => {
  const filePath = path.join(os.tmpdir(), `mya-connect-policies-${Date.now()}-${Math.random()}.json`);
  const store = new PolicyStore({ filePath });

  store.set("review-bot", {
    allowedUsers: ["alice"],
    allowedChats: ["chat-1"],
    workspaceAllowlist: ["/tmp/review"],
    defaultPermissionMode: "plan",
    wakeEnabled: true,
    workersEnabled: true,
  });

  assert.deepEqual(store.get("review-bot"), {
    allowedUsers: ["alice"],
    allowedChats: ["chat-1"],
    workspaceAllowlist: ["/tmp/review"],
    defaultPermissionMode: "plan",
    wakeEnabled: true,
    workersEnabled: true,
  });
});

test("buildOperatorSummary aggregates profile, runtime, task, and policy state", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-connect-governance-home-"));
  const profileStore = {
    list() {
      return [{ profileId: "review-bot" }, { profileId: "ops-bot" }];
    },
  };
  const taskRegistry = new HubTaskRegistry({
    filePath: path.join(homeDir, "tasks.json"),
  });
  taskRegistry.recordDispatch({
    profileId: "ops-bot",
    trigger: "schedule",
    workspaceRoot: "/tmp/ops",
  });
  const policyStore = {
    list() {
      return {
        "review-bot": { wakeEnabled: true },
      };
    },
  };
  const auditLog = {
    list() {
      return [{ type: "approval" }, { type: "wake" }];
    },
  };

  const summary = buildOperatorSummary({
    profileStore,
    runtimeStatus: {
      profiles: [{ profileId: "review-bot" }],
    },
    taskRegistry,
    policyStore,
    auditLog,
  });

  assert.equal(summary.hubEnabled, true);
  assert.equal(summary.profileCount, 2);
  assert.equal(summary.activeRuntimeCount, 1);
  assert.equal(summary.taskCount, 1);
  assert.equal(summary.policyCount, 1);
  assert.equal(summary.recentAuditCount, 2);
});
