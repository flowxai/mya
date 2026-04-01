import { APP_COMMAND_NAME, PRIMARY_CONFIG_DIR_NAME } from './appNamespace.js'

export const APP_DISPLAY_NAME = APP_COMMAND_NAME
export const APP_IDENTITY_DESCRIPTION =
  'a coding CLI assistant for software engineering tasks'

export function getAppIdentityPrompt(): string {
  return `You are ${APP_DISPLAY_NAME}, ${APP_IDENTITY_DESCRIPTION}.`
}

export function getAgentIdentityPrompt(): string {
  return `You are an agent for ${APP_DISPLAY_NAME}, ${APP_IDENTITY_DESCRIPTION}.`
}

export function getProjectSkillsDirDisplayPath(): string {
  return `${PRIMARY_CONFIG_DIR_NAME}/skills/`
}

export function getGlobalSkillsDirDisplayPath(): string {
  return `~/${PRIMARY_CONFIG_DIR_NAME}/skills/`
}
