import type { AnyEntity, Project, Scope } from '@/ontology'
import { claudeProjectEncoding } from '@/ontology'
import { join } from './fs'

export interface Location {
  scope: Scope
  root: string
}

const normPath = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')

export const relPath = (absPath: string, root: string): string => {
  const a = normPath(absPath)
  const r = normPath(root)
  if (!r) return a
  if (a === r) return '.'
  if (a.startsWith(r + '/')) return a.slice(r.length + 1)
  return a
}

export const displayEntityPath = (
  entity: AnyEntity,
  home: string,
  projects: Project[],
): string => {
  const candidates: string[] = []
  const scope = entity.scope
  if (scope.type === 'user') {
    candidates.push(join(home, '.claude'))
  } else {
    const project = projects.find((p) => p.id === scope.projectId)
    if (project) {
      candidates.push(
        join(home, '.claude', 'projects', claudeProjectEncoding(project.path)),
      )
      candidates.push(project.path)
    }
  }
  const a = normPath(entity.path)
  let best = ''
  for (const c of candidates) {
    const n = normPath(c)
    if ((a === n || a.startsWith(n + '/')) && n.length > best.length) best = n
  }
  return best ? relPath(entity.path, best) : a
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
