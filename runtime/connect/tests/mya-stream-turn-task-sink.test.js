const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { MyaStreamTurn } = require("../src/infra/mya/stream-turn");

test("MyaStreamTurn forwards parsed events to an optional event sink", async () => {
  const child = createFakeChild();
  const sinkEvents = [];

  const turn = new MyaStreamTurn(
    {
      myaCommand: "mya",
      workspaceRoot: "/tmp/project",
      sessionId: "523e4567-e89b-12d3-a456-426614174000",
      permissionMode: "dontAsk",
    },
    {
      spawn: async () => child,
      eventSink(event) {
        sinkEvents.push(event);
      },
    },
  );

  const resultPromise = turn.run("你好");
  await Promise.resolve();

  child.stdout.emit("data", toNdjson({
    type: "system",
    subtype: "init",
    session_id: "523e4567-e89b-12d3-a456-426614174000",
  }));
  child.stdout.emit("data", toNdjson({
    type: "assistant",
    session_id: "523e4567-e89b-12d3-a456-426614174000",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "收到。" },
      ],
    },
  }));
  child.stdout.emit("data", toNdjson({
    type: "result",
    subtype: "success",
    session_id: "523e4567-e89b-12d3-a456-426614174000",
    is_error: false,
    result: "done",
    permission_denials: [],
  }));
  child.emit("close", 0);

  await resultPromise;

  assert.deepEqual(
    sinkEvents.map((event) => event.type),
    ["init", "assistant_text", "result"],
  );
  assert.equal(sinkEvents[0].sessionId, "523e4567-e89b-12d3-a456-426614174000");
  assert.equal(sinkEvents[2].result, "done");
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
