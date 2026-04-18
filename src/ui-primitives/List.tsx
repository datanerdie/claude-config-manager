import type { MouseEvent, ReactNode } from 'react'
import { cn } from './util'

interface Item {
  id: string
  label: ReactNode
  sublabel?: ReactNode
  badge?: ReactNode
  error?: boolean
}

interface Props {
  items: Item[]
  selectedId: string | null
  onSelect: (id: string) => void
  onHover?: (id: string) => void
  onContextMenu?: (id: string, event: MouseEvent) => void
  empty?: ReactNode
}

export function List({ items, selectedId, onSelect, onHover, onContextMenu, empty }: Props) {
  if (items.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-zinc-600">
        {empty ?? 'Nothing here yet.'}
      </div>
    )
  }
  return (
    <ul className="py-1">
      {items.map((it) => (
        <li key={it.id}>
          <button
            onClick={() => onSelect(it.id)}
            onMouseEnter={onHover ? () => onHover(it.id) : undefined}
            onContextMenu={(e) => onContextMenu?.(it.id, e)}
            className={cn(
              'w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-zinc-900 border-l-2 border-transparent',
              selectedId === it.id && 'bg-zinc-900 border-orange-400',
              it.error && 'text-red-400',
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="truncate">{it.label}</div>
              {it.sublabel && (
                <div className="truncate text-xs text-zinc-500">{it.sublabel}</div>
              )}
            </div>
            {it.badge}
          </button>
        </li>
      ))}
    </ul>
  )
}
