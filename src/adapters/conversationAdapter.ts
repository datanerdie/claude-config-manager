import { type Conversation } from '@/ontology'
import { claudeProjectEncoding } from '@/ontology'
import type { Entity } from '@/ontology'
import { fs, join } from './fs'
import type { Location } from './paths'

const extractMetadata = async (
  filePath: string,
  sessionId: string,
): Promise<{ title: string; startTime: string; lastTime: string; turnCount: number; tokenCount: number } | null> => {
  try {
    const raw = await fs.readText(filePath)
    const lines = raw.split('\n').filter(Boolean)
    let title = sessionId
    let startTime = ''
    let lastTime = ''
    let turnCount = 0
    let tokenCount = 0
    for (const line of lines) {
      try {
        const obj = JSON.parse(line)
        if (obj.timestamp) {
          if (!startTime || obj.timestamp < startTime) startTime = obj.timestamp
          if (!lastTime || obj.timestamp > lastTime) lastTime = obj.timestamp
        }
        if (obj.type === 'ai-title' && obj.aiTitle) title = obj.aiTitle
        if (obj.type === 'user' && !obj.isSidechain && obj.message?.role === 'user') turnCount++
        if (obj.type === 'assistant' && !obj.isSidechain && obj.message?.usage) {
          const u = obj.message.usage
          tokenCount += (u.input_tokens ?? 0) + (u.output_tokens ?? 0)
        }
      } catch {}
    }
    return { title, startTime, lastTime, turnCount, tokenCount }
  } catch {
    return null
  }
}

const readFromDir = async (
  projectDir: string,
  dirName: string,
  scope: Entity<Conversation>['scope'],
): Promise<Entity<Conversation>[]> => {
  if (!(await fs.pathExists(projectDir))) return []
  const entries = await fs.listDir(projectDir)
  const out: Entity<Conversation>[] = []
  for (const e of entries) {
    if (!e.is_file || !e.name.endsWith('.jsonl')) continue
    const sessionId = e.name.slice(0, -6)
    const meta = await extractMetadata(e.path, sessionId)
    if (!meta) continue
    const value: Conversation = {
      sessionId,
      title: meta.title,
      startTime: meta.startTime,
      lastTime: meta.lastTime,
      turnCount: meta.turnCount,
      tokenCount: meta.tokenCount > 0 ? meta.tokenCount : undefined,
      projectDir: dirName,
      filePath: e.path,
    }
    out.push({
      id: `conversation:${dirName}:${sessionId}`,
      kind: 'conversation',
      scope,
      path: e.path,
      value,
      origin: value,
      raw: '',
    })
  }
  return out
}

const conversationTargetPath = (
  home: string,
  loc: Location,
  sessionId: string,
): string =>
  join(home, '.claude', 'projects', claudeProjectEncoding(loc.root), `${sessionId}.jsonl`)

export const writeConversation = async (
  loc: Location,
  home: string,
  value: Conversation,
): Promise<void> => {
  if (loc.scope.type !== 'project') return
  const targetDir = join(home, '.claude', 'projects', claudeProjectEncoding(loc.root))
  const targetPath = conversationTargetPath(home, loc, value.sessionId)
  if (value.filePath === targetPath) return
  if (await fs.pathExists(targetPath))
    throw new Error(`A conversation with session id ${value.sessionId} already exists in the target project.`)
  const contents = await fs.readText(value.filePath)
  await fs.ensureDir(targetDir)
  await fs.writeText(targetPath, contents)
}

export const deleteConversation = async (
  entity: Entity<Conversation>,
): Promise<void> => {
  if (await fs.pathExists(entity.path)) await fs.removePath(entity.path)
}

export const readConversations = async (
  loc: Location,
  home: string,
): Promise<Entity<Conversation>[]> => {
  const out: Entity<Conversation>[] = []

  if (loc.scope.type === 'project') {
    const dirName = claudeProjectEncoding(loc.root)
    const projectDir = join(home, '.claude', 'projects', dirName)
    const entries = await readFromDir(projectDir, dirName, loc.scope)
    out.push(...entries)
  } else {
    const projectsDir = join(home, '.claude', 'projects')
    if (await fs.pathExists(projectsDir)) {
      const dirs = await fs.listDir(projectsDir)
      await Promise.all(
        dirs
          .filter((d) => d.is_dir)
          .map(async (d) => {
            const entries = await readFromDir(d.path, d.name, loc.scope)
            out.push(...entries)
          }),
      )
    }
  }

  out.sort((a, b) => b.value.lastTime.localeCompare(a.value.lastTime))
  return out
}

export interface ToolUse {
  id: string
  name: string
  input: Record<string, any>
}

export interface ParsedMessage {
  uuid: string
  role: 'user' | 'assistant'
  timestamp: string
  textBlocks: string[]
  toolUses: ToolUse[]
}

import {
  getCachedConversation,
  setCachedConversation,
  getPendingConversation,
  setPendingConversation,
  clearPendingConversation,
  getCachedToolResults,
  setCachedToolResults,
  getPendingToolResults,
  setPendingToolResults,
  clearPendingToolResults,
} from '@/registry'

const isSystemInjection = (text: string): boolean => {
  const t = text.trimStart()
  return (
    t.startsWith('<ide_') ||
    t.startsWith('<system') ||
    t.startsWith('<user-prompt') ||
    t.startsWith('<command-') ||
    t.startsWith('<parameter name="')
  )
}

const extractResultText = (c: any): string => {
  if (typeof c.content === 'string') return c.content
  if (Array.isArray(c.content))
    return c.content.filter((b: any) => b.type === 'text').map((b: any) => b.text as string).join('')
  return ''
}

/**
 * Parses messages only — no tool_result strings. Results are loaded lazily
 * via {@link fetchToolResults}. Keeps the message payload small and the
 * cache memory-friendly.
 */
const parseMessagesUncached = async (filePath: string): Promise<ParsedMessage[]> => {
  const raw = await fs.readText(filePath)
  const lines = raw.split('\n').filter(Boolean)

  const messages: ParsedMessage[] = []
  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      if (obj.type === 'user' && !obj.isSidechain && obj.message?.role === 'user') {
        const content: any[] = Array.isArray(obj.message?.content) ? obj.message.content : []
        const textBlocks = content
          .filter((c) => c.type === 'text')
          .map((c) => c.text as string)
          .filter((t) => !isSystemInjection(t))
        if (textBlocks.length > 0)
          messages.push({ uuid: obj.uuid, role: 'user', timestamp: obj.timestamp, textBlocks, toolUses: [] })
      } else if (obj.type === 'assistant' && !obj.isSidechain) {
        const content: any[] = Array.isArray(obj.message?.content) ? obj.message.content : []
        const textBlocks = content.filter((c) => c.type === 'text').map((c) => c.text as string)
        const toolUses: ToolUse[] = content
          .filter((c) => c.type === 'tool_use')
          .map((c) => ({
            id: c.id as string,
            name: c.name as string,
            input: c.input ?? {},
          }))
        if (textBlocks.length > 0 || toolUses.length > 0)
          messages.push({ uuid: obj.uuid, role: 'assistant', timestamp: obj.timestamp, textBlocks, toolUses })
      }
    } catch {}
  }

  return messages
}

/**
 * Cached, dedupe-in-flight parser. Consult the conversation cache first;
 * if multiple callers request the same path while parsing is in flight,
 * they all receive the same Promise.
 */
export const parseConversationMessages = (filePath: string): Promise<ParsedMessage[]> => {
  const cached = getCachedConversation(filePath)
  if (cached) return Promise.resolve(cached)
  const inflight = getPendingConversation(filePath)
  if (inflight) return inflight
  const p = parseMessagesUncached(filePath)
    .then((msgs) => {
      setCachedConversation(filePath, msgs)
      clearPendingConversation(filePath)
      return msgs
    })
    .catch((err) => {
      clearPendingConversation(filePath)
      throw err
    })
  setPendingConversation(filePath, p)
  return p
}

/**
 * Fire-and-forget: start parsing a conversation in the background so it's
 * cached by the time the user actually opens it. Called on list-item hover.
 */
export const prefetchConversation = (filePath: string): void => {
  void parseConversationMessages(filePath).catch(() => {})
}

const loadToolResultsUncached = async (filePath: string): Promise<Map<string, string>> => {
  const raw = await fs.readText(filePath)
  const lines = raw.split('\n').filter(Boolean)
  const results = new Map<string, string>()
  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      if (obj.type === 'user' && obj.message?.role === 'user') {
        const content: any[] = Array.isArray(obj.message?.content) ? obj.message.content : []
        for (const c of content) {
          if (c.type === 'tool_result' && c.tool_use_id)
            results.set(c.tool_use_id, extractResultText(c))
        }
      }
    } catch {}
  }
  return results
}

/**
 * Lazy-loads all tool_result blocks for a conversation file. First call
 * for a path reads the file and scans for `tool_result` content; subsequent
 * calls return from cache. Concurrent callers share the same Promise.
 */
export const fetchToolResults = (filePath: string): Promise<Map<string, string>> => {
  const cached = getCachedToolResults(filePath)
  if (cached) return Promise.resolve(cached)
  const inflight = getPendingToolResults(filePath)
  if (inflight) return inflight
  const p = loadToolResultsUncached(filePath)
    .then((map) => {
      setCachedToolResults(filePath, map)
      clearPendingToolResults(filePath)
      return map
    })
    .catch((err) => {
      clearPendingToolResults(filePath)
      throw err
    })
  setPendingToolResults(filePath, p)
  return p
}
