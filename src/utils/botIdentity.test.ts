import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('bot identity resolution', () => {
  test('loads bot identity from hub profile storage and live session context', async () => {
    const homeDir = path.join(os.tmpdir(), `mya-bot-${Date.now()}`)
    const profileDir = path.join(
      homeDir,
      '.mya',
      'connect',
      'hub',
      'profiles',
      'review-bot',
    )
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(
      path.join(profileDir, 'profile.json'),
      JSON.stringify(
        {
          profileId: 'review-bot',
          name: 'Review Bot',
          description: 'Reviews pull requests and design changes.',
          permissionMode: 'plan',
          workers: ['reviewer'],
          identity: {
            ownerAddress: '主人',
            language: '中文',
            style: '简洁直接',
          },
          channels: [
            {
              type: 'feishu',
              defaultWorkspaceRoot: '/srv/repo',
              permissionMode: 'plan',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )
    writeFileSync(
      path.join(profileDir, 'BOT.md'),
      '# Review Bot\n\n- Always focus on pull request risk.\n- Keep replies concise.\n',
      'utf8',
    )

    process.env.HOME = homeDir
    process.env.MYA_HUB_PROFILE_ID = 'review-bot'

    const { resolveBotIdentity } = await import('./botIdentity.js')
    const identity = await resolveBotIdentity({
      cwd: '/workspace/current',
      permissionMode: 'acceptEdits',
    })

    expect(identity).toMatchObject({
      profileId: 'review-bot',
      name: 'Review Bot',
      role: 'reviewer',
      purpose: 'Reviews pull requests and design changes.',
      ownerAddress: '主人',
      language: '中文',
      style: '简洁直接',
      workspace: '/workspace/current',
      permissionMode: 'acceptEdits',
    })
    expect(identity?.profilePath).toContain('/.mya/connect/hub/profiles/review-bot/profile.json')
    expect(identity?.instructionsPath).toContain('/.mya/connect/hub/profiles/review-bot/BOT.md')
    expect(identity?.instructions).toContain('Always focus on pull request risk.')

    rmSync(homeDir, { recursive: true, force: true })
  })

  test('prefers explicit env overrides over profile defaults', async () => {
    process.env.MYA_HUB_PROFILE_ID = 'review-bot'
    process.env.MYA_HUB_WORKER_TYPE = 'triager'
    process.env.MYA_BOT_NAME = 'Triage Bot'
    process.env.MYA_BOT_PURPOSE = 'Own incoming bug triage.'
    process.env.MYA_BOT_OWNER_ADDRESS = '老板'
    process.env.MYA_BOT_DEFAULT_LANGUAGE = 'English'
    process.env.MYA_BOT_WORKSPACE = '/env/workspace'
    process.env.MYA_BOT_PERMISSION_MODE = 'bypassPermissions'

    const { resolveBotIdentity } = await import('./botIdentity.js')
    const identity = await resolveBotIdentity({
      cwd: '/workspace/current',
      permissionMode: 'plan',
    })

    expect(identity).toMatchObject({
      profileId: 'review-bot',
      name: 'Triage Bot',
      role: 'triager',
      purpose: 'Own incoming bug triage.',
      ownerAddress: '老板',
      language: 'English',
      workspace: '/env/workspace',
      permissionMode: 'bypassPermissions',
    })
    expect(identity?.profilePath).toContain('/.mya/connect/hub/profiles/review-bot/profile.json')
  })

  test('reads active bot env vars and nested identity metadata from the profile file', async () => {
    const homeDir = path.join(os.tmpdir(), `mya-bot-active-${Date.now()}`)
    const profileDir = path.join(
      homeDir,
      '.mya',
      'connect',
      'hub',
      'profiles',
      'ops-bot',
    )
    const profilePath = path.join(profileDir, 'profile.json')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(
      profilePath,
      JSON.stringify(
        {
          profileId: 'ops-bot',
          name: 'Ops Bot',
          permissionMode: 'plan',
          defaultWorkspaceRoot: '/srv/ops',
          workspaceAllowlist: ['/srv/ops'],
          channels: [],
          identity: {
            status: 'bootstrap',
            role: 'operator',
            purpose: 'Keep production healthy.',
            ownerAddress: '主人',
            language: '中文',
            style: 'short, decisive, and incident-focused',
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    const instructionsPath = path.join(profileDir, 'BOT.md')
    writeFileSync(
      instructionsPath,
      '# Ops Bot\n\n- Speak like an incident commander.\n',
      'utf8',
    )

    process.env.HOME = homeDir
    process.env.MYA_ACTIVE_BOT_ID = 'ops-bot'
    process.env.MYA_ACTIVE_BOT_PROFILE_PATH = profilePath
    process.env.MYA_ACTIVE_BOT_INSTRUCTIONS_PATH = instructionsPath
    process.env.MYA_ACTIVE_BOT_BOOTSTRAP = '1'

    const { resolveBotIdentity } = await import('./botIdentity.js')
    const identity = await resolveBotIdentity({
      cwd: '/workspace/current',
      permissionMode: 'acceptEdits',
    })

    expect(identity).toEqual({
      profileId: 'ops-bot',
      name: 'Ops Bot',
      role: 'operator',
      purpose: 'Keep production healthy.',
      ownerAddress: '主人',
      language: '中文',
      workspace: '/workspace/current',
      permissionMode: 'acceptEdits',
      profilePath,
      instructionsPath,
      instructions: '# Ops Bot\n\n- Speak like an incident commander.',
      bootstrap: true,
      style: 'short, decisive, and incident-focused',
    })

    rmSync(homeDir, { recursive: true, force: true })
  })

  test('persisted configured profile overrides stale bootstrap env in the same session', async () => {
    const homeDir = path.join(os.tmpdir(), `mya-bot-configured-${Date.now()}`)
    const profileDir = path.join(
      homeDir,
      '.mya',
      'connect',
      'hub',
      'profiles',
      'ops-bot',
    )
    const profilePath = path.join(profileDir, 'profile.json')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(
      profilePath,
      JSON.stringify(
        {
          profileId: 'ops-bot',
          name: 'Ops Bot',
          identity: {
            status: 'configured',
            role: 'operator',
            purpose: 'Keep production healthy.',
          },
          channels: [],
        },
        null,
        2,
      ),
      'utf8',
    )

    process.env.HOME = homeDir
    process.env.MYA_ACTIVE_BOT_ID = 'ops-bot'
    process.env.MYA_ACTIVE_BOT_PROFILE_PATH = profilePath
    process.env.MYA_ACTIVE_BOT_BOOTSTRAP = '1'

    const { resolveBotIdentity } = await import('./botIdentity.js')
    const identity = await resolveBotIdentity({
      cwd: '/workspace/current',
      permissionMode: 'default',
    })

    expect(identity?.bootstrap).toBeUndefined()

    rmSync(homeDir, { recursive: true, force: true })
  })

  test('returns null when no bot or profile signal is active', async () => {
    delete process.env.MYA_HUB_PROFILE_ID
    delete process.env.MYA_HUB_WORKER_TYPE
    delete process.env.MYA_BOT_NAME
    delete process.env.MYA_BOT_ROLE
    delete process.env.MYA_BOT_PURPOSE
    delete process.env.MYA_BOT_WORKSPACE
    delete process.env.MYA_BOT_PERMISSION_MODE

    const { resolveBotIdentity } = await import('./botIdentity.js')
    const identity = await resolveBotIdentity({
      cwd: '/workspace/current',
      permissionMode: 'default',
    })

    expect(identity).toBeNull()
  })

  test('formats prompt and command output from the resolved identity', async () => {
    const { buildBotIdentityPrompt, formatBotIdentity } = await import(
      './botIdentity.js'
    )

    const identity = {
      profileId: 'review-bot',
      name: 'Review Bot',
      role: 'reviewer',
      purpose: 'Reviews pull requests and design changes.',
      ownerAddress: '主人',
      language: '中文',
      workspace: '/workspace/current',
      permissionMode: 'plan',
      profilePath: '/tmp/review-bot/profile.json',
      instructionsPath: '/tmp/review-bot/BOT.md',
      instructions: '- Always focus on risky changes.',
      bootstrap: true,
    }

    expect(buildBotIdentityPrompt(identity)).toContain('Review Bot')
    expect(buildBotIdentityPrompt(identity)).toContain('permissionMode: plan')
    expect(buildBotIdentityPrompt(identity)).toContain('ownerAddress: 主人')
    expect(buildBotIdentityPrompt(identity)).toContain('defaultLanguage: 中文')
    expect(buildBotIdentityPrompt(identity)).toContain('profilePath: /tmp/review-bot/profile.json')
    expect(buildBotIdentityPrompt(identity)).toContain('instructionsPath: /tmp/review-bot/BOT.md')
    expect(buildBotIdentityPrompt(identity)).toContain('Follow them as stable operating guidance')
    expect(buildBotIdentityPrompt(identity)).toContain('newly created bot')
    expect(buildBotIdentityPrompt(identity)).toContain('identity.status becomes "configured"')
    expect(buildBotIdentityPrompt(identity)).toContain('update the bot profile file at profilePath and BOT.md')
    expect(formatBotIdentity(identity)).toContain('Profile: review-bot')
    expect(formatBotIdentity(identity)).toContain('Owner address: 主人')
    expect(formatBotIdentity(identity)).toContain('Default language: 中文')
    expect(formatBotIdentity(identity)).toContain('Workspace: /workspace/current')
    expect(formatBotIdentity(identity)).toContain('Identity status: bootstrap')
    expect(formatBotIdentity(identity)).toContain('Bot instructions: /tmp/review-bot/BOT.md')
  })
})
