import { describe, expect, test } from 'bun:test'
import { getCoordinatorSystemPrompt } from '../coordinator/coordinatorMode.js'
import { DEFAULT_AGENT_PROMPT } from './prompts.js'
import { getCLISyspromptPrefix } from './system.js'

describe('mya branding in core prompts', () => {
  test('replaces the main assistant identity', () => {
    const interactivePrefix = getCLISyspromptPrefix({
      isNonInteractive: false,
      hasAppendSystemPrompt: false,
    })

    expect(interactivePrefix).toContain('You are mya')
    expect(interactivePrefix).not.toContain('Claude Code')
    expect(interactivePrefix).not.toContain('Anthropic API')
  })

  test('replaces agent and coordinator identities', () => {
    expect(DEFAULT_AGENT_PROMPT).toContain('agent for mya')
    expect(DEFAULT_AGENT_PROMPT).not.toContain('Claude Code')
    expect(DEFAULT_AGENT_PROMPT).not.toContain('Anthropic API')

    const coordinatorPrompt = getCoordinatorSystemPrompt()
    expect(coordinatorPrompt).toContain('You are mya')
    expect(coordinatorPrompt).not.toContain('Claude Code')
  })
})
