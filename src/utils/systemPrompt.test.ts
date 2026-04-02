import { describe, expect, test } from 'bun:test'
import { buildEffectiveSystemPrompt } from './systemPrompt.js'

describe('system prompt bot identity support', () => {
  test('appends bot identity prompt before user append prompt', () => {
    const prompt = buildEffectiveSystemPrompt({
      mainThreadAgentDefinition: undefined,
      toolUseContext: {
        options: {},
      } as never,
      customSystemPrompt: undefined,
      defaultSystemPrompt: ['base prompt'],
      botIdentityPrompt: 'bot prompt',
      appendSystemPrompt: 'user append',
    })

    expect(Array.from(prompt)).toEqual(['base prompt', 'bot prompt', 'user append'])
  })
})
