import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getClientType,
  getIsInteractive,
  preferThirdPartyAuthentication,
  setClientType,
  setIsInteractive,
} from './state.js'

describe('preferThirdPartyAuthentication', () => {
  let originalIsInteractive: boolean
  let originalClientType: string
  let originalBaseUrl: string | undefined

  beforeEach(() => {
    originalIsInteractive = getIsInteractive()
    originalClientType = getClientType()
    originalBaseUrl = process.env.ANTHROPIC_BASE_URL
    delete process.env.ANTHROPIC_BASE_URL
    setClientType('')
  })

  afterEach(() => {
    setIsInteractive(originalIsInteractive)
    setClientType(originalClientType)
    if (originalBaseUrl === undefined) {
      delete process.env.ANTHROPIC_BASE_URL
    } else {
      process.env.ANTHROPIC_BASE_URL = originalBaseUrl
    }
  })

  test('returns true for non-interactive sessions regardless of base URL', () => {
    setIsInteractive(false)
    expect(preferThirdPartyAuthentication()).toBe(true)
  })

  test('returns false for VS Code clients even in non-interactive mode', () => {
    setIsInteractive(false)
    setClientType('claude-vscode')
    expect(preferThirdPartyAuthentication()).toBe(false)
  })

  test('returns false for interactive sessions without ANTHROPIC_BASE_URL', () => {
    setIsInteractive(true)
    expect(preferThirdPartyAuthentication()).toBe(false)
  })

  test('returns true for interactive sessions when ANTHROPIC_BASE_URL is set', () => {
    setIsInteractive(true)
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com'
    expect(preferThirdPartyAuthentication()).toBe(true)
  })

  test('returns false for interactive VS Code even with ANTHROPIC_BASE_URL set', () => {
    setIsInteractive(true)
    setClientType('claude-vscode')
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com'
    expect(preferThirdPartyAuthentication()).toBe(false)
  })

  test('returns false for interactive sessions with empty-string ANTHROPIC_BASE_URL', () => {
    // Empty string is falsy in the truthiness check, so setting it to "" must
    // not accidentally enable third-party auth — we only want an explicit value.
    setIsInteractive(true)
    process.env.ANTHROPIC_BASE_URL = ''
    expect(preferThirdPartyAuthentication()).toBe(false)
  })
})
