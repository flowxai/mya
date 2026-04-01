#!/usr/bin/env node

const path = require("node:path");
const { spawn } = require("node:child_process");

const { main } = require("../src/index");
const { getConnectLogPrefix } = require("../src/shared/branding");

const DEFAULT_MAIN_COMMAND = path.resolve(__dirname, "..", "..", "cli");

async function run() {
  const args = process.argv.slice(2);

  if (args[0] === "connect") {
    process.argv = [process.argv[0], "mya connect", ...args.slice(1)];
    await main();
    return;
  }

  const mainCommand = process.env.MYA_CONNECT_MAIN_COMMAND || DEFAULT_MAIN_COMMAND;
  await forwardToMainCommand(mainCommand, args);
}

function forwardToMainCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exitCode = code || 0;
      resolve();
    });
  });
}

run().catch((error) => {
  console.error(`${getConnectLogPrefix()} ${error.message}`);
  process.exit(1);
});
