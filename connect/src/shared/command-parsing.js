function extractBindPath(text) {
  return extractCommandArgument(text, "/mya bind ");
}

function extractSwitchThreadId(text) {
  return extractCommandArgument(text, "/mya switch ");
}

function extractRemoveWorkspacePath(text) {
  return extractCommandArgument(text, "/mya remove ");
}

function extractSendPath(text) {
  return extractCommandArgument(text, "/mya send ");
}

function extractModelValue(text) {
  return extractCommandArgument(text, "/mya model ");
}

function extractEffortValue(text) {
  return extractCommandArgument(text, "/mya effort ");
}

function extractCommandArgument(text, prefix) {
  const trimmed = String(text || "").trim();
  const normalizedPrefix = String(prefix || "").toLowerCase();
  if (trimmed.toLowerCase().startsWith(normalizedPrefix)) {
    return trimmed.slice(normalizedPrefix.length).trim();
  }
  return "";
}

module.exports = {
  extractBindPath,
  extractCommandArgument,
  extractEffortValue,
  extractModelValue,
  extractRemoveWorkspacePath,
  extractSendPath,
  extractSwitchThreadId,
};
