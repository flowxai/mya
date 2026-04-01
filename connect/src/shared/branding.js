function getConnectCommandName() {
  return "mya connect";
}

function getConnectLogPrefix(channel = "") {
  if (!channel) {
    return "[mya connect]";
  }
  return `[mya connect][${channel}]`;
}

function getPermissionDeniedSource(channel = "") {
  if (!channel) {
    return "Permission denied from mya connect";
  }
  return `Permission denied from mya connect ${channel}`;
}

module.exports = {
  getConnectCommandName,
  getConnectLogPrefix,
  getPermissionDeniedSource,
};
