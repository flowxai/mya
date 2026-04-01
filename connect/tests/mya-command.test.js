const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const WRAPPER_PATH = path.join(__dirname, "..", "bin", "mya.js");

function runNode(args, extraEnv = {}) {
  return spawnSync(process.execPath, [WRAPPER_PATH, ...args], {
    env: {
      ...process.env,
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

test("mya connect help routes into the channel bridge help text", () => {
  const result = runNode(["connect", "help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /用法: mya connect <channel> <command>/);
  assert.doesNotMatch(result.stdout, /mya-connect wechat login/);
});

test("plain mya arguments still forward to the main mya binary", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mya-command-wrapper-"));
  const fakeMainPath = path.join(tempDir, "fake-mya.sh");

  fs.writeFileSync(
    fakeMainPath,
    "#!/bin/sh\nprintf 'forwarded:%s\\n' \"$*\"\n",
    "utf8",
  );
  fs.chmodSync(fakeMainPath, 0o755);

  const result = runNode(["--version"], {
    MYA_CONNECT_MAIN_COMMAND: fakeMainPath,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /forwarded:--version/);
});
