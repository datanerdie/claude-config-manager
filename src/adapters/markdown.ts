import type { Entity, Kind, Scope } from '@/ontology'
import { fs, basename, join, stripExt } from './fs'
import { parse, stringify } from './frontmatter'

export interface MarkdownReadOptions<T> {
  dir: string
  scope: Scope
  kind: Kind
  recursive?: boolean
  build: (input: {
    rawData: Record<string, unknown>
    body: string
    path: string
    relativePath: string
    fileName: string
  }) => T
  idOf: (value: T) => string
}

export const readMarkdownDir = async <T>(
  opts: MarkdownReadOptions<T>,
): Promise<Entity<T>[]> => {
  if (!(await fs.pathExists(opts.dir))) return []
  const entries = opts.recursive
    ? await fs.listDirRecursive(opts.dir, 8)
    : await fs.listDir(opts.dir)
  const out: Entity<T>[] = []
  for (const e of entries) {
    if (!e.is_file || !e.name.endsWith('.md')) continue
    const raw = await fs.readText(e.path).catch(() => null)
    if (raw === null) continue
    const relative = e.path.startsWith(opts.dir)
      ? e.path.slice(opts.dir.length + 1).replace(/\\/g, '/')
      : e.name
    try {
      const { data, body } = parse(raw)
      const value = opts.build({
        rawData: data as Record<string, unknown>,
        body,
        path: e.path,
        relativePath: relative,
        fileName: stripExt(basename(e.path), '.md'),
      })
      out.push({
        id: `${opts.kind}:${opts.scope.type === 'user' ? 'user' : opts.scope.projectId}:${opts.idOf(value)}`,
        kind: opts.kind,
        scope: opts.scope,
        path: e.path,
        value,
        origin: value,
        raw,
      })
    } catch (err) {
      const empty = {} as T
      out.push({
        id: `${opts.kind}:${opts.scope.type === 'user' ? 'user' : opts.scope.projectId}:${relative}`,
        kind: opts.kind,
        scope: opts.scope,
        path: e.path,
        value: empty,
        origin: empty,
        raw,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return out
}

export const writeMarkdown = async (
  path: string,
  data: Record<string, unknown>,
  body: string,
): Promise<void> => {
  await fs.writeText(path, stringify(data, body))
}

export { join }
