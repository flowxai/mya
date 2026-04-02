import { describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  applyBotIdentityUpdate,
  parseBotIdentityUpdateArgs,
} from './botIdentityPersistence.js'

describe('bot identity persistence', () => {
  test('parses structured /whoru set args', () => {
    expect(
      parseBotIdentityUpdateArgs(
        'set role="review bot" purpose="Review PR risk" style="brief and direct"',
      ),
    ).toEqual({
      role: 'review bot',
      purpose: 'Review PR risk',
      style: 'brief and direct',
    })
  })

  test('returns null when args are not structured updates', () => {
    expect(parseBotIdentityUpdateArgs('who are you')).toBeNull()
  })

  test('writes profile.json and BOT.md for a structured identity update', async () => {
    const root = path.join(os.tmpdir(), `mya-bot-save-${Date.now()}`)
    const profileDir = path.join(root, 'review-bot')
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
      [
        '# Review Bot',
        '',
        '## Identity',
        '- Role:',
        '- Purpose:',
        '- Style:',
        '',
        '## Workspace',
        '- Default workspace: /workspace/repo',
        '',
        '## Operating Rules',
        '- Preferred response style:',
        '- Guardrails / things to avoid:',
        '- Default workflows to follow:',
      ].join('\n'),
      'utf8',
    )

    const result = await applyBotIdentityUpdate(
      {
        profileId: 'review-bot',
        name: 'Review Bot',
        profilePath,
        instructionsPath,
        bootstrap: true,
      },
      {
        role: 'reviewer',
        purpose: 'Review risky pull requests.',
        style: 'brief and direct',
      },
    )

    const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
    const instructions = readFileSync(instructionsPath, 'utf8')

    expect(result.summary).toContain('role=reviewer')
    expect(profile.identity.status).toBe('configured')
    expect(profile.identity.role).toBe('reviewer')
    expect(profile.identity.purpose).toBe('Review risky pull requests.')
    expect(profile.identity.style).toBe('brief and direct')
    expect(instructions).toContain('- Role: reviewer')
    expect(instructions).toContain('- Purpose: Review risky pull requests.')
    expect(instructions).toContain('- Style: brief and direct')
    expect(instructions).toContain(
      '- Preferred response style: brief and direct',
    )

    rmSync(root, { recursive: true, force: true })
  })
})
