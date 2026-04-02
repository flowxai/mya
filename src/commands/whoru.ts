import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { Command } from '../commands.js'
import { formatBotIdentity, resolveBotIdentity } from '../utils/botIdentity.js'
import {
  applyBotIdentityUpdate,
  parseBotIdentityUpdateArgs,
} from '../utils/botIdentityPersistence.js'
import { getCwd } from '../utils/cwd.js'

function buildWhoruPrompt(
  identityText: string,
  isBootstrap: boolean,
  args: string,
  savedSummary?: string,
) {
  const normalizedArgs = args.trim()

  if (savedSummary) {
    return [
      'You are answering /whoru after a structured bot identity update has already been saved.',
      'Reply in first person as the updated bot.',
      'Keep it concise and concrete.',
      'Briefly confirm the saved identity update in one short sentence, then introduce yourself using the updated name, role, purpose, style, how you address the owner, default language, workspace, and BOT.md guidance.',
      '',
      `Saved update: ${savedSummary}`,
      '',
      'Identity snapshot:',
      identityText,
      '',
      `User args: ${normalizedArgs || '(none)'}`,
    ].join('\n')
  }

  if (isBootstrap) {
    return [
      'You are answering /whoru for a newly created bot.',
      'Start by briefly introducing the bot using the identity snapshot below.',
      'Then ask at most 3 concise follow-up questions to define the bot display name, role, purpose, working style, and how to address the owner, but only for fields that are still missing.',
      'The default language is Chinese unless the user explicitly wants another language.',
      'If BOT.md exists in the identity snapshot, mention that the user can edit it directly for durable bot instructions.',
      'If the user already supplied identity hints in the command args, incorporate them instead of re-asking.',
      'If the user args already provide enough concrete identity details, do not ask more questions. Update profilePath and BOT.md in this turn and then confirm the saved identity.',
      'When updating profilePath, set identity.status to "configured" and fill identity.role, identity.purpose, identity.style, identity.ownerAddress, and identity.language when known.',
      'When updating BOT.md, keep the content concise, durable, and aligned with the saved bot identity, including owner address and default language.',
      'Keep the reply short and product-like.',
      '',
      'Identity snapshot:',
      identityText,
      '',
      `User args: ${normalizedArgs || '(none)'}`,
    ].join('\n')
  }

  return [
    'You are answering /whoru for an active bot.',
    'Reply in first person as that bot.',
    'Briefly explain who you are, what you are for, how you address the owner, your default language, your workspace, and any relevant operating constraints.',
    'If a BOT.md path is present, treat those instructions as durable bot guidance and align your introduction with them.',
    'If the user is clearly refining your bot identity or long-term working style, update profilePath and BOT.md before replying.',
    'Keep the reply concise and concrete.',
    '',
    'Identity snapshot:',
    identityText,
    '',
    `User args: ${normalizedArgs || '(none)'}`,
  ].join('\n')
}

const whoru: Command = {
  type: 'prompt',
  name: 'whoru',
  description: 'Introduce the active bot identity for this session',
  progressMessage: 'checking bot identity',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand(args, context): Promise<ContentBlockParam[]> {
    const initialIdentity = await resolveBotIdentity({
      cwd: getCwd(),
      permissionMode: context.getAppState().toolPermissionContext.mode,
    })
    const update = parseBotIdentityUpdateArgs(args)
    let savedSummary = ''

    if (update && initialIdentity?.profilePath && initialIdentity?.instructionsPath) {
      const saved = await applyBotIdentityUpdate(initialIdentity, update)
      savedSummary = saved.summary
    }

    const identity = savedSummary
      ? await resolveBotIdentity({
          cwd: getCwd(),
          permissionMode: context.getAppState().toolPermissionContext.mode,
        })
      : initialIdentity

    const identityText = formatBotIdentity(identity)
    return [
      {
        type: 'text',
        text: buildWhoruPrompt(
          identityText,
          Boolean(identity?.bootstrap),
          args,
          savedSummary || undefined,
        ),
      },
    ]
  },
}

export default whoru
