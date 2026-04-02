function getConnectCommandName() {
  return "mya";
}

function getConnectLogPrefix(channel = "") {
  if (!channel) {
    return "[mya runtime]";
  }
  return `[mya runtime][${channel}]`;
}

function getPermissionDeniedSource(channel = "") {
  if (!channel) {
    return "Permission denied from mya runtime";
  }
  return `Permission denied from mya runtime ${channel}`;
}

module.exports = {
  getConnectCommandName,
  getConnectLogPrefix,
  getPermissionDeniedSource,
};
