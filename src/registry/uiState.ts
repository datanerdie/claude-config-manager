import { fs, join, readJsonOrNull } from '@/adapters'
import type { Scope } from '@/ontology'

export interface UiState {
  selections: Record<string, string>
  lastScopeKey?: string
  lastKind?: string
}

const uiStatePath = (home: string): string =>
  join(home, '.config', 'ccm', 'ui-state.json')

export const loadUiState = async (home: string): Promise<UiState> => {
  const loaded = await readJsonOrNull<UiState>(uiStatePath(home))
  return {
    selections: loaded?.selections ?? {},
    lastScopeKey: loaded?.lastScopeKey,
    lastKind: loaded?.lastKind,
  }
}

export const saveUiState = async (home: string, state: UiState): Promise<void> => {
  await fs.writeJson(uiStatePath(home), state)
}

export const scopeFromKey = (key: string): Scope | null => {
  if (key === 'user') return { type: 'user' }
  if (key.startsWith('project:'))
    return { type: 'project', projectId: key.slice('project:'.length) }
  return null
}
