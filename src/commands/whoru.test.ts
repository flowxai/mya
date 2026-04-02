import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

describe('whoru command', () => {
  test('descriptor exposes /whoru as a prompt command', async () => {
    const mod = await import('./whoru.js')

    expect(mod.default.name).toBe('whoru')
    expect(mod.default.type).toBe('prompt')
    expect(mod.default.description).toContain('identity')
  })

  test('plain /whoru builds a concise identity prompt for configured bots', async () => {
    process.env.MYA_BOT_NAME = 'Ops Bot'
    process.env.MYA_BOT_ROLE = 'operator'
    process.env.MYA_BOT_PURPOSE = 'Keep the production environment healthy.'
    process.env.MYA_BOT_OWNER_ADDRESS = '主人'
    process.env.MYA_BOT_DEFAULT_LANGUAGE = '中文'
    process.env.MYA_BOT_INSTRUCTIONS_PATH = '/tmp/ops-bot/BOT.md'

    const mod = await import('./whoru.js')
    const result = await mod.default.getPromptForCommand('', {
      getAppState: () => ({
        toolPermissionContext: {
          mode: 'plan',
        },
      }),
    })

    expect(result[0]?.type).toBe('text')
    expect(result[0]?.text).toContain('Reply in first person as that bot')
    expect(result[0]?.text).toContain('Ops Bot')
    expect(result[0]?.text).toContain('Role: operator')
    expect(result[0]?.text).toContain('Owner address: 主人')
    expect(result[0]?.text).toContain('Default language: 中文')
    expect(result[0]?.text).toContain('Permission mode: plan')
    expect(result[0]?.text).toContain('BOT.md path is present')
  })

  test('bootstrap /whoru asks follow-up questions for a newly created bot', async () => {
    process.env.MYA_ACTIVE_BOT_ID = 'review-bot'
    process.env.MYA_BOT_NAME = 'Review Bot'
    process.env.MYA_ACTIVE_BOT_INSTRUCTIONS_PATH = '/tmp/review-bot/BOT.md'
    process.env.MYA_ACTIVE_BOT_BOOTSTRAP = '1'

    const mod = await import('./whoru.js')
    const result = await mod.default.getPromptForCommand('', {
      getAppState: () => ({
        toolPermissionContext: {
          mode: 'default',
        },
      }),
    })

    expect(result[0]?.type).toBe('text')
    expect(result[0]?.text).toContain('newly created bot')
    expect(result[0]?.text).toContain('ask at most 3 concise follow-up questions')
    expect(result[0]?.text).toContain('how to address the owner')
    expect(result[0]?.text).toContain('default language is Chinese')
    expect(result[0]?.text).toContain('edit it directly for durable bot instructions')
    expect(result[0]?.text).toContain('set identity.status to "configured"')
    expect(result[0]?.text).toContain('Review Bot')
  })

  test('structured /whoru set writes bot identity before replying', async () => {
    const homeDir = path.join(os.tmpdir(), `mya-whoru-save-${Date.now()}`)
    const profileDir = path.join(
      homeDir,
      '.mya',
      'connect',
      'hub',
      'profiles',
      'review-bot',
    )
    const profilePath = path.join(profileDir, 'profile.json')
    const instructionsPath = path.join(profileDir, 'BOT.md')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(
      profilePath,
      JSON.stringify(
        {
          profileId: 'review-bot',
          name: 'Review Bot',
          identity: {
            status: 'bootstrap',
          },
          defaultWorkspaceRoot: '/workspace/repo',
          workspaceAllowlist: ['/workspace/repo'],
          channels: [],
        },
        null,
        2,
      ),
      'utf8',
    )
    writeFileSync(
      instructionsPath,
      '# Review Bot\n\n## Identity\n- Role:\n- Purpose:\n- Style:\n',
      'utf8',
    )

    process.env.HOME = homeDir
    process.env.MYA_ACTIVE_BOT_ID = 'review-bot'
    process.env.MYA_ACTIVE_BOT_PROFILE_PATH = profilePath
    process.env.MYA_ACTIVE_BOT_INSTRUCTIONS_PATH = instructionsPath
    process.env.MYA_ACTIVE_BOT_BOOTSTRAP = '1'

    const mod = await import('./whoru.js')
    const result = await mod.default.getPromptForCommand(
      'set role="reviewer" purpose="Review risky PRs" style="brief and direct" owner="主人" language="中文"',
      {
        getAppState: () => ({
          toolPermissionContext: {
            mode: 'default',
          },
        }),
      },
    )

    const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
    const instructions = readFileSync(instructionsPath, 'utf8')

    expect(profile.identity.status).toBe('configured')
    expect(profile.identity.role).toBe('reviewer')
    expect(profile.identity.purpose).toBe('Review risky PRs')
    expect(profile.identity.style).toBe('brief and direct')
    expect(profile.identity.ownerAddress).toBe('主人')
    expect(profile.identity.language).toBe('中文')
    expect(instructions).toContain('- Role: reviewer')
    expect(instructions).toContain('- Owner address: 主人')
    expect(instructions).toContain('- Default language: 中文')
    expect(result[0]?.text).toContain('structured bot identity update has already been saved')
    expect(result[0]?.text).toContain('Saved update:')

    rmSync(homeDir, { recursive: true, force: true })
  })
})
