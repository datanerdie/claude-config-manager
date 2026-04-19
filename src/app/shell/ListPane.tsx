import { useEffect, useMemo, useRef } from 'react'
import { useStore } from '@/app/store'
import { descriptorFor } from '@/ui-descriptors'
import { ColorDot, List, openContextMenu, prompt, type ContextMenuItem } from '@/ui-primitives'
import { kindSpecs, type Entity } from '@/ontology'
import { prefetchConversation } from '@/adapters'
import { copyMoveTargets } from './targets'
import { cn } from '@/ui-primitives/util'

export function ListPane() {
  const kind = useStore((s) => s.kind)
  const scope = useStore((s) => s.scope)
  const projects = useStore((s) => s.projects)
  const entities = useStore((s) => (s.entities as any)[kind] as Entity<any>[])
  const selected = useStore((s) => s.selectedId)
  const setSelected = useStore((s) => s.setSelected)
  const search = useStore((s) => s.search)
  const setSearch = useStore((s) => s.setSearch)
  const createNew = useStore((s) => s.createNew)
  const deleteExisting = useStore((s) => s.deleteExisting)
  const copyToScope = useStore((s) => s.copyToScope)
  const moveToScope = useStore((s) => s.moveToScope)
  const createIn = useStore((s) => s.createIn)
  const home = useStore((s) => s.home)

  const descriptor = descriptorFor(kind)
  const spec = kindSpecs[kind]

  const tabs = descriptor.tabs ?? []
  const activeTabStore = useStore((s) => s.activeTab)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const activeTabId = tabs.length > 0 ? (activeTabStore[kind] ?? tabs[0]!.id) : null
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  const items = useMemo(() => {
    const q = search.toLowerCase().trim()
    let filtered = entities
    if (activeTab) filtered = filtered.filter((e) => activeTab.predicate(e.value))
    if (q) filtered = filtered.filter((e) => spec.searchText(e.value).includes(q))
    return filtered.map((e) => ({
      id: e.id,
      label: descriptor.listLabel(e.value),
      sublabel: descriptor.listSublabel?.(e.value),
      badge: e.dirty ? <ColorDot color="orange" title="Unsaved changes" /> : undefined,
      error: !!e.error,
    }))
  }, [entities, search, descriptor, spec, activeTab])

  // Predictive prefetch: when the user hovers on a conversation item for a
  // beat, start parsing it in the background so the click feels instant.
  // 120ms distinguishes "mouse resting here" from "flew past".
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
  }, [])
  const handleHover = useMemo<((id: string) => void) | undefined>(() => {
    if (kind !== 'conversation') return undefined
    return (id: string) => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = setTimeout(() => {
        const entity = entities.find((e) => e.id === id)
        if (entity?.path) prefetchConversation(entity.path)
      }, 120)
    }
  }, [kind, entities])

  const handleNew = async () => {
    const input = await prompt(descriptor.newLabel, {
      placeholder: descriptor.newPromptLabel,
    })
    if (!input) return
    await createNew(kind, input, descriptor.newDefault(input))
  }

  const contextItemsFor = (entityId: string): ContextMenuItem[] => {
    const entity = entities.find((e) => e.id === entityId)
    if (!entity) return []
    const entitySpec = kindSpecs[entity.kind]
    const entityReadOnly = entitySpec.readOnly ?? false
    const canScopeMove = !entityReadOnly || (entitySpec.allowScopeMove ?? false)
    const entityDescriptor = descriptorFor(entity.kind)
    const canDelete = !entityReadOnly && (entityDescriptor.canDelete ? entityDescriptor.canDelete(entity.value) : true)
    const targets = canScopeMove ? copyMoveTargets(entity, projects) : []
    const menu: ContextMenuItem[] = []

    const custom =
      descriptor.customActions?.(entity, {
        scope,
        projects,
        home,
        createIn,
        remove: deleteExisting,
      }) ?? []
    menu.push(...custom)

    if (targets.length > 0) {
      menu.push({
        label: 'Copy to…',
        submenu: targets.map((t) => ({
          label: t.name,
          onSelect: () => copyToScope(entity, t.scope),
        })),
      })
      menu.push({
        label: 'Move to…',
        submenu: targets.map((t) => ({
          label: t.name,
          onSelect: () => moveToScope(entity, t.scope),
        })),
      })
    }
    if (canDelete) {
      menu.push({
        label: 'Delete',
        destructive: true,
        onSelect: () => {
          if (confirm(`Delete ${descriptor.listLabel(entity.value)}?`))
            deleteExisting(entity)
        },
      })
    }
    return menu
  }

  return (
    <section className="w-[340px] shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-950">
      <header className="px-3 py-2 border-b border-zinc-800 flex items-center gap-2">
        <div className="flex-1 relative flex items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${spec.pluralLabel.toLowerCase()}…`}
            className="w-full bg-transparent outline-none px-2 py-1 pr-6 text-sm placeholder:text-zinc-600"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              title="Clear search"
              className="absolute right-1 w-4 h-4 flex items-center justify-center text-zinc-500 hover:text-zinc-200 rounded"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                aria-hidden
                className="stroke-current"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5" />
              </svg>
            </button>
          )}
        </div>
        {!(spec.readOnly ?? false) && !(spec.noCreate ?? false) && (
          <button
            onClick={handleNew}
            className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100"
            title={descriptor.newLabel}
          >
            + New
          </button>
        )}
      </header>
      {tabs.length > 0 && (
        <div className="flex border-b border-zinc-800 px-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(kind, t.id)}
              className={cn(
                'text-xs px-3 py-1.5 transition-colors',
                activeTabId === t.id
                  ? 'text-zinc-100 border-b-2 border-orange-400 -mb-px'
                  : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-auto">
        <List
          items={items}
          selectedId={selected}
          onSelect={setSelected}
          onHover={handleHover}
          onContextMenu={(id, e) => {
            setSelected(id)
            openContextMenu(e, contextItemsFor(id))
          }}
          empty={`No ${spec.pluralLabel.toLowerCase()} in this scope.`}
        />
      </div>
    </section>
  )
}

