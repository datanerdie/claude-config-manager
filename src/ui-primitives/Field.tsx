import type { ReactNode } from 'react'

interface Props {
  label: string
  hint?: string
  error?: string
  children: ReactNode
}

export function Field({ label, hint, error, children }: Props) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] uppercase tracking-wide text-zinc-500">
        {label}
      </label>
      {children}
      {hint && !error && <div className="text-xs text-zinc-600">{hint}</div>}
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  )
}
