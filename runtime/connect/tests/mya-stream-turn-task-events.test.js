const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { MyaStreamTurn } = require("../src/infra/mya/stream-turn");

test("MyaStreamTurn forwards init and result events to task observers", async () => {
  const child = createFakeChild();
  const taskEvents = [];
  const turn = new MyaStreamTurn(
    {
      myaCommand: "mya",
      workspaceRoot: "/tmp/project",
      sessionId: "523e4567-e89b-12d3-a456-426614174000",
      permissionMode: "default",
      taskContext: {
        taskId: "task-1",
        profileId: "ops-bot",
        trigger: "schedule",
      },
      onTaskEvent(event) {
        taskEvents.push(event);
      },
    },
    {
      spawn: async () => child,
    },
  );

  const resultPromise = turn.run("执行巡检");
  await Promise.resolve();

  child.stdout.emit("data", toNdjson({
    type: "system",
    subtype: "init",
    session_id: "523e4567-e89b-12d3-a456-426614174000",
  }));
  child.stdout.emit("data", toNdjson({
    type: "result",
    subtype: "success",
    session_id: "523e4567-e89b-12d3-a456-426614174000",
    is_error: false,
    result: "巡检完成",
    permission_denials: [],
  }));
  child.emit("close", 0);

  await resultPromise;

  assert.deepEqual(taskEvents, [
    {
      type: "init",
      taskId: "task-1",
      profileId: "ops-bot",
      trigger: "schedule",
      sessionId: "523e4567-e89b-12d3-a456-426614174000",
    },
    {
      type: "result",
      taskId: "task-1",
      profileId: "ops-bot",
      trigger: "schedule",
      sessionId: "523e4567-e89b-12d3-a456-426614174000",
      result: "巡检完成",
      isError: false,
      permissionDenials: [],
    },
  ]);
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
