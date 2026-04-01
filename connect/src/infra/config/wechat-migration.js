const fs = require("fs");
const os = require("os");
const path = require("path");
const dotenv = require("dotenv");

function resolveWechatMigrationPaths({ env = process.env, homeDir = os.homedir() } = {}) {
  const defaultLegacyStateDir = path.join(homeDir, ".mya-wechat");
  const defaultTargetStateDir = path.join(homeDir, ".mya-connect", "wechat");
  const defaultLegacyEnvPath = path.join(defaultLegacyStateDir, ".env");
  const parsedLegacyEnv = readEnvFile(defaultLegacyEnvPath);
  const legacyStateDir = normalizePath(env.MYA_WECHAT_STATE_DIR)
    || normalizePath(parsedLegacyEnv.MYA_WECHAT_STATE_DIR)
    || defaultLegacyStateDir;

  return {
    legacyStateDir,
    legacyEnvPath: fs.existsSync(defaultLegacyEnvPath)
      ? defaultLegacyEnvPath
      : path.join(legacyStateDir, ".env"),
    targetStateDir: normalizePath(env.MYA_CONNECT_WECHAT_STATE_DIR) || defaultTargetStateDir,
  };
}

function migrateLegacyWechatState({
  legacyStateDir,
  legacyEnvPath,
  targetStateDir,
} = {}) {
  const normalizedLegacyStateDir = normalizePath(legacyStateDir);
  const normalizedTargetStateDir = normalizePath(targetStateDir);
  const resolvedLegacyEnvPath = normalizePath(legacyEnvPath)
    || path.join(normalizedLegacyStateDir, ".env");
  const summary = {
    sourceDetected: false,
    migrated: false,
    reason: "no-source",
    legacyStateDir: normalizedLegacyStateDir,
    targetStateDir: normalizedTargetStateDir,
    copiedAccounts: 0,
    skippedAccounts: 0,
    copiedSyncBuffers: 0,
    skippedSyncBuffers: 0,
    copiedSessionsFile: false,
    copiedEnvFile: false,
  };

  if (!normalizedLegacyStateDir || !normalizedTargetStateDir) {
    return summary;
  }

  const sourceAccountsDir = path.join(normalizedLegacyStateDir, "accounts");
  const sourceSessionsFile = path.join(normalizedLegacyStateDir, "sessions.json");
  const sourceSyncBufferDir = path.join(normalizedLegacyStateDir, "sync-buf");
  const targetAccountsDir = path.join(normalizedTargetStateDir, "accounts");
  const targetSessionsFile = path.join(normalizedTargetStateDir, "sessions.json");
  const targetSyncBufferDir = path.join(normalizedTargetStateDir, "sync-buf");
  const targetEnvFile = path.join(normalizedTargetStateDir, ".env");

  summary.sourceDetected = [
    sourceAccountsDir,
    sourceSessionsFile,
    sourceSyncBufferDir,
    resolvedLegacyEnvPath,
  ].some((candidatePath) => fs.existsSync(candidatePath));
  if (!summary.sourceDetected) {
    return summary;
  }

  if (path.resolve(normalizedLegacyStateDir) === path.resolve(normalizedTargetStateDir)) {
    summary.reason = "same-dir";
    return summary;
  }

  fs.mkdirSync(normalizedTargetStateDir, { recursive: true });
  summary.copiedAccounts = copyDirectoryEntries(sourceAccountsDir, targetAccountsDir, {
    filter: (entry) => entry.isFile() && entry.name.endsWith(".json"),
    onSkip: () => {
      summary.skippedAccounts += 1;
    },
  });
  summary.copiedSyncBuffers = copyDirectoryEntries(sourceSyncBufferDir, targetSyncBufferDir, {
    filter: (entry) => entry.isFile(),
    onSkip: () => {
      summary.skippedSyncBuffers += 1;
    },
  });
  summary.copiedSessionsFile = copyFileIfMissing(sourceSessionsFile, targetSessionsFile);
  summary.copiedEnvFile = copyTranslatedEnvFileIfMissing(
    resolvedLegacyEnvPath,
    targetEnvFile,
    normalizedLegacyStateDir,
    normalizedTargetStateDir,
  );
  summary.migrated = Boolean(
    summary.copiedAccounts
      || summary.copiedSyncBuffers
      || summary.copiedSessionsFile
      || summary.copiedEnvFile,
  );
  summary.reason = summary.migrated ? "copied" : "no-changes";
  return summary;
}

function copyDirectoryEntries(sourceDir, targetDir, { filter, onSkip } = {}) {
  if (!fs.existsSync(sourceDir)) {
    return 0;
  }

  let copiedCount = 0;
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (typeof filter === "function" && !filter(entry)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (fs.existsSync(targetPath)) {
      if (typeof onSkip === "function") {
        onSkip(entry.name);
      }
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
    copiedCount += 1;
  }
  return copiedCount;
}

function copyFileIfMissing(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
    return false;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function copyTranslatedEnvFileIfMissing(sourcePath, targetPath, legacyStateDir, targetStateDir) {
  if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
    return false;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(
    targetPath,
    translateLegacyWechatEnv(fs.readFileSync(sourcePath, "utf8"), {
      legacyStateDir,
      targetStateDir,
    }),
    "utf8",
  );
  return true;
}

function translateLegacyWechatEnv(sourceText, { legacyStateDir, targetStateDir }) {
  const normalizedLegacyStateDir = normalizePath(legacyStateDir);
  const normalizedTargetStateDir = normalizePath(targetStateDir);
  const pathRewrites = new Map([
    ["MYA_WECHAT_STATE_DIR", normalizedTargetStateDir],
    ["MYA_WECHAT_SESSIONS_FILE", path.join(normalizedTargetStateDir, "sessions.json")],
    ["MYA_WECHAT_SYNC_BUFFER_DIR", path.join(normalizedTargetStateDir, "sync-buf")],
  ]);

  return String(sourceText || "")
    .split(/\r?\n/)
    .map((line) => rewriteEnvLine(line, {
      legacyStateDir: normalizedLegacyStateDir,
      targetStateDir: normalizedTargetStateDir,
      pathRewrites,
    }))
    .join("\n");
}

function rewriteEnvLine(line, { legacyStateDir, targetStateDir, pathRewrites }) {
  const match = /^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!match) {
    return line;
  }

  const [, indentation, exportPrefix = "", key, rawValue] = match;
  if (!key.startsWith("MYA_WECHAT_")) {
    return line;
  }

  const nextKey = key.replace(/^MYA_WECHAT_/, "MYA_CONNECT_WECHAT_");
  const normalizedRawValue = String(rawValue || "").trim();
  let nextValue = normalizedRawValue;
  if (pathRewrites.has(key)) {
    nextValue = pathRewrites.get(key);
  } else if (normalizedRawValue) {
    nextValue = normalizedRawValue.split(legacyStateDir).join(targetStateDir);
  }

  return `${indentation}${exportPrefix}${nextKey}=${nextValue}`;
}

function readEnvFile(filePath) {
  try {
    return dotenv.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function normalizePath(value) {
  return typeof value === "string" && value.trim() ? path.resolve(value.trim()) : "";
}

module.exports = {
  migrateLegacyWechatState,
  resolveWechatMigrationPaths,
  translateLegacyWechatEnv,
};
