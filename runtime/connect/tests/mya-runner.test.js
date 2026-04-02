const test = require("node:test");
const assert = require("node:assert/strict");

const { runMyaPrompt } = require("../src/infra/mya/runner");

test("runMyaPrompt starts a new mya session with auto mode and permission mode", async () => {
  let invocation = null;

  const output = await runMyaPrompt(
    {
      myaCommand: "mya",
      workspaceRoot: "/tmp/project",
      text: "你好",
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      model: "sonnet",
      effort: "high",
      permissionMode: "auto",
      enableAutoMode: true,
    },
    async (spec) => {
      invocation = spec;
      return {
        exitCode: 0,
        stdout: "ok",
        stderr: "",
      };
    },
  );

  assert.equal(output, "ok");
  assert.equal(invocation.command, "mya");
  assert.equal(invocation.cwd, "/tmp/project");
  assert.deepEqual(invocation.args, [
    "--print",
    "--bare",
    "--output-format",
    "text",
    "--disable-slash-commands",
    "--permission-mode",
    "auto",
    "--enable-auto-mode",
    "--model",
    "sonnet",
    "--effort",
    "high",
    "--session-id",
    "123e4567-e89b-12d3-a456-426614174000",
    "你好",
  ]);
});

test("runMyaPrompt resumes an existing session", async () => {
  let invocation = null;

  await runMyaPrompt(
    {
      myaCommand: "mya",
      workspaceRoot: "/tmp/project",
      text: "继续",
      resumeSessionId: "223e4567-e89b-12d3-a456-426614174000",
      permissionMode: "default",
      enableAutoMode: false,
    },
    async (spec) => {
      invocation = spec;
      return {
        exitCode: 0,
        stdout: "done",
        stderr: "",
      };
    },
  );

  assert.deepEqual(invocation.args, [
    "--print",
    "--bare",
    "--output-format",
    "text",
    "--disable-slash-commands",
    "--permission-mode",
    "default",
    "--resume",
    "223e4567-e89b-12d3-a456-426614174000",
    "继续",
  ]);
});

test("runMyaPrompt maps profile defaults and hub context into the invocation", async () => {
  let invocation = null;

  await runMyaPrompt(
    {
      myaCommand: "mya",
      workspaceRoot: "/tmp/project",
      text: "继续处理 review",
      profile: {
        profileId: "review-bot",
        defaultModel: "sonnet",
        defaultEffort: "high",
        permissionMode: "plan",
        workers: ["reviewer"],
        memoryPolicy: {
          inheritanceMode: "inherit",
        },
      },
      requestedWorkerType: "reviewer",
      inheritedMemoryNamespace: "profiles/leader-bot",
    },
    async (spec) => {
      invocation = spec;
      return {
        exitCode: 0,
        stdout: "ok",
        stderr: "",
      };
    },
  );

  assert.deepEqual(invocation.args, [
    "--print",
    "--bare",
    "--output-format",
    "text",
    "--disable-slash-commands",
    "--permission-mode",
    "plan",
    "--model",
    "sonnet",
    "--effort",
    "high",
    "继续处理 review",
  ]);
  assert.equal(invocation.env.MYA_HUB_PROFILE_ID, "review-bot");
  assert.equal(invocation.env.MYA_HUB_MEMORY_NAMESPACE, "profiles/leader-bot");
  assert.equal(invocation.env.MYA_HUB_WORKER_TYPE, "reviewer");
});

test("runMyaPrompt rejects disallowed worker types from the profile policy", async () => {
  await assert.rejects(
    () => runMyaPrompt(
      {
        myaCommand: "mya",
        workspaceRoot: "/tmp/project",
        text: "继续",
        profile: {
          profileId: "review-bot",
          workers: ["reviewer", "researcher"],
        },
        requestedWorkerType: "coder",
      },
      async () => ({
        exitCode: 0,
        stdout: "should not run",
        stderr: "",
      }),
    ),
    /not allowed/i,
  );
});

test("runMyaPrompt applies profile run-context defaults and rejects disallowed worker types", async () => {
  let invocation = null;

  await runMyaPrompt(
    {
      myaCommand: "mya",
      workspaceRoot: "/tmp/project",
      text: "继续处理",
      profile: {
        profileId: "review-bot",
        defaultModel: "sonnet",
        defaultEffort: "high",
        permissionMode: "plan",
        workers: ["reviewer"],
      },
      requestedWorkerType: "reviewer",
    },
    async (spec) => {
      invocation = spec;
      return {
        exitCode: 0,
        stdout: "ok",
        stderr: "",
      };
    },
  );

  assert.deepEqual(invocation.args, [
    "--print",
    "--bare",
    "--output-format",
    "text",
    "--disable-slash-commands",
    "--permission-mode",
    "plan",
    "--model",
    "sonnet",
    "--effort",
    "high",
    "继续处理",
  ]);

  await assert.rejects(
    runMyaPrompt(
      {
        myaCommand: "mya",
        workspaceRoot: "/tmp/project",
        text: "继续处理",
        profile: {
          profileId: "review-bot",
          workers: ["reviewer"],
        },
        requestedWorkerType: "coder",
      },
      async () => ({
        exitCode: 0,
        stdout: "ok",
        stderr: "",
      }),
    ),
    /not allowed/i,
  );
});
