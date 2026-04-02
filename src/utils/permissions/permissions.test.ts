import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

import { hasPermissionsToUseTool } from './permissions.js'

function createTool(permissionMode: 'default' | 'bypassPermissions' | 'plan') {
  return {
    name: 'Edit',
    inputSchema: z.object({
      path: z.string(),
    }),
    checkPermissions: async () => ({
      behavior: 'ask' as const,
      message: 'Protected path requires confirmation',
      decisionReason: {
        type: 'safetyCheck' as const,
        reason: 'Protected path requires confirmation',
        classifierApprovable: false,
      },
    }),
    requiresUserInteraction: () => false,
  } as any
}

function createContext(
  permissionMode: 'default' | 'bypassPermissions' | 'plan',
  isBypassPermissionsModeAvailable = false,
) {
  return {
    abortController: new AbortController(),
    getAppState: () =>
      ({
        toolPermissionContext: {
          mode: permissionMode,
          additionalWorkingDirectories: new Map(),
          alwaysAllowRules: {},
          alwaysDenyRules: {},
          alwaysAskRules: {},
          isBypassPermissionsModeAvailable,
        },
      }) as any,
  } as any
}

describe('dangerously-skip-permissions safety checks', () => {
  test('still asks for safety checks in default mode', async () => {
    const decision = await hasPermissionsToUseTool(
      createTool('default'),
      { path: '/tmp/protected.txt' },
      createContext('default'),
      {} as any,
      'tool-use-default',
    )

    expect(decision.behavior).toBe('ask')
    expect(decision.decisionReason?.type).toBe('safetyCheck')
  })

  test('allows safety checks in bypassPermissions mode', async () => {
    const decision = await hasPermissionsToUseTool(
      createTool('bypassPermissions'),
      { path: '/tmp/protected.txt' },
      createContext('bypassPermissions', true),
      {} as any,
      'tool-use-bypass',
    )

    expect(decision.behavior).toBe('allow')
    expect(decision.decisionReason?.type).toBe('mode')
  })

  test('allows safety checks in plan mode when bypass is available', async () => {
    const decision = await hasPermissionsToUseTool(
      createTool('plan'),
      { path: '/tmp/protected.txt' },
      createContext('plan', true),
      {} as any,
      'tool-use-plan-bypass',
    )

    expect(decision.behavior).toBe('allow')
    expect(decision.decisionReason?.type).toBe('mode')
  })
})
