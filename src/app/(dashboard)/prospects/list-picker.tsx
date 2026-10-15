'use client'

import { useState } from 'react'

// Pick one of your existing lists, or "+ New list…" to type a new name.
export function ListPicker({
  lists,
  value,
  onChange,
  startNew = false,
}: {
  lists: string[]
  value: string
  onChange: (name: string) => void
  startNew?: boolean
}) {
  const [creating, setCreating] = useState(startNew || lists.length === 0)
  return (
    <div className="flex flex-col gap-1.5">
      <select
        value={creating ? '__new' : value}
        onChange={(e) => {
          if (e.target.value === '__new') {
            setCreating(true)
            onChange('')
          } else {
            setCreating(false)
            onChange(e.target.value)
          }
        }}
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
      >
        <option value="" disabled>
          Choose a list…
        </option>
        {lists.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
        <option value="__new">+ New list…</option>
      </select>
      {creating && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="New list name, e.g. Eli's list"
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      )}
    </div>
  )
}
