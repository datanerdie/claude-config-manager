import {
  claudeProjectEncoding,
  kindTargetableScopes,
  type Entity,
  type Project,
  type Scope,
} from '@/ontology'

export interface ScopeTarget {
  name: string
  scope: Scope
}

/**
 * Conversations always live under a specific encoded project dir, even when
 * surfaced in the aggregate "user" view. Resolve which project the file
 * actually belongs to so copy/move targets can exclude it.
 */
const effectiveSourceScope = (
  entity: Entity<any>,
  projects: Project[],
): Scope => {
  if (entity.kind === 'conversation') {
    const dir = (entity.value as { projectDir?: string }).projectDir
    if (dir) {
      const match = projects.find((p) => claudeProjectEncoding(p.path) === dir)
      if (match) return { type: 'project', projectId: match.id }
    }
  }
  return entity.scope
}

export const copyMoveTargets = (
  entity: Entity<any>,
  projects: Project[],
): ScopeTarget[] => {
  const sourceScope = effectiveSourceScope(entity, projects)
  const targetable = kindTargetableScopes(entity.kind)
  const out: ScopeTarget[] = []
  if (targetable.includes('user') && sourceScope.type !== 'user') {
    out.push({ name: 'global', scope: { type: 'user' } })
  }
  if (targetable.includes('project')) {
    for (const p of projects) {
      if (sourceScope.type === 'project' && sourceScope.projectId === p.id) continue
      out.push({ name: p.name, scope: { type: 'project', projectId: p.id } })
    }
  }
  return out
}
