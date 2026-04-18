import type { ReactNode } from 'react'

interface Props {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
}

export function Inspector({ title, subtitle, actions, children }: Props) {
  return (
    <div className="flex flex-col h-full">
      {(title || actions) && (
        <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div className="min-w-0">
            {title && <div className="text-sm font-medium truncate">{title}</div>}
            {subtitle && (
              <div className="text-xs text-zinc-500 truncate">{subtitle}</div>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className="flex-1 overflow-auto px-5 py-4 space-y-5">{children}</div>
    </div>
  )
}
