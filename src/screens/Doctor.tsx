import figures from 'figures'
import { join } from 'path'
import React, { Suspense, use, useEffect, useMemo, useState } from 'react'
import { KeybindingWarnings } from 'src/components/KeybindingWarnings.js'
import { McpParsingWarnings } from 'src/components/mcp/McpParsingWarnings.js'
import { getModelMaxOutputTokens } from 'src/utils/context.js'
import { getClaudeConfigHomeDir } from 'src/utils/envUtils.js'
import type { SettingSource } from 'src/utils/settings/constants.js'
import { getOriginalCwd } from '../bootstrap/state.js'
import type { CommandResultDisplay } from '../commands.js'
import { Pane } from '../components/design-system/Pane.js'
import { PressEnterToContinue } from '../components/PressEnterToContinue.js'
import { SandboxDoctorSection } from '../components/sandbox/SandboxDoctorSection.js'
import { ValidationErrorsList } from '../components/ValidationErrorsList.js'
import { useSettingsErrors } from '../hooks/notifs/useSettingsErrors.js'
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js'
import { Box, Text } from '../ink.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import { useAppState } from '../state/AppState.js'
import { getPluginErrorMessage } from '../types/plugin.js'
import {
  getGcsDistTags,
  getNpmDistTags,
  type NpmDistTags,
} from '../utils/autoUpdater.js'
import {
  type ContextWarnings,
  checkContextWarnings,
} from '../utils/doctorContextWarnings.js'
import {
  type DiagnosticInfo,
  getDoctorDiagnostic,
} from '../utils/doctorDiagnostic.js'
import { validateBoundedIntEnvVar } from '../utils/envValidation.js'
import { pathExists } from '../utils/file.js'
import {
  cleanupStaleLocks,
  getAllLockInfo,
  isPidBasedLockingEnabled,
  type LockInfo,
} from '../utils/nativeInstaller/pidLock.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import {
  BASH_MAX_OUTPUT_DEFAULT,
  BASH_MAX_OUTPUT_UPPER_LIMIT,
} from '../utils/shell/outputLimits.js'
import {
  TASK_MAX_OUTPUT_DEFAULT,
  TASK_MAX_OUTPUT_UPPER_LIMIT,
} from '../utils/task/outputFormatting.js'
import { getXDGStateHome } from '../utils/xdg.js'

type Props = {
  onDone: (
    result?: string,
    options?: {
      display?: CommandResultDisplay
    },
  ) => void
}

type AgentInfo = {
  activeAgents: Array<{
    agentType: string
    source: SettingSource | 'built-in' | 'plugin'
  }>
  userAgentsDir: string
  projectAgentsDir: string
  userDirExists: boolean
  projectDirExists: boolean
  failedFiles?: Array<{
    path: string
    error: string
  }>
}

type VersionLockInfo = {
  enabled: boolean
  locks: LockInfo[]
  locksDir: string
  staleLocksCleaned: number
}

function DistTagsDisplay({ promise }: { promise: Promise<NpmDistTags> }) {
  const distTags = use(promise)

  if (!distTags.latest) {
    return <Text dimColor>└ Failed to fetch versions</Text>
  }

  return (
    <>
      {distTags.stable && <Text>└ Stable version: {distTags.stable}</Text>}
      <Text>└ Latest version: {distTags.latest}</Text>
    </>
  )
}

export function Doctor({ onDone }: Props) {
  const agentDefinitions = useAppState(state => state.agentDefinitions)
  const tools = useAppState(state => state.mcp.tools || [])
  const toolPermissionContext = useAppState(state => state.toolPermissionContext)
  const pluginsErrors = useAppState(state => state.plugins.errors)
  const validationErrors = useSettingsErrors()

  useExitOnCtrlCDWithKeybindings()

  const [diagnostic, setDiagnostic] = useState<DiagnosticInfo | null>(null)
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null)
  const [contextWarnings, setContextWarnings] = useState<ContextWarnings | null>(
    null,
  )
  const [versionLockInfo, setVersionLockInfo] = useState<VersionLockInfo | null>(
    null,
  )

  const autoUpdatesChannel = getInitialSettings()?.autoUpdatesChannel ?? 'latest'

  const distTagsPromise = useMemo(
    () =>
      getDoctorDiagnostic().then(async diag => {
        const fetchDistTags =
          diag.updateSource === 'npm registry' ? getNpmDistTags : getGcsDistTags
        return fetchDistTags().catch(() => ({ latest: null, stable: null }))
      }),
    [],
  )

  const errorsExcludingMcp = validationErrors.filter(
    error => error.mcpErrorMetadata === undefined,
  )

  const envValidationErrors = useMemo(() => {
    const envVars = [
      {
        name: 'BASH_MAX_OUTPUT_LENGTH',
        default: BASH_MAX_OUTPUT_DEFAULT,
        upperLimit: BASH_MAX_OUTPUT_UPPER_LIMIT,
      },
      {
        name: 'TASK_MAX_OUTPUT_LENGTH',
        default: TASK_MAX_OUTPUT_DEFAULT,
        upperLimit: TASK_MAX_OUTPUT_UPPER_LIMIT,
      },
      {
        name: 'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
        ...getModelMaxOutputTokens('claude-opus-4-6'),
      },
    ]

    return envVars
      .map(entry => {
        const value = process.env[entry.name]
        return {
          name: entry.name,
          ...validateBoundedIntEnvVar(
            entry.name,
            value,
            entry.default,
            entry.upperLimit,
          ),
        }
      })
      .filter(entry => entry.status !== 'valid')
  }, [])

  useEffect(() => {
    getDoctorDiagnostic().then(setDiagnostic)

    ;(async () => {
      const userAgentsDir = join(getClaudeConfigHomeDir(), 'agents')
      const projectAgentsDir = join(getOriginalCwd(), '.my_agent', 'agents')
      const { activeAgents, allAgents, failedFiles } = agentDefinitions

      const [userDirExists, projectDirExists] = await Promise.all([
        pathExists(userAgentsDir),
        pathExists(projectAgentsDir),
      ])

      setAgentInfo({
        activeAgents: activeAgents.map(agent => ({
          agentType: agent.agentType,
          source: agent.source,
        })),
        userAgentsDir,
        projectAgentsDir,
        userDirExists,
        projectDirExists,
        failedFiles,
      })

      const warnings = await checkContextWarnings(
        tools,
        {
          activeAgents,
          allAgents,
          failedFiles,
        },
        async () => toolPermissionContext,
      )
      setContextWarnings(warnings)

      if (isPidBasedLockingEnabled()) {
        const locksDir = join(getXDGStateHome(), 'mya', 'locks')
        const staleLocksCleaned = cleanupStaleLocks(locksDir)
        const locks = getAllLockInfo(locksDir)
        setVersionLockInfo({
          enabled: true,
          locks,
          locksDir,
          staleLocksCleaned,
        })
      } else {
        setVersionLockInfo({
          enabled: false,
          locks: [],
          locksDir: '',
          staleLocksCleaned: 0,
        })
      }
    })()
  }, [agentDefinitions, toolPermissionContext, tools])

  const handleDismiss = () => {
    onDone('mya diagnostics dismissed', { display: 'system' })
  }

  useKeybindings(
    {
      'confirm:yes': handleDismiss,
      'confirm:no': handleDismiss,
    },
    { context: 'Confirmation' },
  )

  if (!diagnostic) {
    return (
      <Pane>
        <Text dimColor>Checking installation status…</Text>
      </Pane>
    )
  }

  const ripgrepMode =
    diagnostic.ripgrepStatus.mode === 'embedded'
      ? 'bundled'
      : diagnostic.ripgrepStatus.mode === 'builtin'
        ? 'vendor'
        : diagnostic.ripgrepStatus.systemPath || 'system'

  const runtimeSummary = diagnostic.runtime.runningWithBun
    ? diagnostic.runtime.bundledExecutable
      ? `Bun bundled executable (${diagnostic.runtime.bunVersion ?? 'unknown'})`
      : `Bun runtime (${diagnostic.runtime.bunVersion ?? 'unknown'})`
    : `Node runtime (${diagnostic.runtime.nodeVersion ?? 'unknown'})`

  const connectStatus = diagnostic.connect.bundled
    ? diagnostic.connect.dependenciesInstalled
      ? `ready (${diagnostic.connect.nodeVersion ?? 'node missing'})`
      : 'bundled, dependencies missing'
    : 'not bundled'

  return (
    <Pane>
      <Box flexDirection="column">
        <Text bold>Diagnostics</Text>
        <Text>
          └ Currently running: {diagnostic.installationType} ({diagnostic.version})
        </Text>
        {diagnostic.packageManager && (
          <Text>└ Package manager: {diagnostic.packageManager}</Text>
        )}
        <Text>└ Path: {diagnostic.installationPath}</Text>
        <Text>└ Invoked: {diagnostic.invokedBinary}</Text>
        <Text>└ Config install method: {diagnostic.configInstallMethod}</Text>
        <Text>└ Runtime: {runtimeSummary}</Text>
        {diagnostic.runtime.nodeVersion && (
          <Text>└ System Node: {diagnostic.runtime.nodeVersion}</Text>
        )}
        <Text>
          └ Bundled connect: {connectStatus}
          {!diagnostic.connect.nodeSupported && diagnostic.connect.bundled
            ? ' (Node.js 22+ required)'
            : ''}
        </Text>
        {diagnostic.connect.entryPath && (
          <Text dimColor>  └ Entry: {diagnostic.connect.entryPath}</Text>
        )}
        <Text>
          └ Search:{' '}
          {diagnostic.ripgrepStatus.working ? 'OK' : 'Not working'} ({ripgrepMode})
        </Text>
        {diagnostic.recommendation && (
          <>
            <Text />
            <Text color="warning">
              Recommendation: {diagnostic.recommendation.split('\n')[0]}
            </Text>
            <Text dimColor>{diagnostic.recommendation.split('\n')[1]}</Text>
          </>
        )}
        {diagnostic.multipleInstallations.length > 1 && (
          <>
            <Text />
            <Text color="warning">Warning: Multiple installations found</Text>
            {diagnostic.multipleInstallations.map((install, index) => (
              <Text key={index}>
                └ {install.type} at {install.path}
              </Text>
            ))}
          </>
        )}
        {diagnostic.warnings.length > 0 && (
          <>
            <Text />
            {diagnostic.warnings.map((warning, index) => (
              <Box key={index} flexDirection="column">
                <Text color="warning">Warning: {warning.issue}</Text>
                <Text>Fix: {warning.fix}</Text>
              </Box>
            ))}
          </>
        )}
        {errorsExcludingMcp.length > 0 && (
          <Box flexDirection="column" marginTop={1} marginBottom={1}>
            <Text bold>Invalid Settings</Text>
            <ValidationErrorsList errors={errorsExcludingMcp} />
          </Box>
        )}
      </Box>

      <Box flexDirection="column">
        <Text bold>Updates</Text>
        <Text>└ Update source: {diagnostic.updateSource}</Text>
        <Text>
          └ Auto-updates:{' '}
          {diagnostic.packageManager
            ? 'Managed by package manager'
            : diagnostic.autoUpdates}
        </Text>
        {diagnostic.hasUpdatePermissions !== null && (
          <Text>
            └ Update permissions:{' '}
            {diagnostic.hasUpdatePermissions ? 'Yes' : 'No (requires sudo)'}
          </Text>
        )}
        <Text>└ Auto-update channel: {autoUpdatesChannel}</Text>
        <Suspense fallback={null}>
          <DistTagsDisplay promise={distTagsPromise} />
        </Suspense>
      </Box>

      <SandboxDoctorSection />
      <McpParsingWarnings />
      <KeybindingWarnings />

      {envValidationErrors.length > 0 && (
        <Box flexDirection="column">
          <Text bold>Environment Variables</Text>
          {envValidationErrors.map((validation, index) => (
            <Text key={index}>
              └ {validation.name}:{' '}
              <Text color={validation.status === 'capped' ? 'warning' : 'error'}>
                {validation.message}
              </Text>
            </Text>
          ))}
        </Box>
      )}

      {versionLockInfo?.enabled && (
        <Box flexDirection="column">
          <Text bold>Version Locks</Text>
          {versionLockInfo.staleLocksCleaned > 0 && (
            <Text dimColor>
              └ Cleaned {versionLockInfo.staleLocksCleaned} stale lock(s)
            </Text>
          )}
          {versionLockInfo.locks.length === 0 ? (
            <Text dimColor>└ No active version locks</Text>
          ) : (
            versionLockInfo.locks.map((lock, index) => (
              <Text key={index}>
                └ {lock.version}: PID {lock.pid}{' '}
                {lock.isProcessRunning ? (
                  <Text>(running)</Text>
                ) : (
                  <Text color="warning">(stale)</Text>
                )}
              </Text>
            ))
          )}
        </Box>
      )}

      {agentInfo?.failedFiles && agentInfo.failedFiles.length > 0 && (
        <Box flexDirection="column">
          <Text bold color="error">
            Agent Parse Errors
          </Text>
          <Text color="error">
            └ Failed to parse {agentInfo.failedFiles.length} agent file(s):
          </Text>
          {agentInfo.failedFiles.map((file, index) => (
            <Text key={index} dimColor>
              {'  '}└ {file.path}: {file.error}
            </Text>
          ))}
        </Box>
      )}

      {pluginsErrors.length > 0 && (
        <Box flexDirection="column">
          <Text bold color="error">
            Plugin Errors
          </Text>
          <Text color="error">└ {pluginsErrors.length} plugin error(s) detected:</Text>
          {pluginsErrors.map((error, index) => (
            <Text key={index} dimColor>
              {'  '}└ {error.source || 'unknown'}
              {'plugin' in error && error.plugin ? ` [${error.plugin}]` : ''}:{' '}
              {getPluginErrorMessage(error)}
            </Text>
          ))}
        </Box>
      )}

      {contextWarnings?.unreachableRulesWarning && (
        <Box flexDirection="column">
          <Text bold color="warning">
            Unreachable Permission Rules
          </Text>
          <Text>
            └{' '}
            <Text color="warning">
              {figures.warning} {contextWarnings.unreachableRulesWarning.message}
            </Text>
          </Text>
          {contextWarnings.unreachableRulesWarning.details.map((detail, index) => (
            <Text key={index} dimColor>
              {'  '}└ {detail}
            </Text>
          ))}
        </Box>
      )}

      {contextWarnings &&
        (contextWarnings.claudeMdWarning ||
          contextWarnings.agentWarning ||
          contextWarnings.mcpWarning) && (
          <Box flexDirection="column">
            <Text bold>Context Usage Warnings</Text>

            {contextWarnings.claudeMdWarning && (
              <>
                <Text>
                  └{' '}
                  <Text color="warning">
                    {figures.warning} {contextWarnings.claudeMdWarning.message}
                  </Text>
                </Text>
                <Text>{'  '}└ Files:</Text>
                {contextWarnings.claudeMdWarning.details.map((detail, index) => (
                  <Text key={index} dimColor>
                    {'    '}└ {detail}
                  </Text>
                ))}
              </>
            )}

            {contextWarnings.agentWarning && (
              <>
                <Text>
                  └{' '}
                  <Text color="warning">
                    {figures.warning} {contextWarnings.agentWarning.message}
                  </Text>
                </Text>
                <Text>{'  '}└ Top contributors:</Text>
                {contextWarnings.agentWarning.details.map((detail, index) => (
                  <Text key={index} dimColor>
                    {'    '}└ {detail}
                  </Text>
                ))}
              </>
            )}

            {contextWarnings.mcpWarning && (
              <>
                <Text>
                  └{' '}
                  <Text color="warning">
                    {figures.warning} {contextWarnings.mcpWarning.message}
                  </Text>
                </Text>
                <Text>{'  '}└ MCP servers:</Text>
                {contextWarnings.mcpWarning.details.map((detail, index) => (
                  <Text key={index} dimColor>
                    {'    '}└ {detail}
                  </Text>
                ))}
              </>
            )}
          </Box>
        )}

      <Box>
        <PressEnterToContinue />
      </Box>
    </Pane>
  )
}
