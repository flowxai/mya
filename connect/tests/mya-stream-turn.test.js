const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { MyaStreamTurn, buildMyaStreamInvocation } = require("../src/infra/mya/stream-turn");

test("buildMyaStreamInvocation enables stream-json mode for a new session", () => {
  const invocation = buildMyaStreamInvocation({
    myaCommand: "mya",
    workspaceRoot: "/tmp/project",
    sessionId: "123e4567-e89b-12d3-a456-426614174000",
    model: "sonnet",
    effort: "high",
    permissionMode: "default",
    enableAutoMode: true,
  });

  assert.equal(invocation.command, "mya");
  assert.equal(invocation.cwd, "/tmp/project");
  assert.deepEqual(invocation.args, [
    "--print",
    "--bare",
    "--verbose",
    "--disable-slash-commands",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--permission-mode",
    "default",
    "--enable-auto-mode",
    "--model",
    "sonnet",
    "--effort",
    "high",
    "--session-id",
    "123e4567-e89b-12d3-a456-426614174000",
  ]);
});

test("MyaStreamTurn writes the user message, emits parsed events, and resolves the final result", async () => {
  const child = createFakeChild();
  const events = [];

  const turn = new MyaStreamTurn(
    {
      myaCommand: "mya",
      workspaceRoot: "/tmp/project",
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      permissionMode: "dontAsk",
    },
    {
      spawn: async () => child,
    },
  );

  turn.on("event", (event) => {
    events.push(event);
  });

  const resultPromise = turn.run("你好");
  await Promise.resolve();

  assert.equal(child.stdin.writes.length, 1);
  assert.deepEqual(JSON.parse(child.stdin.writes[0]), {
    type: "user",
    session_id: "",
    message: {
      role: "user",
      content: "你好",
    },
    parent_tool_use_id: null,
  });

  child.stdout.emit("data", toNdjson({
    type: "system",
    subtype: "init",
    session_id: "123e4567-e89b-12d3-a456-426614174000",
  }));
  child.stdout.emit("data", toNdjson({
    type: "assistant",
    session_id: "123e4567-e89b-12d3-a456-426614174000",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "..." },
        { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "pwd" } },
        { type: "text", text: "你好！" },
      ],
    },
  }));
  child.stdout.emit("data", toNdjson({
    type: "tool_progress",
    session_id: "123e4567-e89b-12d3-a456-426614174000",
    tool_use_id: "tool-1",
    tool_name: "Bash",
    elapsed_time_seconds: 3,
  }));
  child.stdout.emit("data", toNdjson({
    type: "result",
    subtype: "success",
    session_id: "123e4567-e89b-12d3-a456-426614174000",
    is_error: false,
    result: "你好！",
    permission_denials: [],
  }));
  child.emit("close", 0);

  const result = await resultPromise;

  assert.equal(result.sessionId, "123e4567-e89b-12d3-a456-426614174000");
  assert.equal(result.result, "你好！");
  assert.equal(child.stdin.ended, true);
  assert.deepEqual(events, [
    {
      type: "init",
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
    },
    {
      type: "tool_use",
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      toolUseId: "tool-1",
      toolName: "Bash",
      input: { command: "pwd" },
    },
    {
      type: "assistant_text",
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      text: "你好！",
    },
    {
      type: "tool_progress",
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      toolUseId: "tool-1",
      toolName: "Bash",
      elapsedTimeSeconds: 3,
    },
    {
      type: "result",
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      result: "你好！",
      isError: false,
      permissionDenials: [],
    },
  ]);
});

test("MyaStreamTurn accepts content blocks for image turns", async () => {
  const child = createFakeChild();
  const turn = new MyaStreamTurn(
    {
      myaCommand: "mya",
      workspaceRoot: "/tmp/project",
      sessionId: "423e4567-e89b-12d3-a456-426614174000",
      permissionMode: "dontAsk",
    },
    {
      spawn: async () => child,
    },
  );

  const resultPromise = turn.run([
    {
      type: "text",
      text: "请先看这张图，再回答用户的问题。",
    },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "ZmFrZS1pbWFnZQ==",
      },
    },
  ]);
  await Promise.resolve();

  assert.equal(child.stdin.writes.length, 1);
  assert.deepEqual(JSON.parse(child.stdin.writes[0]), {
    type: "user",
    session_id: "",
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: "请先看这张图，再回答用户的问题。",
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "ZmFrZS1pbWFnZQ==",
          },
        },
      ],
    },
    parent_tool_use_id: null,
  });

  child.stdout.emit("data", toNdjson({
    type: "result",
    subtype: "success",
    session_id: "423e4567-e89b-12d3-a456-426614174000",
    is_error: false,
    result: "已读取图片。",
    permission_denials: [],
  }));
  child.emit("close", 0);

  const result = await resultPromise;
  assert.equal(result.result, "已读取图片。");
});

test("MyaStreamTurn responds to permission requests and clears pending state", async () => {
  const child = createFakeChild();
  const turn = new MyaStreamTurn(
    {
      myaCommand: "mya",
      workspaceRoot: "/tmp/project",
      sessionId: "223e4567-e89b-12d3-a456-426614174000",
      permissionMode: "default",
    },
    {
      spawn: async () => child,
    },
  );

  const resultPromise = turn.run("请运行 pwd");
  await Promise.resolve();

  child.stdout.emit("data", toNdjson({
    type: "control_request",
    request_id: "request-1",
    request: {
      subtype: "can_use_tool",
      tool_name: "Bash",
      input: {
        command: "pwd",
      },
      tool_use_id: "tool-1",
      description: "运行 pwd",
    },
  }));

  assert.deepEqual(turn.getPendingPermissionRequest(), {
    requestId: "request-1",
    toolName: "Bash",
    toolUseId: "tool-1",
    input: {
      command: "pwd",
    },
    description: "运行 pwd",
  });

  await turn.respondToPermission({ behavior: "allow" });

  assert.equal(turn.getPendingPermissionRequest(), null);
  assert.deepEqual(JSON.parse(child.stdin.writes[1]), {
    type: "control_response",
    response: {
      subtype: "success",
      request_id: "request-1",
      response: {
        behavior: "allow",
        updatedInput: {
          command: "pwd",
        },
        toolUseID: "tool-1",
      },
    },
  });

  child.stdout.emit("data", toNdjson({
    type: "result",
    subtype: "success",
    session_id: "223e4567-e89b-12d3-a456-426614174000",
    is_error: false,
    result: "done",
    permission_denials: [],
  }));
  child.emit("close", 0);

  await resultPromise;
});

test("MyaStreamTurn sends interrupt requests for stop", async () => {
  const child = createFakeChild();
  const turn = new MyaStreamTurn(
    {
      myaCommand: "mya",
      workspaceRoot: "/tmp/project",
      sessionId: "323e4567-e89b-12d3-a456-426614174000",
      permissionMode: "default",
    },
    {
      spawn: async () => child,
    },
  );

  const resultPromise = turn.run("长任务");
  await Promise.resolve();
  await turn.interrupt();

  const interruptMessage = JSON.parse(child.stdin.writes[1]);
  assert.equal(interruptMessage.type, "control_request");
  assert.equal(interruptMessage.request.subtype, "interrupt");
  assert.equal(typeof interruptMessage.request_id, "string");
  assert.equal(interruptMessage.request_id.length > 0, true);

  child.stdout.emit("data", toNdjson({
    type: "result",
    subtype: "success",
    session_id: "323e4567-e89b-12d3-a456-426614174000",
    is_error: false,
    result: "stopped",
    permission_denials: [],
  }));
  child.emit("close", 0);

  await resultPromise;
});

function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    writes: [],
    ended: false,
    write(chunk) {
      this.writes.push(String(chunk).trim());
    },
    end() {
      this.ended = true;
    },
  };
  return child;
}

function toNdjson(value) {
  return `${JSON.stringify(value)}\n`;
}
