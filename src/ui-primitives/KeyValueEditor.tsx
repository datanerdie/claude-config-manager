import { InlineText } from './InlineText'

interface Props {
  value: Record<string, string>
  onChange: (v: Record<string, string>) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}

export function KeyValueEditor({ value, onChange, keyPlaceholder = 'KEY', valuePlaceholder = 'value' }: Props) {
  const entries = Object.entries(value)

  const setKey = (oldKey: string, newKey: string) => {
    if (!newKey || newKey === oldKey) return
    const { [oldKey]: v, ...rest } = value
    onChange({ ...rest, [newKey]: v ?? '' })
  }
  const setVal = (key: string, v: string) => onChange({ ...value, [key]: v })
  const remove = (key: string) => {
    const { [key]: _, ...rest } = value
    onChange(rest)
  }
  const add = () => onChange({ ...value, '': '' })

  return (
    <div className="space-y-1">
      {entries.map(([k, v], i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
          <InlineText
            value={k}
            onChange={(nk) => setKey(k, nk)}
            placeholder={keyPlaceholder}
            monospace
          />
          <InlineText
            value={v}
            onChange={(nv) => setVal(k, nv)}
            placeholder={valuePlaceholder}
            monospace
          />
          <button
            onClick={() => remove(k)}
            className="text-zinc-500 hover:text-red-400 px-2"
            aria-label="remove"
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="text-xs text-zinc-500 hover:text-zinc-300 mt-1"
      >
        + add
      </button>
    </div>
  )
}
