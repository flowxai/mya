import { cpSync, copyFileSync, existsSync, mkdirSync } from 'fs'
import memoize from 'lodash-es/memoize.js'
import { homedir } from 'os'
import { dirname, join } from 'path'

export const APP_NAMESPACE = 'mya' as const
export const APP_COMMAND_NAME = 'mya' as const
export const PRIMARY_CONFIG_DIR_NAME = '.mya' as const
export const LEGACY_CONFIG_DIR_NAME = '.my_agent' as const
export const LEGACY_CONFIG_DIR_NAMES = ['.my_agent', '.claude'] as const
export const PRIMARY_GLOBAL_CONFIG_FILE_NAME = '.mya.json' as const
export const LEGACY_GLOBAL_CONFIG_FILE_NAME = '.my_agent.json' as const
export const LEGACY_GLOBAL_CONFIG_FILE_NAMES = ['.my_agent.json', '.claude.json'] as const

function normalizeNfc(path: string): string {
  return path.normalize('NFC')
}

function ensureParentDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
}

export function ensureLegacyTreeMigrated(
  targetDir: string,
  legacyDir: string,
): string {
  const normalizedTargetDir = normalizeNfc(targetDir)
  const normalizedLegacyDir = normalizeNfc(legacyDir)

  if (
    existsSync(normalizedTargetDir) ||
    !existsSync(normalizedLegacyDir) ||
    normalizedTargetDir === normalizedLegacyDir
  ) {
    return normalizedTargetDir
  }

  ensureParentDir(normalizedTargetDir)
  cpSync(normalizedLegacyDir, normalizedTargetDir, { recursive: true })
  return normalizedTargetDir
}

export function ensureLegacyFileMigrated(
  targetFile: string,
  legacyFile: string,
): string {
  const normalizedTargetFile = normalizeNfc(targetFile)
  const normalizedLegacyFile = normalizeNfc(legacyFile)

  if (
    existsSync(normalizedTargetFile) ||
    !existsSync(normalizedLegacyFile) ||
    normalizedTargetFile === normalizedLegacyFile
  ) {
    return normalizedTargetFile
  }

  ensureParentDir(normalizedTargetFile)
  copyFileSync(normalizedLegacyFile, normalizedTargetFile)
  return normalizedTargetFile
}

export function getLegacyConfigHomeDirs(baseHomeDir: string = homedir()): string[] {
  return LEGACY_CONFIG_DIR_NAMES.map(dirName => normalizeNfc(join(baseHomeDir, dirName)))
}

export function getPrimaryConfigHomeDir(
  baseHomeDir: string = homedir(),
): string {
  return normalizeNfc(join(baseHomeDir, PRIMARY_CONFIG_DIR_NAME))
}

export function getConfigDirOverride(): string | undefined {
  return process.env.MYA_CONFIG_DIR ?? process.env.MY_AGENT_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR
}

export const getRuntimeConfigHomeDir = memoize(
  (): string => {
    const override = getConfigDirOverride()
    if (override) {
      return normalizeNfc(override)
    }

    const primaryDir = getPrimaryConfigHomeDir()
    for (const legacyDir of getLegacyConfigHomeDirs()) {
      if (existsSync(legacyDir)) {
        return ensureLegacyTreeMigrated(primaryDir, legacyDir)
      }
    }
    return primaryDir
  },
  () =>
    `${process.env.MYA_CONFIG_DIR ?? ''}\u0000${process.env.MY_AGENT_CONFIG_DIR ?? ''}\u0000${process.env.CLAUDE_CONFIG_DIR ?? ''}`,
)

export function getLegacyGlobalConfigFiles(
  baseDir: string = homedir(),
  fileSuffix: string = '',
): string[] {
  return LEGACY_GLOBAL_CONFIG_FILE_NAMES.map(fileName => {
    if (!fileSuffix) {
      return normalizeNfc(join(baseDir, fileName))
    }
    return normalizeNfc(join(baseDir, fileName.replace(/\.json$/, `${fileSuffix}.json`)))
  })
}

export function getPrimaryGlobalConfigFile(
  baseDir: string = homedir(),
  fileSuffix: string = '',
): string {
  return normalizeNfc(join(baseDir, `.mya${fileSuffix}.json`))
}

export function ensureLegacyGlobalConfigMigrated(fileSuffix: string = ''): string {
  const override = getConfigDirOverride()
  const baseDir = override ?? homedir()
  const primaryFile = getPrimaryGlobalConfigFile(baseDir, fileSuffix)
  for (const legacyFile of getLegacyGlobalConfigFiles(baseDir, fileSuffix)) {
    if (existsSync(legacyFile)) {
      return ensureLegacyFileMigrated(primaryFile, legacyFile)
    }
  }
  return primaryFile
}

export function getProjectConfigDir(rootDir: string): string {
  return normalizeNfc(join(rootDir, PRIMARY_CONFIG_DIR_NAME))
}

export function getLegacyProjectConfigDir(rootDir: string): string {
  return normalizeNfc(join(rootDir, '.claude'))
}

export function getIntermediateLegacyProjectConfigDir(rootDir: string): string {
  return normalizeNfc(join(rootDir, '.my_agent'))
}

export function ensureLegacyProjectConfigMigrated(rootDir: string): string {
  const primaryDir = getProjectConfigDir(rootDir)
  const intermediateDir = getIntermediateLegacyProjectConfigDir(rootDir)
  if (existsSync(intermediateDir)) {
    return ensureLegacyTreeMigrated(primaryDir, intermediateDir)
  }
  return ensureLegacyTreeMigrated(primaryDir, getLegacyProjectConfigDir(rootDir))
}

export function getPrimaryProjectConfigPath(
  rootDir: string,
  ...parts: string[]
): string {
  const primaryDir = ensureLegacyProjectConfigMigrated(rootDir)
  return normalizeNfc(join(primaryDir, ...parts))
}

export function getProjectConfigDirCandidates(rootDir: string): string[] {
  const primaryDir = getProjectConfigDir(rootDir)
  const legacyDir = getLegacyProjectConfigDir(rootDir)
  if (existsSync(primaryDir)) {
    return [primaryDir]
  }
  if (existsSync(legacyDir)) {
    return [legacyDir]
  }
  return [primaryDir]
}
