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

  useEffect(() => {
    const update = () => setCount(boxes().filter((b) => b.checked).length)
    document.addEventListener('change', update)
    document.addEventListener('bulk-select-change', update)
    return () => {
      document.removeEventListener('change', update)
      document.removeEventListener('bulk-select-change', update)
    }
  }, [])

  if (count === 0) return <form id="bulk-form" />

  return (
    <form
      id="bulk-form"
      action={async (formData) => {
        await markDealsDead(formData)
        boxes().forEach((b) => (b.checked = false))
        setCount(0)
      }}
      onSubmit={(e) => {
        if (!confirm(`Mark ${count} deal${count === 1 ? '' : 's'} as dead?`)) e.preventDefault()
      }}
      className="flex items-center gap-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
    >
      <span className="text-slate-700">{count} selected</span>
      <button
        type="submit"
        className="rounded-md border border-red-200 bg-white px-3 py-1 text-red-600 hover:bg-red-50"
      >
        Mark as dead
      </button>
    </form>
  )
}
