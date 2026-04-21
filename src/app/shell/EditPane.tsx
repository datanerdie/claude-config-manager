import { useMemo, useEffect, useState, useRef } from 'react'
import { useStore } from '@/app/store'
import { descriptorFor } from '@/ui-descriptors'
import { Inspector, cn, FilePath, type ContextMenuItem } from '@/ui-primitives'
import type { AnyEntity, Entity, Scope } from '@/ontology'
import { kindSpecs } from '@/ontology'
import { referencesFrom, referrersOf, kindParticipatesInRefs, type Reference } from '@/engine'
import { countTokens, displayEntityPath } from '@/adapters'

const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `~${(n / 1_000_000).toFixed(1)}m` : n >= 1_000 ? `~${(n / 1_000).toFixed(1)}k` : `~${n}`
import { copyMoveTargets, type ScopeTarget } from './targets'

export function EditPane() {
  const kind = useStore((s) => s.kind)
  const selectedId = useStore((s) => s.selectedId)
  const entities = useStore((s) => s.entities)
  const refs = useStore((s) => s.refs)
  const projects = useStore((s) => s.projects)
  const updateEntity = useStore((s) => s.updateEntity)
  const deleteExisting = useStore((s) => s.deleteExisting)
  const copyToScope = useStore((s) => s.copyToScope)
  const moveToScope = useStore((s) => s.moveToScope)
  const createIn = useStore((s) => s.createIn)
  const home = useStore((s) => s.home)
  const scope = useStore((s) => s.scope)
  // Subscribe to pendingOps so descriptor.customActions re-renders when an op
  // starts/finishes — keeps header buttons reactive (spinner, disabled state).
  useStore((s) => s.pendingOps)
  const apiKey = useStore((s) => s.settings.anthropic.apiKey)
  const [tokenCount, setTokenCount] = useState<number | null>(null)
  const tokenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const entity = useMemo<Entity<any> | null>(() => {
    if (!selectedId) return null
    const list = (entities as any)[kind] as Entity<any>[]
    return list.find((e) => e.id === selectedId) ?? null
  }, [entities, kind, selectedId])

  useEffect(() => {
    setTokenCount(null)
    if (!entity || !entity.raw || entity.kind === 'conversation') return
    if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current)
    tokenTimerRef.current = setTimeout(() => {
      countTokens(entity.raw, apiKey).then(setTokenCount)
    }, 500)
    return () => {
      if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current)
    }
  }, [entity?.id, apiKey])

  if (!entity) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
        Select something on the left, or press <Kbd>⌘K</Kbd> for actions.
      </div>
    )
  }

  const descriptor = descriptorFor(entity.kind)
  const Editor = descriptor.Editor
  const spec = kindSpecs[entity.kind]
  const readOnly = spec.readOnly ?? false
  const canScopeMove = !readOnly || (spec.allowScopeMove ?? false)
  const canDelete = !readOnly && (descriptor.canDelete ? descriptor.canDelete(entity.value) : true)

  const incoming = referrersOf(entity.id, refs)
  const outgoing = referencesFrom(entity.id, refs)
  const allEntities = Object.values(entities).flat() as AnyEntity[]
  const showRefs = kindParticipatesInRefs(entity.kind) && (incoming.length > 0 || outgoing.length > 0)

  const targets = copyMoveTargets(entity, projects)
  const actionCtx = { scope, projects, home, createIn, remove: deleteExisting }
  const headerActions =
    descriptor.headerActions?.(entity, actionCtx) ??
    descriptor.customActions?.(entity, actionCtx) ??
    []

  return (
    <div className="flex-1 flex min-w-0">
      <div className="flex-1 min-w-0">
        <Inspector
          title={
            <span>
              {(descriptor.headerTitle
                ? descriptor.headerTitle(entity.value)
                : descriptor.listLabel(entity.value)) || entity.kind}
            </span>
          }
          subtitle={
            <span className="font-mono text-xs text-zinc-600 truncate flex items-center gap-2">
              {descriptor.headerSubtitle ? (
                <span className="truncate">{descriptor.headerSubtitle(entity.value)}</span>
              ) : (
                <FilePath path={entity.path} className="text-xs text-zinc-600 truncate">
                  {displayEntityPath(entity, home, projects)}
                </FilePath>
              )}
              {tokenCount !== null && (
                <span className="shrink-0 text-zinc-500">{fmtTokens(tokenCount)} tokens</span>
              )}
            </span>
          }
          actions={
            headerActions.length > 0 || canScopeMove || canDelete ? (
              <>
                {headerActions.map((a, i) => (
                  <HeaderActionButton key={i} item={a} />
                ))}
                {canScopeMove && (
                  <>
                    <ScopeActionMenu
                      label="Copy to…"
                      targets={targets}
                      onSelect={(target) => copyToScope(entity, target)}
                    />
                    <ScopeActionMenu
                      label="Move to…"
                      targets={targets}
                      onSelect={(target) => moveToScope(entity, target)}
                    />
                  </>
                )}
                {canDelete && (
                  <button
                    onClick={() => {
                      if (confirm('Delete this item?')) deleteExisting(entity)
                    }}
                    className="text-xs text-zinc-500 hover:text-red-400 px-2 py-1"
                  >
                    Delete
                  </button>
                )}
              </>
            ) : null
          }
        >
          {entity.error && (
            <div className="rounded bg-red-950/50 border border-red-900 text-red-300 text-xs p-3">
              Parse error: {entity.error}
            </div>
          )}
          <Editor
            value={entity.value}
            onChange={(next) => updateEntity(entity, next)}
            ctx={{
              knownAgents: allEntities
                .filter((e) => e.kind === 'agent')
                .map((e: any) => e.value.name),
              knownCommands: allEntities
                .filter((e) => e.kind === 'command')
                .map((e: any) => e.value.name),
            }}
          />
        </Inspector>
      </div>
      {showRefs && (
        <aside className="w-[240px] shrink-0 border-l border-zinc-800 overflow-auto bg-zinc-950">
          {incoming.length > 0 && (
            <div className="px-4 py-3 border-b border-zinc-800">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">Referenced by</div>
              <ul className="mt-2 space-y-1">
                {incoming.map((r, i) => (
                  <ReferenceRow key={`${r.from}-${i}`} r={r} label={labelForId(r.from, allEntities)} direction="in" />
                ))}
              </ul>
            </div>
          )}
          {outgoing.length > 0 && (
            <div className="px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">References</div>
              <ul className="mt-2 space-y-1">
                {outgoing.map((r, i) => (
                  <ReferenceRow key={`${r.to}-${i}`} r={r} label={`${r.kind}: ${r.name}`} direction="out" />
                ))}
              </ul>
            </div>
          )}
        </aside>
      )}
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-1 px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-xs font-mono">
      {children}
    </kbd>
  )
}

/**
 * Renders a descriptor's customAction as a small text button in the inspector
 * header. Same data shape (`ContextMenuItem`) drives the right-click menu —
 * one source of truth, two surfaces.
 */
function HeaderActionButton({ item }: { item: ContextMenuItem }) {
  const disabled = item.disabled || item.pending || item.submenu !== undefined
  const colorClass = item.destructive
    ? 'text-zinc-500 hover:text-red-400'
    : item.active
      ? 'text-emerald-400 hover:text-emerald-300'
      : 'text-zinc-400 hover:text-zinc-100'
  return (
    <button
      type="button"
      onClick={() => item.onSelect?.()}
      disabled={disabled}
      className={cn(
        'text-xs px-2 py-1 inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed',
        colorClass,
      )}
    >
      {item.pending ? (
        <span
          aria-hidden
          className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"
        />
      ) : (
        item.icon
      )}
      {item.label}
    </button>
  )
}

function ScopeActionMenu({
  label,
  targets,
  onSelect,
}: {
  label: string
  targets: ScopeTarget[]
  onSelect: (scope: Scope) => void
}) {
  if (targets.length === 0) return null
  return (
    <div className="relative group">
      <button className="text-xs text-zinc-400 hover:text-zinc-100 px-2 py-1">
        {label}
      </button>
      <div className="absolute right-0 top-full hidden group-hover:block z-40 min-w-[200px] bg-zinc-900 border border-zinc-700 rounded shadow-xl py-1">
        {targets.map((t, i) => (
          <button
            key={i}
            onClick={() => onSelect(t.scope)}
            className="block w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-800"
          >
            {t.name}
          </button>
        ))}
      </div>
    </div>
  )
}

function labelForId(id: string, all: AnyEntity[]): string {
  const e = all.find((x) => x.id === id)
  if (!e) return id
  const v: any = e.value
  return `${e.kind}: ${v.name ?? id}`
}

const sourceTag = (s: Reference['source']): string => {
  switch (s.kind) {
    case 'frontmatter': return s.field
    case 'import':      return 'import'
    case 'tool':        return 'tool'
    case 'matcher':     return 'matcher'
    case 'prose':       return 'prose'
  }
}

function ReferenceRow({ r, label, direction }: { r: Reference; label: string; direction: 'in' | 'out' }) {
  const tag = sourceTag(r.source)
  const color = r.broken ? 'text-red-400' : direction === 'out' && r.source.kind === 'prose' ? 'text-zinc-500' : 'text-zinc-300'
  return (
    <li className={cn('text-xs font-mono truncate flex items-center gap-2')} title={r.broken ? 'unresolved' : undefined}>
      <span className={cn('truncate flex-1', color)}>{label}</span>
      <span className="shrink-0 text-[10px] uppercase tracking-wider text-zinc-600">{tag}</span>
    </li>
  )
}
