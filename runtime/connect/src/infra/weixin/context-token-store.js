const fs = require("fs");
const path = require("path");

function normalizeAccountId(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function ensureAccountsDir(config) {
  fs.mkdirSync(config.accountsDir, { recursive: true });
}

function resolveContextTokenPath(config, accountId) {
  ensureAccountsDir(config);
  return path.join(config.accountsDir, `${normalizeAccountId(accountId)}.context-tokens.json`);
}

function loadPersistedContextTokens(config, accountId) {
  try {
    const filePath = resolveContextTokenPath(config, accountId);
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([userId, token]) => (
          typeof userId === "string"
          && userId.trim()
          && typeof token === "string"
          && token.trim()
        ))
        .map(([userId, token]) => [userId.trim(), token.trim()])
    );
  } catch {
    return {};
  }
}

function savePersistedContextTokens(config, accountId, tokens) {
  const normalizedTokens = Object.fromEntries(
    Object.entries(tokens || {})
      .filter(([userId, token]) => (
        typeof userId === "string"
        && userId.trim()
        && typeof token === "string"
        && token.trim()
      ))
      .map(([userId, token]) => [userId.trim(), token.trim()])
  );
  const filePath = resolveContextTokenPath(config, accountId);
  fs.writeFileSync(filePath, JSON.stringify(normalizedTokens, null, 2), "utf8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best effort
  }
  return normalizedTokens;
}

function persistContextToken(config, accountId, userId, token) {
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  const normalizedToken = typeof token === "string" ? token.trim() : "";
  if (!normalizedUserId || !normalizedToken) {
    return loadPersistedContextTokens(config, accountId);
  }

  const existing = loadPersistedContextTokens(config, accountId);
  if (existing[normalizedUserId] === normalizedToken) {
    return existing;
  }

  return savePersistedContextTokens(config, accountId, {
    ...existing,
    [normalizedUserId]: normalizedToken,
  });
}

function clearPersistedContextTokens(config, accountId) {
  try {
    const filePath = resolveContextTokenPath(config, accountId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // best effort
  }
}

module.exports = {
  clearPersistedContextTokens,
  loadPersistedContextTokens,
  persistContextToken,
  resolveContextTokenPath,
};
