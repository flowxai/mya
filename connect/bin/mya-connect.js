#!/usr/bin/env node

const { main } = require("../src/index");
const { getConnectLogPrefix } = require("../src/shared/branding");

main().catch((error) => {
  console.error(`${getConnectLogPrefix()} ${error.message}`);
  process.exit(1);
});
