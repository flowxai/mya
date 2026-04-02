const fs = require("fs");
const os = require("os");
const path = require("path");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getHomeDir(options = {}) {
  return normalizeText(options.homeDir)
    || normalizeText(options.env?.HOME)
    || os.homedir();
}

function getPrimaryConfigRoot(options = {}) {
  const env = options.env || process.env;
  return normalizeText(env.MYA_CONFIG_DIR)
    || normalizeText(env.MY_AGENT_CONFIG_DIR)
    || normalizeText(env.CLAUDE_CONFIG_DIR)
    || path.join(getHomeDir(options), ".mya");
}

function getLegacyConnectRoot(options = {}) {
  return path.join(getHomeDir(options), ".mya-connect");
}

function ensureLegacyTreeMigrated(targetDir, legacyDir) {
  if (!targetDir || !legacyDir || targetDir === legacyDir) {
    return targetDir;
  }
  if (!fs.existsSync(legacyDir) || fs.existsSync(targetDir)) {
    return targetDir;
  }

  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(legacyDir, targetDir, { recursive: true });
  return targetDir;
}

function getConnectConfigRoot(options = {}) {
  const env = options.env || process.env;
  const explicitRoot = normalizeText(options.connectRoot)
    || normalizeText(env.MYA_CONNECT_CONFIG_DIR);
  if (explicitRoot) {
    return explicitRoot;
  }

  const targetRoot = path.join(getPrimaryConfigRoot(options), "connect");
  if (options.migrate === false) {
    return targetRoot;
  }
  return ensureLegacyTreeMigrated(targetRoot, getLegacyConnectRoot(options));
}

function getConnectChannelRoot(channel, options = {}) {
  return path.join(getConnectConfigRoot(options), channel);
}

function getHubStateRoot(options = {}) {
  return path.join(getConnectConfigRoot(options), "hub");
}

function getHubProfilesRoot(options = {}) {
  return path.join(getHubStateRoot(options), "profiles");
}

module.exports = {
  getConnectChannelRoot,
  getConnectConfigRoot,
  getHubProfilesRoot,
  getHubStateRoot,
  getLegacyConnectRoot,
  getPrimaryConfigRoot,
};
