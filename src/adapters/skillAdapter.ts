import { Skill, type Entity } from '@/ontology'
import { parse, stringify } from './frontmatter'
import { skillsDir, type Location } from './paths'
import { fs, join, basename } from './fs'

const clean = (s: string): string =>
  s.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')

export const readSkills = async (loc: Location): Promise<Entity<Skill>[]> => {
  const root = skillsDir(loc)
  if (!(await fs.pathExists(root))) return []
  const dirs = await fs.listDir(root)
  const out: Entity<Skill>[] = []
  for (const d of dirs) {
    if (!d.is_dir) continue
    const skillPath = join(d.path, 'SKILL.md')
    const raw = await fs.readText(skillPath).catch(() => null)
    if (raw === null) continue
    try {
      const { data, body } = parse(raw)
      const value = Skill.parse({
        name: (data.name as string) ?? basename(d.path),
        description: (data.description as string) ?? '',
        license: data.license as string | undefined,
        allowedTools: data['allowed-tools'] as string[] | undefined,
        body,
      })
      out.push({
        id: `skill:${loc.scope.type === 'user' ? 'user' : loc.scope.projectId}:${value.name}`,
        kind: 'skill',
        scope: loc.scope,
        path: skillPath,
        value,
        origin: value,
        raw,
      })
    } catch (err) {
      const fallback = { name: d.name, description: '', body: '' } as Skill
      out.push({
        id: `skill:${loc.scope.type === 'user' ? 'user' : loc.scope.projectId}:${d.name}`,
        kind: 'skill',
        scope: loc.scope,
        path: skillPath,
        value: fallback,
        origin: fallback,
        raw,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return out
}

const skillDir = (loc: Location, name: string): string =>
  join(skillsDir(loc), clean(name))

export const writeSkill = async (
  loc: Location,
  original: Entity<Skill> | null,
  next: Skill,
): Promise<string> => {
  const nextDir = skillDir(loc, next.name)
  if (original) {
    const originalDir = skillDir(loc, original.origin.name)
    if (originalDir !== nextDir && (await fs.pathExists(originalDir))) {
      await fs.removePath(originalDir)
    }
  }
  const nextPath = join(nextDir, 'SKILL.md')
  const fm: Record<string, unknown> = {
    name: next.name,
    description: next.description,
    license: next.license,
    'allowed-tools': next.allowedTools,
  }
  await fs.writeText(nextPath, stringify(fm, next.body))
  return nextPath
}

export const deleteSkill = async (
  loc: Location,
  entity: Entity<Skill>,
): Promise<void> => {
  const dir = skillDir(loc, entity.origin.name)
  if (await fs.pathExists(dir)) await fs.removePath(dir)
}
