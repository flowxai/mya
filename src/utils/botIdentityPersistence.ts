import { readFile, writeFile } from 'node:fs/promises'

import type { BotIdentity } from './botIdentity.js'

type PersistedBotProfile = {
  profileId?: string
  name?: string
  role?: string
  purpose?: string
  description?: string
  identity?: {
    status?: string
    role?: string
    purpose?: string
    style?: string
    ownerAddress?: string
    language?: string
    description?: string
  }
  defaultWorkspaceRoot?: string
  workspaceAllowlist?: string[]
}

export type BotIdentityUpdate = {
  name?: string
  role?: string
  purpose?: string
  style?: string
  ownerAddress?: string
  language?: string
}

type ApplyBotIdentityUpdateResult = {
  summary: string
}

export function parseBotIdentityUpdateArgs(
  rawArgs: string,
): BotIdentityUpdate | null {
  const normalized = rawArgs.trim()
  if (!normalized) {
    return null
  }

  const source = normalized.replace(/^set\s+/i, '')
  const matches = Array.from(
    source.matchAll(
      /\b(name|role|purpose|style|owner|ownerAddress|language)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^\s]+))/gi,
    ),
  )

  if (matches.length === 0) {
    return null
  }

  const next: BotIdentityUpdate = {}
  for (const match of matches) {
    const rawKey = String(match[1] || '').toLowerCase()
    const key = (
      rawKey === 'owner' ? 'ownerAddress' : rawKey
    ) as keyof BotIdentityUpdate
    const rawValue = match[2] ?? match[3] ?? match[4] ?? ''
    const value = normalizeText(unescapeQuotedValue(rawValue))
    if (!value) {
      continue
    }
    next[key] = value
  }

  return Object.keys(next).length > 0 ? next : null
}

export async function applyBotIdentityUpdate(
  identity: BotIdentity,
  update: BotIdentityUpdate,
): Promise<ApplyBotIdentityUpdateResult> {
  if (!identity.profilePath) {
    throw new Error('Missing bot profile path for identity update.')
  }
  if (!identity.instructionsPath) {
    throw new Error('Missing BOT.md path for identity update.')
  }

  const profile = await readProfileFile(identity.profilePath)
  const mergedName = update.name ?? identity.name
  const mergedRole = update.role ?? identity.role ?? ''
  const mergedPurpose = update.purpose ?? identity.purpose ?? ''
  const mergedStyle = update.style ?? identity.style ?? ''
  const mergedOwnerAddress =
    update.ownerAddress ?? identity.ownerAddress ?? ''
  const mergedLanguage = update.language ?? identity.language ?? '中文'
  const mergedWorkspace =
    normalizeText(profile.defaultWorkspaceRoot)
    || firstString(profile.workspaceAllowlist)
    || identity.workspace
    || ''

  profile.name = mergedName
  profile.role = mergedRole || profile.role
  profile.purpose = mergedPurpose || profile.purpose
  profile.description = mergedPurpose || profile.description
  profile.identity = {
    ...(isRecord(profile.identity) ? profile.identity : {}),
    status: 'configured',
    ...(mergedRole ? { role: mergedRole } : {}),
    ...(mergedPurpose ? { purpose: mergedPurpose, description: mergedPurpose } : {}),
    ...(mergedStyle ? { style: mergedStyle } : {}),
    ...(mergedOwnerAddress ? { ownerAddress: mergedOwnerAddress } : {}),
    ...(mergedLanguage ? { language: mergedLanguage } : {}),
  }

  await writeFile(
    identity.profilePath,
    `${JSON.stringify(profile, null, 2)}\n`,
    'utf8',
  )

  const currentInstructions = await readTextFile(identity.instructionsPath)
  const nextInstructions = renderBotInstructions({
    existing: currentInstructions,
    name: mergedName,
    role: mergedRole,
    purpose: mergedPurpose,
    style: mergedStyle,
    ownerAddress: mergedOwnerAddress,
    language: mergedLanguage,
    workspace: mergedWorkspace,
  })
  await writeFile(identity.instructionsPath, `${nextInstructions}\n`, 'utf8')

  const savedFields = [
    mergedRole ? `role=${mergedRole}` : '',
    mergedPurpose ? `purpose=${mergedPurpose}` : '',
    mergedStyle ? `style=${mergedStyle}` : '',
    mergedOwnerAddress ? `ownerAddress=${mergedOwnerAddress}` : '',
    mergedLanguage ? `language=${mergedLanguage}` : '',
  ].filter(Boolean)

  return {
    summary:
      savedFields.length > 0
        ? `Saved bot identity: ${savedFields.join(', ')}`
        : 'Saved bot identity.',
  }
}

async function readProfileFile(
  profilePath: string,
): Promise<PersistedBotProfile> {
  try {
    const raw = await readFile(profilePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      return {}
    }
    return parsed as PersistedBotProfile
  } catch {
    return {}
  }
}

async function readTextFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return ''
  }
}

function renderBotInstructions({
  existing,
  name,
  role,
  purpose,
  style,
  ownerAddress,
  language,
  workspace,
}: {
  existing: string
  name: string
  role: string
  purpose: string
  style: string
  ownerAddress: string
  language: string
  workspace: string
}): string {
  let next = normalizeExistingInstructions(existing)
  next = replaceTitle(next, name)
  next = replaceSection(next, 'Identity', [
    `- Role: ${role}`,
    `- Purpose: ${purpose}`,
    `- Style: ${style}`,
    `- Owner address: ${ownerAddress}`,
    `- Default language: ${language}`,
  ])
  if (workspace) {
    next = replaceSection(next, 'Workspace', [
      `- Default workspace: ${workspace}`,
    ])
  }
  if (style) {
    next = replaceLineAfterHeading(
      next,
      'Operating Rules',
      /^- Preferred response style:.*$/m,
      `- Preferred response style: ${style}`,
    )
  }
  return next.trimEnd()
}

function normalizeExistingInstructions(existing: string): string {
  const normalized = existing.trim()
  if (normalized) {
    return normalized
  }

  return [
    '# Bot',
    '',
    '## Identity',
    '- Role:',
    '- Purpose:',
    '- Style:',
    '- Owner address:',
    '- Default language: 中文',
    '',
    '## Workspace',
    '- Default workspace:',
    '',
    '## Operating Rules',
    '- Preferred response style:',
    '- Guardrails / things to avoid:',
    '- Default workflows to follow:',
    '',
    '## Notes',
    '- Edit this file directly to teach the bot how it should behave.',
  ].join('\n')
}

function replaceTitle(source: string, name: string): string {
  const title = `# ${name}`.trim()
  if (/^# .+$/m.test(source)) {
    return source.replace(/^# .+$/m, title)
  }
  return `${title}\n\n${source}`
}

function replaceSection(
  source: string,
  heading: string,
  lines: string[],
): string {
  const block = [`## ${heading}`, ...lines].join('\n')
  const pattern = new RegExp(
    `^## ${escapeRegExp(heading)}\\n[\\s\\S]*?(?=^## |\\Z)`,
    'm',
  )
  if (pattern.test(source)) {
    return source.replace(pattern, block)
  }
  return `${source.trimEnd()}\n\n${block}`
}

function replaceLineAfterHeading(
  source: string,
  heading: string,
  pattern: RegExp,
  replacement: string,
): string {
  const sectionPattern = new RegExp(
    `(^## ${escapeRegExp(heading)}\\n)([\\s\\S]*?)(?=^## |\\Z)`,
    'm',
  )

  if (!sectionPattern.test(source)) {
    return source
  }

  return source.replace(sectionPattern, (_match, prefix: string, body: string) => {
    const nextBody = pattern.test(body)
      ? body.replace(pattern, replacement)
      : `${body.trimEnd()}\n${replacement}\n`
    return `${prefix}${nextBody}`
  })
}

function unescapeQuotedValue(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized ? normalized : undefined
}
