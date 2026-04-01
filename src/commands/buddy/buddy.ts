import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import {
  companionUserId,
  roll,
  rollWithSeed,
} from '../../buddy/companion.js'
import { renderFace } from '../../buddy/sprites.js'
import {
  RARITIES,
  RARITY_STARS,
  SPECIES,
  STAT_NAMES,
  type Companion,
  type Rarity,
  type StatName,
  type Species,
  type StoredCompanion,
} from '../../buddy/types.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

type BuddyActionName =
  | 'hatched'
  | 'petted'
  | 'status'
  | 'muted'
  | 'unmuted'
  | 'reset'
  | 'rarity'
  | 'help'

type BuddyInput = {
  storedCompanion: StoredCompanion | undefined
  companionMuted: boolean
  userId: string
  now: number
}

type BuddyResult = {
  kind: BuddyActionName
  nextCompanion: StoredCompanion | undefined
  nextMuted: boolean
  petAt?: number
  message: string
}

const NAME_OPENERS = [
  'Pi',
  'Ki',
  'Mo',
  'Lu',
  'Ta',
  'Ni',
  'Ro',
  'Su',
  'Ka',
  'Mi',
  'To',
  'Be',
] as const

const NAME_ENDINGS = [
  'ka',
  'chu',
  'mi',
  'ra',
  'bo',
  'li',
  'ta',
  'zu',
  'rin',
  'no',
  'po',
  'fi',
] as const

const TRAITS_A = [
  'curious',
  'loyal',
  'sleepy',
  'brave',
  'cheerful',
  'sharp-eyed',
  'restless',
  'snarky',
  'gentle',
  'eager',
] as const

const TRAITS_B = [
  'snack-motivated',
  'terminal-obsessed',
  'mildly chaotic',
  'surprisingly patient',
  'dramatic about tiny errors',
  'always watching the cursor',
  'weirdly proud of clean diffs',
  'quiet until it spots a bug',
  'soft-hearted',
  'suspicious of flaky tests',
] as const

const RARITY_FLAVOR: Record<Rarity, string> = {
  common: 'It is happiest when you make small steady progress.',
  uncommon: 'It likes showing off one good trick at exactly the right time.',
  rare: 'It acts like it already knows where the bug is hiding.',
  epic: 'It carries unmistakable main-character energy.',
  legendary: 'It treats every prompt like a prophecy.',
}

const STAT_FLAVOR: Record<StatName, string> = {
  DEBUGGING: 'It loves poking at broken things until they make sense.',
  PATIENCE: 'It can sit with a stubborn problem longer than you expect.',
  CHAOS: 'It enjoys a little bit of reckless improvisation.',
  WISDOM: 'It notices patterns before most people do.',
  SNARK: 'It communicates in a level of sass just shy of insubordination.',
}

function pickFromSeed<T>(seed: number, values: readonly T[], offset = 0): T {
  const index = Math.abs(seed + offset) % values.length
  return values[index]!
}

function getTopStat(stats: Record<StatName, number>): StatName {
  let best = STAT_NAMES[0]!
  for (const stat of STAT_NAMES.slice(1)) {
    if (stats[stat] > stats[best]) {
      best = stat
    }
  }
  return best
}

function createStoredCompanion(
  userId: string,
  now: number,
  overrides: {
    speciesOverride?: Species
    rarityOverride?: Rarity
  } = {},
): StoredCompanion {
  const { bones } = roll(userId)
  const soulSeedParts = [userId, 'buddy-soul']
  if (overrides.speciesOverride) soulSeedParts.push(overrides.speciesOverride)
  if (overrides.rarityOverride) soulSeedParts.push(overrides.rarityOverride)
  const soulSeed = soulSeedParts.join(':')
  const seed = rollWithSeed(soulSeed).inspirationSeed
  const rarity = overrides.rarityOverride ?? bones.rarity
  const topStat = getTopStat(bones.stats)
  const personality = `${pickFromSeed(seed, TRAITS_A, 5)}, ${pickFromSeed(seed, TRAITS_B, 9)}, and tuned for ${topStat.toLowerCase()}. ${STAT_FLAVOR[topStat]} ${RARITY_FLAVOR[rarity]}`

  return {
    name: pickFromSeed(seed, NAME_OPENERS) + pickFromSeed(seed, NAME_ENDINGS, 3),
    personality,
    hatchedAt: now,
    speciesOverride: overrides.speciesOverride,
    rarityOverride: overrides.rarityOverride,
  }
}

function materializeCompanion(
  storedCompanion: StoredCompanion,
  userId: string,
): Companion {
  const { bones } = roll(userId)
  return {
    ...storedCompanion,
    ...bones,
    rarity: storedCompanion.rarityOverride ?? bones.rarity,
    species: storedCompanion.speciesOverride ?? bones.species,
  }
}

function formatStats(companion: Companion): string {
  return STAT_NAMES.map(
    stat => `${stat} ${String(companion.stats[stat]).padStart(2, ' ')}`,
  ).join(' · ')
}

function formatCompanionStatus(
  companion: Companion,
  companionMuted: boolean,
): string {
  const mutedLine = companionMuted ? '\nMuted: yes' : ''
  const hatLine = companion.hat === 'none' ? 'none' : companion.hat
  const shinyLine = companion.shiny ? '\nShiny: yes' : ''

  return [
    `Companion: ${companion.name} ${renderFace(companion)}`,
    `Species: ${companion.species}`,
    `Rarity: ${companion.rarity} ${RARITY_STARS[companion.rarity]}`,
    `Hat: ${hatLine}${shinyLine}${mutedLine}`,
    `Personality: ${companion.personality}`,
    `Stats: ${formatStats(companion)}`,
  ].join('\n')
}

function helpMessage(): string {
  const speciesList = SPECIES.join(', ')
  const rarityList = RARITIES.join(', ')
  return [
    'Usage: /buddy [status|mute|unmute|reset|species|rarity|help]',
    '   or: /buddy adopt <species>',
    '   or: /buddy hatch <species>',
    '   or: /buddy rarity <rarity>',
    '',
    '/buddy         Hatch your companion if needed, otherwise pet it',
    '/buddy pet     Pet the current companion',
    '/buddy status  Show your companion summary',
    '/buddy mute    Hide the companion from the prompt area',
    '/buddy unmute  Show the companion again',
    '/buddy reset   Release the current companion and start over',
    '/buddy species List the supported species',
    `/buddy rarity  Choose from: ${rarityList}`,
    `/buddy adopt   Choose from: ${speciesList}`,
  ].join('\n')
}

function normalizeAction(args: string): string {
  return args.trim().toLowerCase()
}

function parseSpeciesAction(
  action: string,
): { kind: 'adopt'; species?: Species; invalid?: string } | null {
  const [verb, ...rest] = action.split(/\s+/).filter(Boolean)
  if (!verb || !['adopt', 'hatch', 'choose', 'select'].includes(verb)) {
    return null
  }

  const rawSpecies = rest.join(' ').trim()
  if (!rawSpecies) {
    return { kind: 'adopt' }
  }

  if (SPECIES.includes(rawSpecies as Species)) {
    return { kind: 'adopt', species: rawSpecies as Species }
  }

  return { kind: 'adopt', invalid: rawSpecies }
}

function speciesMessage(): string {
  return `Supported species: ${SPECIES.join(', ')}`
}

function rarityMessage(): string {
  return `Supported rarities: ${RARITIES.join(', ')}`
}

function parseRarityAction(
  action: string,
): { rarity?: Rarity; invalid?: string } | null {
  const [verb, ...rest] = action.split(/\s+/).filter(Boolean)
  if (verb !== 'rarity') {
    return null
  }

  const rawRarity = rest.join(' ').trim()
  if (!rawRarity) {
    return {}
  }

  if (RARITIES.includes(rawRarity as Rarity)) {
    return { rarity: rawRarity as Rarity }
  }

  return { invalid: rawRarity }
}

export function runBuddyAction(args: string, input: BuddyInput): BuddyResult {
  const action = normalizeAction(args)
  const parsedSpeciesAction = parseSpeciesAction(action)
  const parsedRarityAction = parseRarityAction(action)

  if (action === 'help') {
    return {
      kind: 'help',
      nextCompanion: input.storedCompanion,
      nextMuted: input.companionMuted,
      message: helpMessage(),
    }
  }

  if (action === 'species' || action === 'list') {
    return {
      kind: 'help',
      nextCompanion: input.storedCompanion,
      nextMuted: input.companionMuted,
      message: speciesMessage(),
    }
  }

  if (parsedRarityAction) {
    if (parsedRarityAction.invalid) {
      return {
        kind: 'help',
        nextCompanion: input.storedCompanion,
        nextMuted: input.companionMuted,
        message: `Unknown rarity: ${parsedRarityAction.invalid}\n\n${rarityMessage()}`,
      }
    }

    if (!parsedRarityAction.rarity) {
      return {
        kind: 'help',
        nextCompanion: input.storedCompanion,
        nextMuted: input.companionMuted,
        message: `Choose a rarity with /buddy rarity <rarity>\n\n${rarityMessage()}`,
      }
    }

    if (!input.storedCompanion) {
      return {
        kind: 'help',
        nextCompanion: undefined,
        nextMuted: input.companionMuted,
        message: `No companion hatched yet.\n\nRun /buddy to hatch one first.`,
      }
    }

    const nextCompanion = {
      ...input.storedCompanion,
      rarityOverride: parsedRarityAction.rarity,
    }
    const fullCompanion = materializeCompanion(nextCompanion, input.userId)

    return {
      kind: 'rarity',
      nextCompanion,
      nextMuted: input.companionMuted,
      message:
        `Set ${fullCompanion.name} to ${parsedRarityAction.rarity} ${RARITY_STARS[parsedRarityAction.rarity]}.\n\n` +
        formatCompanionStatus(fullCompanion, input.companionMuted),
    }
  }

  if (parsedSpeciesAction) {
    if (parsedSpeciesAction.invalid) {
      return {
        kind: 'help',
        nextCompanion: input.storedCompanion,
        nextMuted: input.companionMuted,
        message: `Unknown species: ${parsedSpeciesAction.invalid}\n\n${speciesMessage()}`,
      }
    }

    if (!parsedSpeciesAction.species) {
      return {
        kind: 'help',
        nextCompanion: input.storedCompanion,
        nextMuted: input.companionMuted,
        message: `Choose a species with /buddy adopt <species>\n\n${speciesMessage()}`,
      }
    }

    const nextCompanion = createStoredCompanion(
      input.userId,
      input.now,
      {
        speciesOverride: parsedSpeciesAction.species,
        rarityOverride: input.storedCompanion?.rarityOverride,
      },
    )
    const fullCompanion = materializeCompanion(nextCompanion, input.userId)

    return {
      kind: 'hatched',
      nextCompanion,
      nextMuted: false,
      message:
        `Your companion rehatches as ${parsedSpeciesAction.species}.\n\n${formatCompanionStatus(fullCompanion, false)}\n\n` +
        'Run /buddy to pet it, /buddy status to inspect it, or /buddy reset to choose again.',
    }
  }

  if (!input.storedCompanion) {
    if (
      action === 'mute' ||
      action === 'unmute' ||
      action === 'status' ||
      action === 'reset'
    ) {
      return {
        kind: 'help',
        nextCompanion: undefined,
        nextMuted: input.companionMuted,
        message: `No companion hatched yet.\n\nRun /buddy to hatch one.`,
      }
    }

    const nextCompanion = createStoredCompanion(input.userId, input.now)
    const fullCompanion = materializeCompanion(nextCompanion, input.userId)

    return {
      kind: 'hatched',
      nextCompanion,
      nextMuted: false,
      message:
        `Your companion hatched.\n\n${formatCompanionStatus(fullCompanion, false)}\n\n` +
        'Run /buddy to pet it, /buddy status to inspect it, or /buddy mute to hide it.',
    }
  }

  const fullCompanion = materializeCompanion(input.storedCompanion, input.userId)

  if (action === 'reset' || action === 'release' || action === 'rehatch') {
    return {
      kind: 'reset',
      nextCompanion: undefined,
      nextMuted: false,
      message: `Released ${fullCompanion.name}.\n\nRun /buddy to hatch again, or /buddy adopt <species> to choose one yourself.`,
    }
  }

  if (action === '' || action === 'pet') {
    return {
      kind: 'petted',
      nextCompanion: input.storedCompanion,
      nextMuted: input.companionMuted,
      petAt: input.now,
      message: `You pet ${fullCompanion.name}. ${renderFace(fullCompanion)} settles in beside the prompt.`,
    }
  }

  if (action === 'status' || action === 'show' || action === 'info') {
    return {
      kind: 'status',
      nextCompanion: input.storedCompanion,
      nextMuted: input.companionMuted,
      message: formatCompanionStatus(fullCompanion, input.companionMuted),
    }
  }

  if (action === 'mute') {
    return {
      kind: 'muted',
      nextCompanion: input.storedCompanion,
      nextMuted: true,
      message: `Muted ${fullCompanion.name}. Run /buddy unmute to bring the companion back.`,
    }
  }

  if (action === 'unmute') {
    return {
      kind: 'unmuted',
      nextCompanion: input.storedCompanion,
      nextMuted: false,
      message: `Unmuted ${fullCompanion.name}.`,
    }
  }

  return {
    kind: 'help',
    nextCompanion: input.storedCompanion,
    nextMuted: input.companionMuted,
    message: helpMessage(),
  }
}

export const call: LocalCommandCall = async (
  args,
  context,
): Promise<LocalCommandResult> => {
  const config = getGlobalConfig()
  const result = runBuddyAction(args, {
    storedCompanion: config.companion,
    companionMuted: config.companionMuted ?? false,
    userId: companionUserId(),
    now: Date.now(),
  })

  const currentMuted = config.companionMuted ?? false
  const companionChanged = result.nextCompanion !== config.companion
  const mutedChanged = result.nextMuted !== currentMuted

  if (companionChanged || mutedChanged) {
    saveGlobalConfig(current => ({
      ...current,
      companion: result.nextCompanion,
      companionMuted: result.nextMuted ? true : undefined,
    }))
  }

  if (result.petAt !== undefined) {
    context.setAppState(prev => ({
      ...prev,
      companionPetAt: result.petAt,
    }))
  }

  return {
    type: 'text',
    value: result.message,
  }
}
