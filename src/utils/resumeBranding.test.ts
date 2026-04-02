import { afterEach, describe, expect, test } from 'bun:test'
import { setOriginalCwd } from '../bootstrap/state.js'
import type { LogOption } from '../types/logs.js'
import { checkCrossProjectResume } from './crossProjectResume.js'

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_CWD = process.cwd()

afterEach(() => {
  setOriginalCwd(ORIGINAL_CWD)

  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('resume command branding', () => {
  test('cross-project resume commands use mya instead of claude', () => {
    setOriginalCwd('/workspace/current')
    process.env.USER_TYPE = 'external'

    const result = checkCrossProjectResume(
      {
        sessionId: '1bed24bf-6a35-4595-b333-5beb234cc201',
        projectPath: '/workspace/other',
      } as LogOption,
      true,
      [],
    )

    expect(result).toMatchObject({
      isCrossProject: true,
      isSameRepoWorktree: false,
      command:
        'cd /workspace/other && mya --resume 1bed24bf-6a35-4595-b333-5beb234cc201',
    })
  })

  test('graceful shutdown exports a mya-branded resume hint helper', async () => {
    const gracefulShutdownModule = (await import('./gracefulShutdown.js')) as {
      buildResumeHintText?: (resumeArg: string) => string
    }

    expect(typeof gracefulShutdownModule.buildResumeHintText).toBe('function')
    expect(gracefulShutdownModule.buildResumeHintText?.('session-title')).toBe(
      '\nResume this session with:\nmya --resume session-title\n',
    )
  })
})
