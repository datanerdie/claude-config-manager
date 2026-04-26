import { describe, expect, it } from 'vitest'
import {
  scanImports,
  scanMcpTools,
  scanProseAgents,
  scanProseCommands,
  scanProseSkills,
} from './scanners'

describe('scanImports', () => {
  it('finds @path/to/file.md imports', () => {
    const refs = scanImports('Some text @rules/typescript.md and more')
    expect(refs).toHaveLength(3)
    expect(refs.every((r) => r.toName === 'rules/typescript.md')).toBe(true)
    expect(new Set(refs.map((r) => r.toKind))).toEqual(
      new Set(['claudemd', 'rule', 'memory']),
    )
  })

  it('emits one ref-set per unique path', () => {
    const refs = scanImports('@a.md and @a.md and @b.md')
    expect(refs.filter((r) => r.toKind === 'rule')).toHaveLength(2)
    expect(refs.filter((r) => r.toName === 'a.md')).toHaveLength(3)
    expect(refs.filter((r) => r.toName === 'b.md')).toHaveLength(3)
  })

  it('requires whitespace or paren before @', () => {
    expect(scanImports('foo@bar.md')).toEqual([])
    expect(scanImports('(@x.md)')).toHaveLength(3)
  })

  it('returns empty for empty input', () => {
    expect(scanImports('')).toEqual([])
  })
})

describe('scanMcpTools', () => {
  it('deduplicates exact repeats', () => {
    const refs = scanMcpTools('mcp__github mcp__github mcp__github', 'tool')
    expect(refs).toHaveLength(1)
    expect(refs[0]?.toName).toBe('github')
  })

  // Pre-existing bug: the regex `[a-zA-Z0-9_-]+` greedily consumes the tool
  // suffix into the server-name capture, so `mcp__github__create_pr` is
  // recorded as server "github__create_pr" rather than "github". The
  // deduplication then fails to collapse multiple tools under one server.
  // Documenting actual behavior here; fix belongs in scanners.ts itself.
  it('does not collapse multiple tools under one server (known bug)', () => {
    const refs = scanMcpTools('mcp__github__create_pr mcp__github__list_repos', 'tool')
    expect(refs.map((r) => r.toName).sort()).toEqual([
      'github__create_pr',
      'github__list_repos',
    ])
  })

  it('matches bare server names without a tool suffix', () => {
    const refs = scanMcpTools('mcp__perplexity', 'tool')
    expect(refs).toHaveLength(1)
    expect(refs[0]?.toName).toBe('perplexity')
  })

  it('uses matcher source kind when via=matcher', () => {
    const refs = scanMcpTools('mcp__github__*', 'matcher')
    expect(refs[0]?.source.kind).toBe('matcher')
  })

  it('uses tool source kind when via=tool', () => {
    const refs = scanMcpTools('mcp__github__create_pr', 'tool')
    expect(refs[0]?.source.kind).toBe('tool')
  })
})

describe('scanProseCommands', () => {
  it('finds /name invocations matching known commands', () => {
    const refs = scanProseCommands('Run /deploy and /lint please', ['deploy', 'lint', 'unused'])
    expect(refs.map((r) => r.toName).sort()).toEqual(['deploy', 'lint'])
  })

  it('does not match command names outside slash position', () => {
    expect(scanProseCommands('Mention deploy without slash', ['deploy'])).toEqual([])
  })

  it('matches at start of string', () => {
    expect(scanProseCommands('/foo bar', ['foo'])).toHaveLength(1)
  })
})

describe('scanProseAgents', () => {
  it('matches subagent_type: "name" syntax', () => {
    const refs = scanProseAgents('subagent_type: "researcher"', ['researcher'])
    expect(refs).toHaveLength(1)
    expect(refs[0]?.toName).toBe('researcher')
  })

  it('matches agent=name syntax without quotes', () => {
    const refs = scanProseAgents('agent=foo other text', ['foo'])
    expect(refs).toHaveLength(1)
  })

  it('does not match unknown agents', () => {
    expect(scanProseAgents('subagent_type: "unknown"', ['known'])).toEqual([])
  })
})

describe('scanProseSkills', () => {
  it('matches "skill: name"', () => {
    expect(scanProseSkills('skill: brainstorming', ['brainstorming'])).toHaveLength(1)
  })

  it('matches "Skill name" case-insensitive', () => {
    expect(scanProseSkills('Skill brainstorming', ['brainstorming'])).toHaveLength(1)
  })
})
