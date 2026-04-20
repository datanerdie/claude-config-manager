import { allKindsForScope, type Kind } from '@/ontology'
import { kindSpecs } from '@/ontology'
import { useStore } from '@/app/store'
import { cn, openScanDialog, openSettingsDialog, prompt } from '@/ui-primitives'
import { pickDirectory } from '@/adapters/dialog'
import { fs } from '@/adapters'
import { toast } from 'sonner'

export function Sidebar() {
  const scope = useStore((s) => s.scope)
  const projects = useStore((s) => s.projects)
  const kind = useStore((s) => s.kind)
  const home = useStore((s) => s.home)
  const setScope = useStore((s) => s.setScope)
  const setKind = useStore((s) => s.setKind)
  const addProject = useStore((s) => s.addProject)
  const removeProject = useStore((s) => s.removeProject)

  const handleAdd = async () => {
    const path = await pickDirectory()
    if (!path) return
    const name = await prompt('Project name (optional)', {
      initialValue: '',
      placeholder: path.split(/[\\/]/).pop() ?? '',
    })
    await addProject(path, name || undefined)
  }

  const handleScan = async () => {
    const root = await pickDirectory()
    if (!root) return
    await openScanDialog(root, (r) => fs.scanForProjects(r))
    toast.message('Scanning…', { description: root })
  }

  return (
    <aside className="w-[260px] shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-950">
      <div className="flex-1 overflow-auto">
        <div className="px-4 py-2 flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Scopes</div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleScan}
              className="text-zinc-500 hover:text-zinc-100 p-0.5"
              title="Scan a folder for projects"
            >
              <ScanIcon />
            </button>
            <button
              onClick={handleAdd}
              className="text-zinc-500 hover:text-zinc-100 px-1 text-base leading-none"
              title="Add a project"
            >
              +
            </button>
          </div>
        </div>
        <div>
          <ScopeItem
            name="global"
            path={home ? `${home.replace(/\\/g, '/')}/.claude` : undefined}
            active={scope.type === 'user'}
            onSelect={() => setScope({ type: 'user' })}
          />
          {projects.map((p) => (
            <ScopeItem
              key={p.id}
              name={p.name}
              path={p.path}
              muted={!p.exists}
              active={scope.type === 'project' && scope.projectId === p.id}
              onSelect={() => setScope({ type: 'project', projectId: p.id })}
              onRemove={() => removeProject(p)}
            />
          ))}
          {projects.length === 0 && (
            <div className="px-4 py-2 text-xs text-zinc-600">No projects.</div>
          )}
        </div>
      </div>
      <div className="border-t border-zinc-800 py-2">
        <div className="px-4 py-1 flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">
            Configuration
          </div>
          <button
            onClick={openSettingsDialog}
            className="text-zinc-500 hover:text-zinc-100 p-0.5"
            title="Settings"
            aria-label="Settings"
          >
            <GearIcon />
          </button>
        </div>
        {allKindsForScope(scope).map((k) => (
          <KindButton key={k} kind={k} active={kind === k} onClick={() => setKind(k)} />
        ))}
      </div>
    </aside>
  )
}

function GearIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function ScopeItem({
  name,
  path,
  active,
  muted,
  onSelect,
  onRemove,
}: {
  name: string
  path?: string
  active: boolean
  muted?: boolean
  onSelect: () => void
  onRemove?: () => void
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-1 pr-2 border-l-2',
        active ? 'bg-zinc-900 border-orange-400' : 'border-transparent hover:bg-zinc-900',
      )}
    >
      <button onClick={onSelect} className="flex-1 min-w-0 px-3 py-1.5 text-left">
        <div className={cn('text-sm truncate', muted && 'line-through text-zinc-500')}>
          {name}
        </div>
        {path && (
          <div className="text-[10px] text-zinc-500 font-mono truncate">{path}</div>
        )}
      </button>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 text-xs px-1"
          title="Remove from list"
        >
          ×
        </button>
      )}
    </div>
  )
}

function ScanIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

function KindButton({
  kind,
  active,
  onClick,
}: {
  kind: Kind
  active: boolean
  onClick: () => void
}) {
  const count = useStore((s) => (s.entities as any)[kind].length as number)
  const loading = useStore((s) => s.loadingKinds.has(kind))
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-4 py-1.5 text-sm flex items-center justify-between border-l-2',
        active
          ? 'bg-zinc-900 border-orange-400 text-zinc-100'
          : 'border-transparent text-zinc-300 hover:bg-zinc-900',
      )}
    >
      <span>{kindSpecs[kind].pluralLabel}</span>
      {loading ? <Spinner /> : <span className="text-xs text-zinc-500">{count}</span>}
    </button>
  )
}

function Spinner() {
  return (
    <svg
      className="animate-spin text-zinc-500"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      aria-label="loading"
    >
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
    </svg>
  )
}

