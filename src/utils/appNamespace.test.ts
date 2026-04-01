import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  ensureLegacyFileMigrated,
  ensureLegacyProjectConfigMigrated,
  ensureLegacyTreeMigrated,
  PRIMARY_CONFIG_DIR_NAME,
  PRIMARY_GLOBAL_CONFIG_FILE_NAME,
} from './appNamespace.js'
import {
  getGlobalSkillsDirDisplayPath,
  getProjectSkillsDirDisplayPath,
} from './appBranding.js'

const tempPaths: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-agent-namespace-'))
  tempPaths.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempPaths.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('app namespace migration', () => {
  test('copies the legacy home config tree into the my_agent namespace once', () => {
    const homeDir = makeTempDir()
    const legacyDir = join(homeDir, '.claude')
    const targetDir = join(homeDir, PRIMARY_CONFIG_DIR_NAME)

    mkdirSync(join(legacyDir, 'skills'), { recursive: true })
    writeFileSync(join(legacyDir, 'settings.json'), '{"env":{"FOO":"bar"}}')
    writeFileSync(join(legacyDir, 'skills', 'demo.md'), '# demo')

    ensureLegacyTreeMigrated(targetDir, legacyDir)

    expect(readFileSync(join(targetDir, 'settings.json'), 'utf8')).toContain(
      '"FOO":"bar"',
    )
    expect(readFileSync(join(targetDir, 'skills', 'demo.md'), 'utf8')).toBe(
      '# demo',
    )
  })

  test('copies the legacy global config file into the my_agent namespace once', () => {
    const homeDir = makeTempDir()
    const legacyFile = join(homeDir, '.claude.json')
    const targetFile = join(homeDir, PRIMARY_GLOBAL_CONFIG_FILE_NAME)

    writeFileSync(legacyFile, '{"theme":"dark"}')

    ensureLegacyFileMigrated(targetFile, legacyFile)

    expect(readFileSync(targetFile, 'utf8')).toContain('"theme":"dark"')
  })

  test('copies the project .claude directory into .my_agent when needed', () => {
    const projectDir = makeTempDir()
    const legacyProjectDir = join(projectDir, '.claude')
    const targetProjectDir = join(projectDir, PRIMARY_CONFIG_DIR_NAME)

    mkdirSync(legacyProjectDir, { recursive: true })
    writeFileSync(join(legacyProjectDir, 'settings.local.json'), '{"debug":true}')

    const migratedDir = ensureLegacyProjectConfigMigrated(projectDir)

    expect(migratedDir).toBe(targetProjectDir)
    expect(
      readFileSync(join(targetProjectDir, 'settings.local.json'), 'utf8'),
    ).toContain('"debug":true')
  })

  test('uses the my_agent namespace for user-facing skill paths', () => {
    expect(getProjectSkillsDirDisplayPath()).toBe('.my_agent/skills/')
    expect(getGlobalSkillsDirDisplayPath()).toBe('~/.my_agent/skills/')
  })
})
