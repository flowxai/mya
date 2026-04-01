import { describe, expect, test } from 'bun:test'

type StoredCompanion = {
  name: string
  personality: string
  hatchedAt: number
  speciesOverride?: string
  rarityOverride?: string
}

const EXISTING_COMPANION: StoredCompanion = {
  name: 'Nib',
  personality: 'curious, loyal, and mildly chaotic',
  hatchedAt: 111,
}

describe('buddy command', () => {
  test('descriptor exposes /buddy as a local command', async () => {
    const mod = await import('./index.js')

    expect(mod.default.name).toBe('buddy')
    expect(mod.default.type).toBe('local')
    expect(mod.default.description).toContain('companion')
  })

  test('plain /buddy hatches a companion when none exists', async () => {
    const { runBuddyAction } = await import('./buddy.js')

    const result = runBuddyAction('', {
      storedCompanion: undefined,
      companionMuted: false,
      userId: 'user-1',
      now: 1234,
    })

    expect(result.kind).toBe('hatched')
    expect(result.nextCompanion).toBeDefined()
    expect(result.nextCompanion?.name.length).toBeGreaterThan(0)
    expect(result.nextCompanion?.personality.length).toBeGreaterThan(0)
    expect(result.nextCompanion?.hatchedAt).toBe(1234)
    expect(result.petAt).toBeUndefined()
    expect(result.message).toContain('hatched')
  })

  test('plain /buddy pets an existing companion', async () => {
    const { runBuddyAction } = await import('./buddy.js')

    const result = runBuddyAction('', {
      storedCompanion: EXISTING_COMPANION,
      companionMuted: false,
      userId: 'user-1',
      now: 5678,
    })

    expect(result.kind).toBe('petted')
    expect(result.nextCompanion).toEqual(EXISTING_COMPANION)
    expect(result.petAt).toBe(5678)
    expect(result.message).toContain('Nib')
  })

  test('mute and unmute flip the mute state without replacing the companion', async () => {
    const { runBuddyAction } = await import('./buddy.js')

    const muted = runBuddyAction('mute', {
      storedCompanion: EXISTING_COMPANION,
      companionMuted: false,
      userId: 'user-1',
      now: 5678,
    })

    expect(muted.kind).toBe('muted')
    expect(muted.nextMuted).toBe(true)
    expect(muted.nextCompanion).toEqual(EXISTING_COMPANION)

    const unmuted = runBuddyAction('unmute', {
      storedCompanion: EXISTING_COMPANION,
      companionMuted: true,
      userId: 'user-1',
      now: 5678,
    })

    expect(unmuted.kind).toBe('unmuted')
    expect(unmuted.nextMuted).toBe(false)
    expect(unmuted.nextCompanion).toEqual(EXISTING_COMPANION)
  })

  test('status reports the active companion summary', async () => {
    const { runBuddyAction } = await import('./buddy.js')

    const result = runBuddyAction('status', {
      storedCompanion: EXISTING_COMPANION,
      companionMuted: false,
      userId: 'user-1',
      now: 5678,
    })

    expect(result.kind).toBe('status')
    expect(result.message).toContain('Nib')
    expect(result.message).toContain('Species:')
    expect(result.message).toContain('Rarity:')
    expect(result.message).toContain('Personality:')
  })

  test('reset releases the current companion and clears mute state', async () => {
    const { runBuddyAction } = await import('./buddy.js')

    const result = runBuddyAction('reset', {
      storedCompanion: EXISTING_COMPANION,
      companionMuted: true,
      userId: 'user-1',
      now: 5678,
    })

    expect(result.kind).toBe('reset')
    expect(result.nextCompanion).toBeUndefined()
    expect(result.nextMuted).toBe(false)
    expect(result.message).toContain('Released')
  })

  test('adopting a species rehatches with an explicit species override', async () => {
    const { runBuddyAction } = await import('./buddy.js')

    const result = runBuddyAction('adopt cat', {
      storedCompanion: EXISTING_COMPANION,
      companionMuted: false,
      userId: 'user-1',
      now: 6789,
    })

    expect(result.kind).toBe('hatched')
    expect(result.nextCompanion).toBeDefined()
    expect(result.nextCompanion?.hatchedAt).toBe(6789)
    expect(result.nextCompanion?.speciesOverride).toBe('cat')
    expect(result.message).toContain('Species: cat')
  })

  test('rarity command stores an explicit rarity override', async () => {
    const { runBuddyAction } = await import('./buddy.js')

    const result = runBuddyAction('rarity legendary', {
      storedCompanion: EXISTING_COMPANION,
      companionMuted: false,
      userId: 'user-1',
      now: 6789,
    })

    expect(result.kind).toBe('rarity')
    expect(result.nextCompanion).toBeDefined()
    expect(result.nextCompanion?.rarityOverride).toBe('legendary')
    expect(result.message).toContain('legendary')
    expect(result.message).toContain('★★★★★')
  })

  test('status reflects an explicit rarity override', async () => {
    const { runBuddyAction } = await import('./buddy.js')

    const result = runBuddyAction('status', {
      storedCompanion: {
        ...EXISTING_COMPANION,
        rarityOverride: 'legendary',
      },
      companionMuted: false,
      userId: 'user-1',
      now: 5678,
    })

    expect(result.kind).toBe('status')
    expect(result.message).toContain('Rarity: legendary ★★★★★')
  })
})
