import type { Scope } from '@/ontology'
import { join } from './fs'

export interface Location {
  scope: Scope
  root: string
}

export const claudeDir = (loc: Location): string => join(loc.root, '.claude')
export const settingsPath = (loc: Location): string => join(claudeDir(loc), 'settings.json')
export const settingsLocalPath = (loc: Location): string =>
  join(claudeDir(loc), 'settings.local.json')
export const agentsDir = (loc: Location): string => join(claudeDir(loc), 'agents')
export const commandsDir = (loc: Location): string => join(claudeDir(loc), 'commands')
export const skillsDir = (loc: Location): string => join(claudeDir(loc), 'skills')
export const rulesDir = (loc: Location): string => join(claudeDir(loc), 'rules')

export const projectMcpPath = (loc: Location): string => join(loc.root, '.mcp.json')
export const userClaudeJson = (home: string): string => join(home, '.claude.json')

export const userPluginsDir = (home: string): string => join(home, '.claude', 'plugins')
export const installedPluginsPath = (home: string): string =>
  join(userPluginsDir(home), 'installed_plugins.json')
export const knownMarketplacesPath = (home: string): string =>
  join(userPluginsDir(home), 'known_marketplaces.json')
