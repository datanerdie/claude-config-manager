import {
  Memory,
  type Entity,
  claudeProjectEncoding,
  memorySlug,
} from '@/ontology'
import { fs, join, stripExt, readTextOrNull } from './fs'
import { parse, stringify } from './frontmatter'
import type { Location } from './paths'

const scopeKey = (loc: Location) =>
  loc.scope.type === 'user' ? 'user' : loc.scope.projectId

const memoryDirOf = (home: string, projectPath: string): string =>
  join(home, '.claude', 'projects', claudeProjectEncoding(projectPath), 'memory')

const indexPathOf = (dir: string): string => join(dir, 'MEMORY.md')

const fileNameOf = (m: Memory): string => `${memorySlug(m.name)}.md`

export const readMemories = async (
  loc: Location,
  home: string,
): Promise<Entity<Memory>[]> => {
  if (loc.scope.type !== 'project') return []
  const dir = memoryDirOf(home, loc.root)
  if (!(await fs.pathExists(dir))) return []
  const entries = await fs.listDir(dir)
  const out: Entity<Memory>[] = []
  for (const e of entries) {
    if (!e.is_file || !e.name.endsWith('.md') || e.name === 'MEMORY.md') continue
    const raw = await readTextOrNull(e.path)
    if (raw === null) continue
    const fallback = stripExt(e.name, '.md')
    try {
      const { data, body } = parse(raw)
      const value = Memory.parse({
        name: (data.name as string) ?? fallback,
        description: (data.description as string) ?? '',
        type: (data.type as Memory['type']) ?? 'project',
        body,
      })
      out.push({
        id: `memory:${scopeKey(loc)}:${fallback}`,
        kind: 'memory',
        scope: loc.scope,
        path: e.path,
        value,
        origin: value,
        raw,
      })
    } catch (err) {
      const empty = {
        name: fallback,
        description: '',
        type: 'project',
        body: '',
      } as Memory
      out.push({
        id: `memory:${scopeKey(loc)}:${fallback}`,
        kind: 'memory',
        scope: loc.scope,
        path: e.path,
        value: empty,
        origin: empty,
        raw,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  out.sort((a, b) => a.value.name.localeCompare(b.value.name))
  return out
}

const rebuildIndex = async (dir: string): Promise<void> => {
  const entries = await fs.listDir(dir).catch(() => [])
  const items: { title: string; file: string; description: string }[] = []
  for (const e of entries) {
    if (!e.is_file || !e.name.endsWith('.md') || e.name === 'MEMORY.md') continue
    const raw = await readTextOrNull(e.path)
    if (raw === null) continue
    const { data } = parse(raw)
    items.push({
      title: (data.name as string) ?? stripExt(e.name, '.md'),
      file: e.name,
      description: (data.description as string) ?? '',
    })
  }
  items.sort((a, b) => a.title.localeCompare(b.title))
  const lines = items.map(
    (i) => `- [${i.title}](${i.file})${i.description ? ` — ${i.description}` : ''}`,
  )
  const content = lines.length ? lines.join('\n') + '\n' : ''
  await fs.writeText(indexPathOf(dir), content)
}

const serialize = (m: Memory): string =>
  stringify(
    {
      name: m.name,
      description: m.description,
      type: m.type,
    },
    m.body,
  )

export const writeMemoryEntry = async (
  loc: Location,
  home: string,
  original: Entity<Memory> | null,
  next: Memory,
): Promise<void> => {
  if (loc.scope.type !== 'project') return
  const dir = memoryDirOf(home, loc.root)
  await fs.ensureDir(dir)

  const nextPath = join(dir, fileNameOf(next))

  if (original && original.path !== nextPath) {
    if (await fs.pathExists(original.path)) await fs.removePath(original.path)
  }

  await fs.writeText(nextPath, serialize(next))
  await rebuildIndex(dir)
}

export const deleteMemoryEntry = async (
  loc: Location,
  home: string,
  entity: Entity<Memory>,
): Promise<void> => {
  if (loc.scope.type !== 'project') return
  if (await fs.pathExists(entity.path)) await fs.removePath(entity.path)
  const dir = memoryDirOf(home, loc.root)
  await rebuildIndex(dir)
}
