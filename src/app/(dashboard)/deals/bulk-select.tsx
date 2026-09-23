'use client'

import { useEffect, useState } from 'react'
import { markDealsDead } from './actions'

const boxes = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[name="deal_ids"]'))

// Header checkbox: selects/deselects every deal row on the page.
export function SelectAllCheckbox() {
  return (
    <input
      type="checkbox"
      aria-label="Select all deals"
      className="rounded border-slate-300"
      onChange={(e) => {
        boxes().forEach((b) => (b.checked = e.target.checked))
        document.dispatchEvent(new Event('bulk-select-change'))
      }}
    />
  )
}

// Appears once one or more rows are checked. Row checkboxes are plain
// inputs (name="deal_ids", form="bulk-form") rendered by the server page.
export function BulkDeadBar() {
  const [count, setCount] = useState(0)
  const [viewOnly, setViewOnly] = useState(false)

  useEffect(() => {
    const update = () => setCount(boxes().filter((b) => b.checked).length)
    document.addEventListener('change', update)
    document.addEventListener('bulk-select-change', update)
    return () => {
      document.removeEventListener('change', update)
      document.removeEventListener('bulk-select-change', update)
    }
  }, [])

  // "View selected" hides every unchecked row. Re-applied whenever the
  // selection changes; rows are plain server-rendered <tr>s, so this
  // toggles their hidden attribute directly.
  useEffect(() => {
    const showOnly = viewOnly && count > 0
    boxes().forEach((b) => {
      const row = b.closest('tr')
      if (row) row.hidden = showOnly && !b.checked
    })
  }, [viewOnly, count])

  function setAll(checked: boolean) {
    boxes().forEach((b) => (b.checked = checked))
    document.dispatchEvent(new Event('bulk-select-change'))
    if (!checked) setViewOnly(false)
  }

  if (count === 0) return <form id="bulk-form" />

  return (
    <form
      id="bulk-form"
      action={async (formData) => {
        await markDealsDead(formData)
        boxes().forEach((b) => (b.checked = false))
        setCount(0)
        setViewOnly(false)
      }}
      onSubmit={(e) => {
        if (!confirm(`Mark ${count} deal${count === 1 ? '' : 's'} as dead?`)) e.preventDefault()
      }}
      className="flex items-center gap-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
    >
      <span className="text-slate-700">{count} selected</span>
      <button
        type="button"
        onClick={() => setViewOnly((v) => !v)}
        className="rounded-md border border-slate-300 bg-white px-3 py-1 text-slate-700 hover:bg-slate-100"
      >
        {viewOnly ? 'View all' : 'View selected'}
      </button>
      <button
        type="button"
        onClick={() => setAll(true)}
        className="text-slate-600 underline hover:text-slate-900"
      >
        Select all
      </button>
      <button
        type="button"
        onClick={() => setAll(false)}
        className="text-slate-600 underline hover:text-slate-900"
      >
        Unselect all
      </button>
      <button
        type="submit"
        className="rounded-md border border-red-200 bg-white px-3 py-1 text-red-600 hover:bg-red-50"
      >
        Mark as dead
      </button>
    </form>
  )
}
