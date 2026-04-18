import YAML from 'yaml'

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export interface Parsed<T = Record<string, unknown>> {
  data: T
  body: string
  hadFrontmatter: boolean
}

export const parse = <T = Record<string, unknown>>(text: string): Parsed<T> => {
  const m = text.match(FENCE)
  if (!m) return { data: {} as T, body: text, hadFrontmatter: false }
  const yaml = m[1] ?? ''
  const body = text.slice(m[0].length)
  let data: T
  try {
    data = (YAML.parse(yaml) ?? {}) as T
  } catch {
    data = {} as T
  }
  return { data, body, hadFrontmatter: true }
}

export const stringify = (data: Record<string, unknown>, body: string): string => {
  const cleaned: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)
      continue
    cleaned[k] = v
  }
  if (Object.keys(cleaned).length === 0) return body
  const yaml = YAML.stringify(cleaned).trimEnd()
  const sep = body.startsWith('\n') ? '' : '\n'
  return `---\n${yaml}\n---\n${sep}${body}`
}
