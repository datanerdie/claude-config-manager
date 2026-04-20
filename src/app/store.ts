import { create } from 'zustand'
import {
  fs,
  readByKind,
  readConversations,
  enrichConversation,
  writeEntity as adapterWrite,
  createEntity as adapterCreate,
  deleteEntity as adapterDelete,
  type ConversationEnrichJob,
  type Location,
  type WriteContext,
} from '@/adapters'
import {
  loadProjects,
  addManualProject,
  removeManualProject,
  resolveLocation,
  watchTargetsFor,
  loadUiState,
  saveUiState,
  scopeFromKey,
  loadSettings,
  saveSettings,
  initTokenCache,
  initPersistentCaches,
  invalidateConversation,
  invalidateToolResults,
  invalidatePath,
} from '@/registry'
import {
  allKinds,
  allKindsForScope,
  kindSupportsScope,
  defaultSettings,
  type AnyEntity,
  type Entity,
  type Kind,
  type Project,
  type Scope,
  type Settings,
  scopeEq,
  scopeKey,
} from '@/ontology'
import { buildReferenceGraph, type Reference } from '@/engine'

interface EntitiesByKind {
  claudemd: Entity<any>[]
  memory: Entity<any>[]
  agent: Entity<any>[]
  command: Entity<any>[]
  skill: Entity<any>[]
  rule: Entity<any>[]
  hook: Entity<any>[]
  mcp: Entity<any>[]
  plugin: Entity<any>[]
  marketplace: Entity<any>[]
  conversation: Entity<any>[]
}

const emptyBuckets = (): EntitiesByKind => ({
  claudemd: [],
  memory: [],
  agent: [],
  command: [],
  skill: [],
  rule: [],
  hook: [],
  mcp: [],
  plugin: [],
  marketplace: [],
  conversation: [],
})

interface State {
  home: string
  ready: boolean
  projects: Project[]
  scope: Scope
  kind: Kind
  selectedId: string | null
  entities: EntitiesByKind
  refs: Reference[]
  search: string
  lastError: string | null
  selections: Record<string, string>
  settings: Settings
  /**
   * In-flight async operations keyed by `<op>:<target>` (e.g. `install:open-prose@prose`).
   * Reactive — UI subscribes to check whether a specific button should show a spinner
   * or be disabled. Set semantics so concurrent ops on different targets coexist.
   */
  pendingOps: Set<string>
  /**
   * Kinds whose read is still in flight for the current scope. The sidebar
   * watches this to swap the count for a spinner. `reload` marks all kinds
   * loading on entry and clears each as its read settles.
   */
  loadingKinds: Set<Kind>
  /** Active tab id per kind (kinds with `tabs` on their descriptor). */
  activeTab: Record<string, string>
}

interface Actions {
  bootstrap: () => Promise<void>
  refreshProjects: () => Promise<void>
  setScope: (scope: Scope) => void
  setKind: (kind: Kind) => void
  setSelected: (id: string | null) => void
  setSearch: (s: string) => void
  reload: () => Promise<void>
  updateEntity: (entity: Entity<any>, next: any) => void
  createNew: (kind: Kind, input: string, value: any) => Promise<void>
  deleteExisting: (entity: Entity<any>) => Promise<void>
  copyToScope: (entity: Entity<any>, target: Scope) => Promise<void>
  moveToScope: (entity: Entity<any>, target: Scope) => Promise<void>
  createIn: (kind: Kind, value: any, target: Scope) => Promise<void>
  addProject: (path: string, name?: string) => Promise<void>
  removeProject: (project: Project) => Promise<void>
  updateSettings: (next: Settings) => void
  /**
   * Run an async operation while marking it pending in `pendingOps`. The caller
   * supplies a stable key (e.g. `install:open-prose@prose`) that UI can observe
   * to render spinners / disable buttons specific to that target.
   */
  runOp: <T>(key: string, fn: () => Promise<T>) => Promise<T>
  setActiveTab: (kind: Kind, tabId: string) => void
  /**
   * Persist a new entity value immediately (no debounce, no optimistic update).
   * Use when a mutation needs to happen *durably before* the UI reflects it —
   * e.g. plugin enable/disable, where an orange "in-progress" indicator only
   * makes sense if we don't lie with an optimistic flip.
   */
  saveEntity: (entity: Entity<any>, next: any) => Promise<void>
}

type Store = State & Actions

const USER_SCOPE: Scope = { type: 'user' }

const selectionKey = (scope: Scope, kind: Kind): string =>
  `${scopeKey(scope)}::${kind}`

const resolveContext = (s: State): { loc: Location; home: string } | null => {
  const loc = resolveLocation(s.scope, s.home, s.projects)
  if (!loc) return null
  return { loc, home: s.home }
}

const resolveSelection = (
  buckets: EntitiesByKind,
  scope: Scope,
  kind: Kind,
  selections: Record<string, string>,
  currentId: string | null,
): string | null => {
  const list = buckets[kind]
  if (currentId && list.find((e) => e.id === currentId)) return currentId
  const remembered = selections[selectionKey(scope, kind)]
  if (remembered && list.find((e) => e.id === remembered)) return remembered
  return list[0]?.id ?? null
}

const writeTimers = new Map<string, ReturnType<typeof setTimeout>>()
let reloadTimer: ReturnType<typeof setTimeout> | null = null
let saveUiTimer: ReturnType<typeof setTimeout> | null = null
let saveSettingsTimer: ReturnType<typeof setTimeout> | null = null

const withoutKind = (set: Set<Kind>, kind: Kind): Set<Kind> => {
  const next = new Set(set)
  next.delete(kind)
  return next
}

const patchBucket = (
  buckets: EntitiesByKind,
  kind: Kind,
  list: Entity<any>[],
): EntitiesByKind => ({ ...buckets, [kind]: list })

/** Max concurrent conversation enrichments — bounded to keep IPC humane. */
const ENRICH_CONCURRENCY = 8

/**
 * Background pool that parses conversation files to populate title / turn /
 * token metadata. Each completion is pushed to the store via `onEnriched` so
 * the list updates progressively. Aborts as soon as `isCurrent` returns false
 * (i.e. user switched scope).
 */
const runEnrichment = async (
  jobs: ConversationEnrichJob[],
  isCurrent: () => boolean,
  onEnriched: (entity: Entity<any>) => void,
): Promise<void> => {
  let cursor = 0
  const worker = async () => {
    while (isCurrent()) {
      const i = cursor++
      if (i >= jobs.length) return
      try {
        const enriched = await enrichConversation(jobs[i]!)
        if (!enriched || !isCurrent()) continue
        onEnriched(enriched)
      } catch {
        // best-effort: a single enrichment failure shouldn't block others
      }
    }
  }
  const width = Math.min(ENRICH_CONCURRENCY, jobs.length)
  await Promise.all(Array.from({ length: width }, worker))
}

const scheduleUiSave = (state: State) => {
  if (saveUiTimer) clearTimeout(saveUiTimer)
  saveUiTimer = setTimeout(() => {
    if (!state.home) return
    void saveUiState(state.home, {
      selections: state.selections,
      lastScopeKey: scopeKey(state.scope),
      lastKind: state.kind,
    })
  }, 250)
}

export const useStore = create<Store>((set, get) => ({
  home: '',
  ready: false,
  projects: [],
  scope: USER_SCOPE,
  kind: 'claudemd',
  selectedId: null,
  entities: emptyBuckets(),
  refs: [],
  search: '',
  lastError: null,
  selections: {},
  settings: defaultSettings(),
  pendingOps: new Set<string>(),
  loadingKinds: new Set<Kind>(),
  activeTab: {},

  bootstrap: async () => {
    try {
      const home = await fs.homeDir()
      set({ home })
      await Promise.all([
        get().refreshProjects(),
        initTokenCache(home),
        initPersistentCaches(home),
      ])
      const ui = await loadUiState(home)
      const settings = await loadSettings(home)
      set({ settings })
      const restoredScope =
        (ui.lastScopeKey && scopeFromKey(ui.lastScopeKey)) || USER_SCOPE
      const rawKind = (ui.lastKind as Kind) ?? 'claudemd'
      const restoredKind = kindSupportsScope(rawKind, restoredScope)
        ? rawKind
        : (allKindsForScope(restoredScope)[0] ?? 'claudemd')
      set({ scope: restoredScope, kind: restoredKind, selections: ui.selections })
      await get().reload()
      const targets = watchTargetsFor(get().scope, home, get().projects)
      await fs.watchPaths(targets)
      await fs.onChange((ev) => {
        for (const path of ev.paths) {
          invalidatePath(path)
          if (path.endsWith('.jsonl')) {
            invalidateConversation(path)
            invalidateToolResults(path)
          }
        }
        if (reloadTimer) clearTimeout(reloadTimer)
        reloadTimer = setTimeout(() => void get().reload(), 250)
      })
      set({ ready: true })
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) })
    }
  },

  refreshProjects: async () => {
    const projects = await loadProjects(get().home)
    set({ projects })
  },

  setScope: (scope) => {
    if (scopeEq(scope, get().scope)) return
    set((s) => {
      const kind = kindSupportsScope(s.kind, scope)
        ? s.kind
        : (allKindsForScope(scope)[0] ?? s.kind)
      return {
        scope,
        kind,
        selectedId: null,
        entities: emptyBuckets(),
        refs: [],
        loadingKinds: new Set<Kind>(allKinds),
      }
    })
    scheduleUiSave(get())
    void (async () => {
      await get().reload()
      const targets = watchTargetsFor(scope, get().home, get().projects)
      await fs.watchPaths(targets)
    })()
  },

  setKind: (kind) => {
    set((s) => {
      if (!kindSupportsScope(kind, s.scope)) return {}
      const selected = resolveSelection(
        s.entities,
        s.scope,
        kind,
        s.selections,
        null,
      )
      return { kind, selectedId: selected, search: '' }
    })
    scheduleUiSave(get())
  },

  setSelected: (id) => {
    set((s) => {
      if (!id) return { selectedId: null }
      const next = { ...s.selections, [selectionKey(s.scope, s.kind)]: id }
      return { selectedId: id, selections: next }
    })
    scheduleUiSave(get())
  },

  setSearch: (s) => set({ search: s }),

  reload: async () => {
    const state = get()
    const ctx = resolveContext(state)
    if (!ctx) {
      set({
        entities: emptyBuckets(),
        refs: [],
        selectedId: null,
        loadingKinds: new Set(),
      })
      return
    }
    const reloadScope = state.scope
    const stillCurrent = () => scopeEq(get().scope, reloadScope)

    set({ loadingKinds: new Set<Kind>(allKinds) })

    const commitKind = (k: Kind, list: Entity<any>[]) => {
      set((s) => {
        const entities = patchBucket(s.entities, k, list)
        return {
          entities,
          loadingKinds: withoutKind(s.loadingKinds, k),
          selectedId: resolveSelection(
            entities,
            s.scope,
            s.kind,
            s.selections,
            s.selectedId,
          ),
        }
      })
    }

    const clearLoading = (k: Kind, err?: unknown) => {
      set((s) => ({
        loadingKinds: withoutKind(s.loadingKinds, k),
        lastError:
          err === undefined
            ? s.lastError
            : err instanceof Error
              ? err.message
              : String(err),
      }))
    }

    let enrichJobs: ConversationEnrichJob[] = []

    const tasks = allKinds.map(async (k) => {
      try {
        if (k === 'conversation') {
          const { entities, jobs } = await readConversations(ctx.loc, ctx.home)
          if (!stillCurrent()) return
          enrichJobs = jobs
          commitKind('conversation', entities)
          return
        }
        const list = await readByKind(k, ctx.loc, ctx.home)
        if (!stillCurrent()) return
        commitKind(k, list)
      } catch (e) {
        if (!stillCurrent()) return
        clearLoading(k, e)
      }
    })

    await Promise.all(tasks)
    if (!stillCurrent()) return

    const all = Object.values(get().entities).flat() as AnyEntity[]
    set({ refs: buildReferenceGraph(all), lastError: null })

    if (enrichJobs.length > 0) {
      void runEnrichment(enrichJobs, stillCurrent, (entity) => {
        set((s) => ({
          entities: patchBucket(
            s.entities,
            'conversation',
            s.entities.conversation.map((e) =>
              e.path === entity.path ? entity : e,
            ),
          ),
        }))
      })
    }
  },

  updateEntity: (entity, next) => {
    set((s) => {
      const list = (s.entities as any)[entity.kind] as Entity<any>[]
      const updated = list.map((e) =>
        e.id === entity.id ? { ...e, value: next, dirty: true } : e,
      )
      return { entities: { ...s.entities, [entity.kind]: updated } }
    })
    const key = entity.id
    const prev = writeTimers.get(key)
    if (prev) clearTimeout(prev)
    writeTimers.set(
      key,
      setTimeout(async () => {
        const ctx = resolveContext(get())
        if (!ctx) return
        try {
          const current = (get().entities as any)[entity.kind].find(
            (e: Entity<any>) => e.id === entity.id,
          ) as Entity<any> | undefined
          const value = current?.value ?? next
          const writeCtx: WriteContext = { loc: ctx.loc, home: ctx.home }
          await adapterWrite(writeCtx, entity, value)
        } catch (e) {
          set({ lastError: e instanceof Error ? e.message : String(e) })
        }
      }, 350),
    )
  },

  createNew: async (kind, _input, value) => {
    const ctx = resolveContext(get())
    if (!ctx) return
    try {
      await adapterCreate({ loc: ctx.loc, home: ctx.home }, kind, value)
      await get().reload()
      set({ kind })
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) })
    }
  },

  deleteExisting: async (entity) => {
    const ctx = resolveContext(get())
    if (!ctx) return
    try {
      await adapterDelete({ loc: ctx.loc, home: ctx.home }, entity)
      if (get().selectedId === entity.id) set({ selectedId: null })
      await get().reload()
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) })
    }
  },

  copyToScope: async (entity, target) => {
    const state = get()
    const targetLoc = resolveLocation(target, state.home, state.projects)
    if (!targetLoc) return
    try {
      await adapterCreate(
        { loc: targetLoc, home: state.home },
        entity.kind,
        entity.value,
      )
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) })
    }
  },

  moveToScope: async (entity, target) => {
    await get().copyToScope(entity, target)
    await get().deleteExisting(entity)
  },

  createIn: async (kind, value, target) => {
    const state = get()
    const targetLoc = resolveLocation(target, state.home, state.projects)
    if (!targetLoc) return
    try {
      await adapterCreate({ loc: targetLoc, home: state.home }, kind, value)
      await get().reload()
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) })
    }
  },

  addProject: async (path, name) => {
    await addManualProject(get().home, path, name)
    await get().refreshProjects()
  },

  removeProject: async (project) => {
    await removeManualProject(get().home, project.path)
    await get().refreshProjects()
  },

  updateSettings: (next) => {
    set({ settings: next })
    if (saveSettingsTimer) clearTimeout(saveSettingsTimer)
    saveSettingsTimer = setTimeout(() => {
      const { home, settings } = get()
      if (home) void saveSettings(home, settings)
    }, 300)
  },

  setActiveTab: (kind, tabId) =>
    set((s) => ({ activeTab: { ...s.activeTab, [kind]: tabId } })),

  saveEntity: async (entity, next) => {
    const ctx = resolveContext(get())
    if (!ctx) throw new Error('No location for scope')
    await adapterWrite({ loc: ctx.loc, home: ctx.home }, entity, next)
  },

  runOp: async (key, fn) => {
    if (get().pendingOps.has(key)) {
      throw new Error(`${key} is already in progress`)
    }
    set((s) => ({ pendingOps: new Set(s.pendingOps).add(key) }))
    try {
      return await fn()
    } finally {
      set((s) => {
        const next = new Set(s.pendingOps)
        next.delete(key)
        return { pendingOps: next }
      })
    }
  },
}))
