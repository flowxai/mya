import { describe, expect, test } from 'bun:test'
import { PERMISSION_MODES } from './PermissionMode.js'
import { resolveConfiguredDefaultPermissionMode } from './permissionSetup.js'

describe('configured default permission mode', () => {
  test('uses MYA_DEFAULT_PERMISSION_MODE from env before settings.defaultMode', () => {
    const mode = resolveConfiguredDefaultPermissionMode({
      env: {
        MYA_DEFAULT_PERMISSION_MODE: 'bypassPermissions',
      },
      settings: {
        permissions: {
          defaultMode: 'plan',
        },
      },
    })

    expect(mode).toBe('bypassPermissions')
  })

  test('reads MYA_DEFAULT_PERMISSION_MODE from settings env block', () => {
    const mode = resolveConfiguredDefaultPermissionMode({
      settings: {
        env: {
          MYA_DEFAULT_PERMISSION_MODE: 'auto',
        },
      },
    })

    expect(mode).toBe(
      (PERMISSION_MODES as readonly string[]).includes('auto')
        ? 'auto'
        : undefined,
    )
  })

  test('supports user-facing aliases for bypass and auto mode', () => {
    expect(
      resolveConfiguredDefaultPermissionMode({
        env: {
          MYA_DEFAULT_PERMISSION_MODE: 'dangerously-skip-permissions',
        },
      }),
    ).toBe('bypassPermissions')

    expect(
      resolveConfiguredDefaultPermissionMode({
        env: {
          MYA_DEFAULT_PERMISSION_MODE: 'automode',
        },
      }),
    ).toBe(
      (PERMISSION_MODES as readonly string[]).includes('auto')
        ? 'auto'
        : undefined,
    )
  })

  test('falls back to permissions.defaultMode when no env override is present', () => {
    const mode = resolveConfiguredDefaultPermissionMode({
      settings: {
        permissions: {
          defaultMode: 'plan',
        },
      },
    })

    expect(mode).toBe('plan')
  })
})
