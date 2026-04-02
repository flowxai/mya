#!/usr/bin/env node

const path = require("node:path");
const { spawn } = require("node:child_process");

const { main } = require("../src/index");
const { getConnectLogPrefix } = require("../src/shared/branding");

const DEFAULT_MAIN_COMMAND = path.resolve(__dirname, "..", "..", "..", "cli");

function buildProductHelpText() {
  return [
    "",
    "Product Commands:",
    "  Bots:",
    "    mya bots                    List saved bots and choose one to open",
    "    mya bots add <name>         Create a bot in the current workspace and open it",
    "    mya bots remove <name>      Remove a saved bot and its BOT.md",
    "",
    "  Channels:",
    "    mya wechat login [bot]      Login WeChat and bind it to a bot",
    "    mya wechat accounts         Show saved WeChat accounts",
    "    mya feishu login [bot]      Save Feishu app credentials for a bot",
    "    mya feishu check            Validate Feishu app credentials",
    "",
    "  Service:",
    "    mya serve                   Start every configured bot/channel together",
    "",
    "  First-time Bot Setup:",
    "    mya bots add review-bot     Create a new bot and open it immediately",
    "    /whoru                      Explain or save the bot's identity and purpose",
    "",
    "Notes:",
    "  - omitting [bot] uses the `default` bot",
    "  - `mya bots add <name>` writes both `profile.json` and `BOT.md`",
    "  - WeChat can only be bound to one bot at a time",
    "  - each Feishu bot keeps its own appId/appSecret inside that bot profile",
    "  - `mya serve` starts every bot that already has a bound wechat or feishu channel",
    "  - advanced debug commands still exist: `mya serve status|restart|stop|logs`, `mya wechat start`, `mya feishu start`",
    "  - current session diagnostics still use `/status`, `/tasks`, `/doctor`, `/agents`",
  ].join("\n");
}

async function run() {
  const args = process.argv.slice(2);

  if (isTopLevelHelpCommand(args[0])) {
    const mainCommand = process.env.MYA_CONNECT_MAIN_COMMAND || DEFAULT_MAIN_COMMAND;
    await printCombinedHelp(mainCommand);
    return;
  }

  if (isBundledConnectCommand(args[0])) {
    const forwardedArgs = args[0] === "connect" ? args.slice(1) : args;
    process.argv = [process.argv[0], "mya connect", ...forwardedArgs];
    await main();
    return;
  }

  const mainCommand = process.env.MYA_CONNECT_MAIN_COMMAND || DEFAULT_MAIN_COMMAND;
  await forwardToMainCommand(mainCommand, args);
}

function isBundledConnectCommand(command) {
  return new Set(["connect", "wechat", "feishu", "bots", "serve"])
    .has(String(command || "").trim().toLowerCase());
}

function isTopLevelHelpCommand(command) {
  return new Set(["--help", "-h", "help"])
    .has(String(command || "").trim().toLowerCase());
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

function printCombinedHelp(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["--help"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
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
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      if ((code || 0) !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || "Failed to print mya help."));
        return;
      }
      process.stdout.write(stdout);
      process.stdout.write(buildProductHelpText());
      process.stdout.write("\n");
      resolve();
    });
  });
}

run().catch((error) => {
  console.error(`${getConnectLogPrefix()} ${error.message}`);
  process.exit(1);
});
