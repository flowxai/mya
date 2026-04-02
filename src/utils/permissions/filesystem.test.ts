import { afterEach, describe, expect, test } from 'bun:test'

import { checkEditableInternalPath } from './filesystem.js'

const ORIGINAL_ENV = { ...process.env }

describe('bot profile internal write carve-out', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  test('allows writing the active bot profile.json without prompting', () => {
    process.env.MYA_ACTIVE_BOT_PROFILE_PATH = '/tmp/.mya/connect/hub/profiles/review-bot/profile.json'
    process.env.MYA_ACTIVE_BOT_INSTRUCTIONS_PATH = '/tmp/.mya/connect/hub/profiles/review-bot/BOT.md'

    const result = checkEditableInternalPath(
      '/tmp/.mya/connect/hub/profiles/review-bot/profile.json',
      {},
    )

    expect(result.behavior).toBe('allow')
  })

  test('allows writing the active bot BOT.md without prompting', () => {
    process.env.MYA_ACTIVE_BOT_PROFILE_PATH = '/tmp/.mya/connect/hub/profiles/review-bot/profile.json'
    process.env.MYA_ACTIVE_BOT_INSTRUCTIONS_PATH = '/tmp/.mya/connect/hub/profiles/review-bot/BOT.md'

    const result = checkEditableInternalPath(
      '/tmp/.mya/connect/hub/profiles/review-bot/BOT.md',
      {},
    )

    expect(result.behavior).toBe('allow')
  })

  test('does not silently allow unrelated files in the .mya config tree', () => {
    process.env.MYA_ACTIVE_BOT_PROFILE_PATH = '/tmp/.mya/connect/hub/profiles/review-bot/profile.json'
    process.env.MYA_ACTIVE_BOT_INSTRUCTIONS_PATH = '/tmp/.mya/connect/hub/profiles/review-bot/BOT.md'

    const result = checkEditableInternalPath(
      '/tmp/.mya/settings.json',
      {},
    )

    expect(result.behavior).toBe('passthrough')
  })
})
