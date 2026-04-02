import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getCwd } from './cwd.js'

export type BotIdentity = {
  profileId?: string
  name: string
  role?: string
  purpose?: string
  style?: string
  ownerAddress?: string
  language?: string
  workspace?: string
  permissionMode?: string
  profilePath?: string
  instructionsPath?: string
  instructions?: string
  bootstrap?: boolean
}

type HubProfile = {
  profileId?: string
  name?: string
  description?: string
  role?: string
  purpose?: string
  defaultWorkspaceRoot?: string
  permissionMode?: string
  workers?: unknown
  orchestration?: {
    defaultWorkerType?: string
  }
  identity?: {
    status?: string
    role?: string
    purpose?: string
    style?: string
    ownerAddress?: string
    language?: string
    description?: string
  }
  workspaceAllowlist?: unknown
  channels?: Array<{
    defaultWorkspaceRoot?: string
    permissionMode?: string
  }>
}

type ResolveBotIdentityOptions = {
  env?: NodeJS.ProcessEnv
  cwd?: string
  permissionMode?: string
  profilesRoot?: string
  readProfileFile?: (path: string, encoding: 'utf8') => Promise<string>
}

const BOT_ENV_KEYS = [
  'MYA_ACTIVE_BOT_ID',
  'MYA_ACTIVE_BOT_PROFILE_ID',
  'MYA_ACTIVE_BOT_PROFILE_PATH',
  'MYA_ACTIVE_BOT_BOOTSTRAP',
  'MYA_HUB_PROFILE_ID',
  'MYA_HUB_WORKER_TYPE',
  'MYA_BOT_PROFILE_ID',
  'MYA_BOT_PROFILE_PATH',
  'MYA_BOT_NAME',
  'MYA_BOT_ROLE',
  'MYA_BOT_PURPOSE',
  'MYA_BOT_STYLE',
  'MYA_BOT_OWNER_ADDRESS',
  'MYA_BOT_DEFAULT_LANGUAGE',
  'MYA_BOT_WORKSPACE',
  'MYA_BOT_PERMISSION_MODE',
  'MYA_ACTIVE_BOT_INSTRUCTIONS_PATH',
  'MYA_BOT_INSTRUCTIONS_PATH',
] as const

export async function resolveBotIdentity(
  options: ResolveBotIdentityOptions = {},
): Promise<BotIdentity | null> {
  const env = options.env ?? process.env
  const profileId = normalizeProfileId(
    readTextEnv(
      env,
      'MYA_ACTIVE_BOT_ID',
      'MYA_ACTIVE_BOT_PROFILE_ID',
      'MYA_HUB_PROFILE_ID',
      'MYA_BOT_PROFILE_ID',
    ),
  )
  const explicitProfilePath = readTextEnv(
    env,
    'MYA_ACTIVE_BOT_PROFILE_PATH',
    'MYA_BOT_PROFILE_PATH',
  )
  const explicitName = readTextEnv(env, 'MYA_BOT_NAME')
  const explicitRole =
    readTextEnv(env, 'MYA_BOT_ROLE') ?? readTextEnv(env, 'MYA_HUB_WORKER_TYPE')
  const explicitPurpose = readTextEnv(env, 'MYA_BOT_PURPOSE')
  const explicitStyle = readTextEnv(env, 'MYA_BOT_STYLE')
  const explicitOwnerAddress = readTextEnv(env, 'MYA_BOT_OWNER_ADDRESS')
  const explicitLanguage = readTextEnv(env, 'MYA_BOT_DEFAULT_LANGUAGE')
  const explicitWorkspace = readTextEnv(env, 'MYA_BOT_WORKSPACE')
  const explicitPermissionMode = readTextEnv(env, 'MYA_BOT_PERMISSION_MODE')
  const explicitInstructionsPath = readTextEnv(
    env,
    'MYA_ACTIVE_BOT_INSTRUCTIONS_PATH',
    'MYA_BOT_INSTRUCTIONS_PATH',
  )
  const explicitBootstrap = readBooleanEnv(
    env,
    'MYA_ACTIVE_BOT_BOOTSTRAP',
  )

  const hasBotSignal =
    BOT_ENV_KEYS.some(key => Boolean(readTextEnv(env, key))) || Boolean(profileId)

  if (!hasBotSignal) {
    return null
  }

  const profile = profileId
    ? await loadHubProfile(profileId, {
        profilesRoot: options.profilesRoot,
        profilePath: explicitProfilePath,
        env,
        readProfileFile: options.readProfileFile,
      })
    : null
  const resolvedInstructionsPath = getInstructionsPath(
    profileId,
    explicitInstructionsPath,
    env,
  )
  const resolvedInstructions = await loadBotInstructions(
    resolvedInstructionsPath,
    options.readProfileFile,
  )

  const resolvedName = explicitName ?? normalizeText(profile?.name) ?? profileId
  if (!resolvedName) {
    return null
  }
  const persistedBootstrap = isProfileBootstrap(profile)
  const resolvedBootstrap =
    profile !== null
      ? persistedBootstrap
      : (typeof explicitBootstrap === 'boolean' ? explicitBootstrap : false)

  return {
    ...(profileId ? { profileId } : {}),
    name: resolvedName,
    ...(explicitRole ?? getProfileRole(profile)
      ? { role: explicitRole ?? getProfileRole(profile) }
      : {}),
    ...(explicitPurpose ?? getProfilePurpose(profile)
      ? { purpose: explicitPurpose ?? getProfilePurpose(profile) }
      : {}),
    ...(explicitStyle ?? getProfileStyle(profile)
      ? { style: explicitStyle ?? getProfileStyle(profile) }
      : {}),
    ...(explicitOwnerAddress ?? getProfileOwnerAddress(profile)
      ? { ownerAddress: explicitOwnerAddress ?? getProfileOwnerAddress(profile) }
      : {}),
    ...(explicitLanguage ?? getProfileLanguage(profile)
      ? { language: explicitLanguage ?? getProfileLanguage(profile) }
      : {}),
    ...(explicitWorkspace ??
    normalizeText(options.cwd) ??
    normalizeText(getCwd()) ??
    getProfileWorkspace(profile)
      ? {
          workspace:
            explicitWorkspace ??
            normalizeText(options.cwd) ??
            normalizeText(getCwd()) ??
            getProfileWorkspace(profile),
        }
      : {}),
    ...(explicitPermissionMode ??
    normalizeText(options.permissionMode) ??
    getProfilePermissionMode(profile)
      ? {
          permissionMode:
            explicitPermissionMode ??
            normalizeText(options.permissionMode) ??
            getProfilePermissionMode(profile),
        }
      : {}),
    ...(explicitProfilePath ?? getProfilePath(profileId, explicitProfilePath, env)
      ? {
          profilePath:
            explicitProfilePath ?? getProfilePath(profileId, explicitProfilePath, env),
        }
      : {}),
    ...(resolvedInstructionsPath
      ? {
          instructionsPath: resolvedInstructionsPath,
        }
      : {}),
    ...(resolvedInstructions
      ? {
          instructions: resolvedInstructions,
        }
      : {}),
    ...(resolvedBootstrap
      ? {
          bootstrap: resolvedBootstrap,
        }
      : {}),
  }
}

export function buildBotIdentityPrompt(identity: BotIdentity | null): string {
  if (!identity) {
    return ''
  }

  const sections = [
    '# Active Bot Identity',
    'You are operating in this terminal session as the following bot identity.',
    ...(identity.profileId ? [`- profileId: ${identity.profileId}`] : []),
    `- name: ${identity.name}`,
    ...(identity.role ? [`- role: ${identity.role}`] : []),
    ...(identity.purpose ? [`- purpose: ${identity.purpose}`] : []),
    ...(identity.style ? [`- style: ${identity.style}`] : []),
    ...(identity.ownerAddress ? [`- ownerAddress: ${identity.ownerAddress}`] : []),
    ...(identity.language ? [`- defaultLanguage: ${identity.language}`] : []),
    ...(identity.workspace ? [`- workspace: ${identity.workspace}`] : []),
    ...(identity.permissionMode
      ? [`- permissionMode: ${identity.permissionMode}`]
      : []),
    ...(identity.profilePath ? [`- profilePath: ${identity.profilePath}`] : []),
    ...(identity.instructionsPath
      ? [`- instructionsPath: ${identity.instructionsPath}`]
      : []),
    ...(identity.bootstrap
      ? [
          '- bootstrap: true',
          'This is a newly created bot. Treat onboarding as active until the bot identity is configured.',
          'When the user asks who you are or invokes /whoru, ask concise follow-up questions only for missing display-name, role, purpose, working style, and how the bot should address the owner.',
          'Default language should be Chinese unless the user explicitly asks for another language.',
          'As soon as the user gives enough concrete identity details, update the bot profile file at profilePath and BOT.md at instructionsPath in the same turn instead of asking unnecessary extra questions.',
          'When updating profilePath, ensure identity.status becomes "configured" and write identity.role, identity.purpose, identity.style, identity.ownerAddress, and identity.language when known.',
          'When updating BOT.md, keep it concise and durable. Capture the bot role, purpose, preferred working style, how it addresses the owner, default language, and any stable guardrails or workflow defaults the user explicitly wants.',
          'After saving those files, briefly confirm what was updated and continue speaking as that bot.',
        ]
      : []),
    'Use this identity when referring to your role, responsibilities, and operating constraints.',
  ]

  if (identity.instructions) {
    sections.push(
      '',
      '# Active Bot Instructions',
      `The following durable bot-specific instructions come from ${identity.instructionsPath ?? 'BOT.md'}.`,
      'Follow them as stable operating guidance unless the user explicitly overrides them for the current request.',
      '',
      identity.instructions,
    )
  }

  return sections.join('\n')
}

export function formatBotIdentity(identity: BotIdentity | null): string {
  if (!identity) {
    return 'No active bot identity for this session.'
  }

  return [
    ...(identity.profileId ? [`Profile: ${identity.profileId}`] : []),
    `Name: ${identity.name}`,
    ...(identity.role ? [`Role: ${identity.role}`] : []),
    ...(identity.purpose ? [`Purpose: ${identity.purpose}`] : []),
    ...(identity.style ? [`Style: ${identity.style}`] : []),
    ...(identity.ownerAddress ? [`Owner address: ${identity.ownerAddress}`] : []),
    ...(identity.language ? [`Default language: ${identity.language}`] : []),
    ...(identity.workspace ? [`Workspace: ${identity.workspace}`] : []),
    ...(identity.permissionMode
      ? [`Permission mode: ${identity.permissionMode}`]
      : []),
    ...(identity.profilePath ? [`Profile file: ${identity.profilePath}`] : []),
    ...(identity.instructionsPath
      ? [`Bot instructions: ${identity.instructionsPath}`]
      : []),
    ...(identity.bootstrap
      ? [
          'Identity status: bootstrap',
          'This bot is new. Tell me its role, purpose, working style, how it should address you, and I can help write those details back into the bot profile. Default language is Chinese unless you want something else.',
        ]
      : []),
  ].join('\n')
}

async function loadHubProfile(
  profileId: string,
  options: {
    env: NodeJS.ProcessEnv
    profilesRoot?: string
    profilePath?: string
    readProfileFile?: (path: string, encoding: 'utf8') => Promise<string>
  },
): Promise<HubProfile | null> {
  const filePath =
    normalizeText(options.profilePath) ??
    join(
      normalizeText(options.profilesRoot) ?? resolveHubProfilesRoot(options.env),
      profileId,
      'profile.json',
    )
  const readProfileFile = options.readProfileFile ?? readFile

  try {
    const raw = await readProfileFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as HubProfile
  } catch {
    return null
  }
}

function resolveHubProfilesRoot(env: NodeJS.ProcessEnv): string {
  const explicitRoot = readTextEnv(env, 'MYA_HUB_PROFILES_ROOT')
  if (explicitRoot) {
    return explicitRoot
  }

  const baseHome = normalizeText(env.HOME) ?? homedir()
  const explicitConfigRoot =
    normalizeText(env.MYA_CONFIG_DIR) ??
    normalizeText(env.MYA_CONNECT_CONFIG_DIR) ??
    normalizeText(env.MY_AGENT_CONFIG_DIR) ??
    normalizeText(env.CLAUDE_CONFIG_DIR)
  if (explicitConfigRoot) {
    const normalizedRoot =
      explicitConfigRoot.endsWith('/connect') || explicitConfigRoot.endsWith('\\connect')
        ? explicitConfigRoot
        : join(explicitConfigRoot, 'connect')
    return join(normalizedRoot, 'hub', 'profiles')
  }
  return join(baseHome, '.mya', 'connect', 'hub', 'profiles')
}

function getProfileRole(profile: HubProfile | null): string | undefined {
  const nestedRole = normalizeText(profile?.identity?.role)
  if (nestedRole) {
    return nestedRole
  }

  const directRole = normalizeText(profile?.role)
  if (directRole) {
    return directRole
  }

  const workerType = normalizeText(profile?.orchestration?.defaultWorkerType)
  if (workerType) {
    return workerType
  }

  if (Array.isArray(profile?.workers)) {
    for (const worker of profile.workers) {
      const normalizedWorker = normalizeText(worker)
      if (normalizedWorker) {
        return normalizedWorker
      }
    }
  }

  return undefined
}

function getProfilePurpose(profile: HubProfile | null): string | undefined {
  return (
    normalizeText(profile?.identity?.purpose) ??
    normalizeText(profile?.purpose) ??
    normalizeText(profile?.identity?.description) ??
    normalizeText(profile?.description)
  )
}

function getProfileStyle(profile: HubProfile | null): string | undefined {
  return normalizeText(profile?.identity?.style)
}

function getProfileOwnerAddress(profile: HubProfile | null): string | undefined {
  return normalizeText(profile?.identity?.ownerAddress)
}

function getProfileLanguage(profile: HubProfile | null): string | undefined {
  return normalizeText(profile?.identity?.language) ?? '中文'
}

function getProfileWorkspace(profile: HubProfile | null): string | undefined {
  const directWorkspace = normalizeText(profile?.defaultWorkspaceRoot)
  if (directWorkspace) {
    return directWorkspace
  }

  const allowlistEntry = firstString(profile?.workspaceAllowlist)
  if (allowlistEntry) {
    return allowlistEntry
  }

  if (Array.isArray(profile?.channels)) {
    for (const channel of profile.channels) {
      const workspace = normalizeText(channel?.defaultWorkspaceRoot)
      if (workspace) {
        return workspace
      }
    }
  }

  return undefined
}

function getProfilePermissionMode(
  profile: HubProfile | null,
): string | undefined {
  const direct = normalizeText(profile?.permissionMode)
  if (direct) {
    return direct
  }

  if (Array.isArray(profile?.channels)) {
    for (const channel of profile.channels) {
      const permissionMode = normalizeText(channel?.permissionMode)
      if (permissionMode) {
        return permissionMode
      }
    }
  }

  return undefined
}

function getProfilePath(
  profileId: string | undefined,
  explicitProfilePath: string | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (explicitProfilePath) {
    return explicitProfilePath
  }
  if (!profileId) {
    return undefined
  }
  return join(resolveHubProfilesRoot(env), profileId, 'profile.json')
}

function getInstructionsPath(
  profileId: string | undefined,
  explicitInstructionsPath: string | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (explicitInstructionsPath) {
    return explicitInstructionsPath
  }
  if (!profileId) {
    return undefined
  }
  return join(resolveHubProfilesRoot(env), profileId, 'BOT.md')
}

function isProfileBootstrap(profile: HubProfile | null): boolean {
  return normalizeText(profile?.identity?.status) === 'bootstrap'
}

async function loadBotInstructions(
  filePath: string | undefined,
  readProfileFile?: (path: string, encoding: 'utf8') => Promise<string>,
): Promise<string | undefined> {
  const normalizedPath = normalizeText(filePath)
  if (!normalizedPath) {
    return undefined
  }

  const readTextFile = readProfileFile ?? readFile

  try {
    const raw = await readTextFile(normalizedPath, 'utf8')
    const normalized = normalizeText(raw)
    return normalized
  } catch {
    return undefined
  }
}

function firstString(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  for (const item of value) {
    const normalized = normalizeText(item)
    if (normalized) {
      return normalized
    }
  }

  return undefined
}

function normalizeProfileId(value: string | undefined): string | undefined {
  const normalized = normalizeText(value)
  if (!normalized) {
    return undefined
  }

  return normalized
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function readTextEnv(
  env: NodeJS.ProcessEnv,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = normalizeText(env[key])
    if (value) {
      return value
    }
  }
  return undefined
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized ? normalized : undefined
}

function readBooleanEnv(
  env: NodeJS.ProcessEnv,
  ...keys: readonly string[]
): boolean | undefined {
  const raw = readTextEnv(env, ...keys)
  if (!raw) {
    return undefined
  }

  switch (raw.toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false
    default:
      return undefined
  }
}
