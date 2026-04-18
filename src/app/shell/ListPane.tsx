import { useEffect, useMemo, useRef } from 'react'
import { useStore } from '@/app/store'
import { descriptorFor } from '@/ui-descriptors'
import { List, openContextMenu, prompt, type ContextMenuItem } from '@/ui-primitives'
import { kindSpecs, type Entity } from '@/ontology'
import { prefetchConversation } from '@/adapters'
import { copyMoveTargets } from './targets'

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

  const items = useMemo(() => {
    const q = search.toLowerCase().trim()
    const filtered = q
      ? entities.filter((e) => spec.searchText(e.value).includes(q))
      : entities
    return filtered.map((e) => ({
      id: e.id,
      label: descriptor.listLabel(e.value),
      sublabel: descriptor.listSublabel?.(e.value),
      badge: e.dirty ? <Dot /> : undefined,
      error: !!e.error,
    }))
  }, [entities, search, descriptor, spec])

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
    const canDelete = !entityReadOnly
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
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${spec.pluralLabel.toLowerCase()}…`}
          className="flex-1 bg-transparent outline-none px-2 py-1 text-sm placeholder:text-zinc-600"
        />
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

function Dot() {
  return <span className="w-1.5 h-1.5 rounded-full bg-orange-400 inline-block" />
}

