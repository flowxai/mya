const { spawn } = require("child_process");

async function spawnProcess(invocation) {
  return await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function runMyaPrompt(input, spawnImpl = spawnProcess) {
  const args = [
    "--print",
    "--bare",
    "--output-format",
    "text",
    "--disable-slash-commands",
    "--permission-mode",
    input.permissionMode || "auto",
  ];

  if (input.enableAutoMode) {
    args.push("--enable-auto-mode");
  }

  if (input.model) {
    args.push("--model", input.model);
  }

  if (input.effort) {
    args.push("--effort", input.effort);
  }

  if (input.resumeSessionId) {
    args.push("--resume", input.resumeSessionId);
  } else if (input.sessionId) {
    args.push("--session-id", input.sessionId);
  }

  args.push(input.text);

  const result = await spawnImpl({
    command: input.myaCommand || "mya",
    args,
    cwd: input.workspaceRoot,
    env: process.env,
  });

  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "mya failed";
    throw new Error(`mya failed: ${detail}`);
  }

  return result.stdout.trim();
}

module.exports = {
  runMyaPrompt,
};
