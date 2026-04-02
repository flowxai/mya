#!/usr/bin/env node

const { main } = require("../src/index");

main().catch((error) => {
  console.error(`[mya connect][wechat] ${error.message}`);
  process.exit(1);
});
