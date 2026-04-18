import { ClaudeMd, type Entity } from '@/ontology'
import { fs, join, basename } from './fs'
import type { Location } from './paths'

const IGNORED = new Set([
  'node_modules',
  '.git',
  'target',
  'dist',
  'build',
  '.next',
  '.cache',
  '.deleted',
])

const scopeKey = (loc: Location) =>
  loc.scope.type === 'user' ? 'user' : loc.scope.projectId

const rel = (root: string, path: string): string => {
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const p = path.replace(/\\/g, '/')
  return p.startsWith(r) ? p.slice(r.length + 1) : p
}

const toEntity = async (
  loc: Location,
  fullPath: string,
): Promise<Entity<ClaudeMd> | null> => {
  const raw = await fs.readText(fullPath).catch(() => null)
  if (raw === null) return null
  const relPath = rel(loc.root, fullPath)
  const value = ClaudeMd.parse({ name: relPath, relPath, body: raw })
  return {
    id: `claudemd:${scopeKey(loc)}:${relPath}`,
    kind: 'claudemd',
    scope: loc.scope,
    path: fullPath,
    value,
    origin: value,
    raw,
  }
}

export const readClaudeMds = async (loc: Location): Promise<Entity<ClaudeMd>[]> => {
  const out: Entity<ClaudeMd>[] = []
  if (loc.scope.type === 'user') {
    const candidates = [
      join(loc.root, '.claude', 'CLAUDE.md'),
      join(loc.root, 'CLAUDE.md'),
    ]
    for (const p of candidates) {
      const entity = await toEntity(loc, p)
      if (entity) out.push(entity)
    }
  } else {
    const entries = await fs.listDirRecursive(loc.root, 4).catch(() => [])
    for (const e of entries) {
      if (!e.is_file || basename(e.path) !== 'CLAUDE.md') continue
      const segs = e.path.replace(/\\/g, '/').split('/')
      if (segs.some((s) => IGNORED.has(s))) continue
      const entity = await toEntity(loc, e.path)
      if (entity) out.push(entity)
    }
  }
  out.sort((a, b) => a.value.relPath.localeCompare(b.value.relPath))
  return out
}

export const writeClaudeMd = async (
  loc: Location,
  original: Entity<ClaudeMd> | null,
  next: ClaudeMd,
): Promise<string> => {
  const relPath = (next.relPath || 'CLAUDE.md').replace(/^[/\\]+/, '')
  const nextPath = join(loc.root, relPath)
  if (original && original.path !== nextPath) {
    if (await fs.pathExists(original.path)) await fs.removePath(original.path)
  }
  await fs.writeText(nextPath, next.body)
  return nextPath
}

export const deleteClaudeMd = async (
  _loc: Location,
  entity: Entity<ClaudeMd>,
): Promise<void> => {
  if (await fs.pathExists(entity.path)) await fs.removePath(entity.path)
}
