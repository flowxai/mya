const { spawn } = require("child_process");
const path = require("path");
const { buildProfileRunContext } = require("../../hub/agents/profile-run-context");
const {
  resolveBotInstructionsPath,
} = require("../../hub/profiles/bot-instructions");
const {
  getHubProfilesRoot,
} = require("../../shared/runtime-paths");

async function spawnProcess(invocation) {
  return await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
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
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function runMyaPrompt(input, spawnImpl = spawnProcess) {
  const profileRunContext = resolveProfileRunContextInput(input);
  assertWorkerPolicy(profileRunContext);

  const args = [
    "--print",
    "--bare",
    "--output-format",
    "text",
    "--disable-slash-commands",
    "--permission-mode",
    input.permissionMode || profileRunContext?.permissionMode || "auto",
  ];

  if (input.enableAutoMode) {
    args.push("--enable-auto-mode");
  }

  if (input.model || profileRunContext?.model) {
    args.push("--model", input.model || profileRunContext.model);
  }

  if (input.effort || profileRunContext?.effort) {
    args.push("--effort", input.effort || profileRunContext.effort);
  }

  if (input.resumeSessionId) {
    args.push("--resume", input.resumeSessionId);
  } else if (input.sessionId) {
    args.push("--session-id", input.sessionId);
  }

  args.push(input.text);

  const result = await spawnImpl({
    command: input.myaCommand || "mya",
    args,
    cwd: input.workspaceRoot,
    env: {
      ...process.env,
      ...(input.baseUrl || profileRunContext?.baseUrl
        ? { ANTHROPIC_BASE_URL: input.baseUrl || profileRunContext.baseUrl }
        : {}),
      ...(input.apiKey || profileRunContext?.apiKey
        ? { ANTHROPIC_API_KEY: input.apiKey || profileRunContext.apiKey }
        : {}),
      ...(input.authToken || profileRunContext?.authToken
        ? { ANTHROPIC_AUTH_TOKEN: input.authToken || profileRunContext.authToken }
        : {}),
      ...(profileRunContext?.profileId ? { MYA_ACTIVE_BOT_ID: profileRunContext.profileId } : {}),
      ...(profileRunContext?.profileId ? { MYA_ACTIVE_BOT_PROFILE_ID: profileRunContext.profileId } : {}),
      ...(profileRunContext?.profileId ? { MYA_HUB_PROFILE_ID: profileRunContext.profileId } : {}),
      ...(profileRunContext?.profileId
        ? { MYA_ACTIVE_BOT_PROFILE_PATH: resolveProfilePath(profileRunContext.profileId) }
        : {}),
      ...(profileRunContext?.profileId
        ? { MYA_ACTIVE_BOT_INSTRUCTIONS_PATH: resolveBotInstructionsPath(profileRunContext.profileId) }
        : {}),
      ...(profileRunContext?.memoryNamespace
        ? { MYA_HUB_MEMORY_NAMESPACE: profileRunContext.memoryNamespace }
        : {}),
      ...(profileRunContext?.workerPolicy?.requestedType
        ? { MYA_HUB_WORKER_TYPE: profileRunContext.workerPolicy.requestedType }
        : {}),
    },
  });

  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "mya failed";
    throw new Error(`mya failed: ${detail}`);
  }

  return result.stdout.trim();
}

function resolveProfilePath(profileId) {
  const profilesRoot = process.env.MYA_HUB_PROFILES_ROOT
    || getHubProfilesRoot();
  return path.join(profilesRoot, profileId, "profile.json");
}

function resolveProfileRunContextInput(input) {
  if (input?.profileRunContext && typeof input.profileRunContext === "object") {
    return input.profileRunContext;
  }
  if (input?.profile && typeof input.profile === "object") {
    return buildProfileRunContext({
      profile: input.profile,
      requestedType: input.requestedWorkerType,
      inheritedMemoryNamespace: input.inheritedMemoryNamespace,
    });
  }
  return null;
}

function assertWorkerPolicy(profileRunContext) {
  const policy = profileRunContext?.workerPolicy;
  if (!policy || policy.allowed !== false) {
    return;
  }

  const allowed = Array.isArray(policy.allowedWorkerTypes) ? policy.allowedWorkerTypes.join(", ") : "";
  throw new Error(
    `Requested worker type "${policy.requestedType || "(unknown)"}" is not allowed.`
      + (allowed ? ` Allowed: ${allowed}` : "")
  );
}

module.exports = {
  runMyaPrompt,
};
