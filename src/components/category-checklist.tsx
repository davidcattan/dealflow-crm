'use client'

import { useState } from 'react'

// A checkbox multi-select for a lender mandate field (asset types,
// industries, geographies) with a leading "All" option. Checking "All"
// clears every specific selection — an empty array already means "no
// restriction, matches anything" everywhere these fields are read, so
// "All" just IS the empty-selection state, not a stored value of its own.
// Selected values post as a single comma-joined hidden input, matching
// the existing toArray() parsing used server-side.
export function CategoryChecklist({
  name,
  categories,
  defaultValue,
  allLabel = 'All',
}: {
  name: string
  categories: readonly string[]
  defaultValue: string[]
  allLabel?: string
}) {
  const [selected, setSelected] = useState<string[]>(defaultValue)

  // An existing lender may have a value from before this taxonomy was
  // fixed (or before this field existed as a checklist at all) — show it
  // as its own checked option instead of silently dropping it the next
  // time the form saves.
  const nonStandard = defaultValue.filter((v) => !categories.includes(v))
  const allOptions = [...categories, ...nonStandard]

  function toggle(category: string) {
    setSelected((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    )
  }

  const isAll = selected.length === 0

  return (
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2 rounded-md border border-slate-300 px-3 py-2">
      <input type="hidden" name={name} value={selected.join(', ')} />
      <label className="flex items-center gap-1.5 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={isAll}
          onChange={() => setSelected([])}
          className="rounded border-slate-300"
        />
        {allLabel}
      </label>
      {allOptions.map((c) => (
        <label key={c} className="flex items-center gap-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={selected.includes(c)}
            onChange={() => toggle(c)}
            className="rounded border-slate-300"
          />
          {c}
        </label>
      ))}
    </div>
  )
}
