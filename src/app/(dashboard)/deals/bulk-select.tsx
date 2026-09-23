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

// Checkboxes stay hidden until "Select deals" is clicked, to keep the table
// clean. Row checkboxes are plain inputs (name="deal_ids", form="bulk-form")
// rendered by the server page inside #deals-table; their column (.sel-col)
// is shown/hidden through that table's data-select attribute.
export function BulkDeadBar() {
  const [selecting, setSelecting] = useState(false)
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

  useEffect(() => {
    document
      .getElementById('deals-table')
      ?.setAttribute('data-select', selecting ? 'on' : 'off')
  }, [selecting])

  // Drag-to-select: press on a row and drag over others to tick them all
  // (or untick, if the first row you pressed was already ticked). Each drag
  // adds to what's already selected, so you can drag several times.
  useEffect(() => {
    if (!selecting) return
    const rowBox = (el: EventTarget | null) => {
      const row = (el as HTMLElement | null)?.closest?.('tbody tr')
      return row?.querySelector<HTMLInputElement>('input[name="deal_ids"]') ?? null
    }
    let startBox: HTMLInputElement | null = null
    let target = true
    let startApplied = false

    const apply = (box: HTMLInputElement) => {
      if (box.checked !== target) {
        box.checked = target
        document.dispatchEvent(new Event('bulk-select-change'))
      }
    }
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const box = rowBox(e.target)
      if (!box || e.target === box) return // the checkbox itself works normally
      startBox = box
      target = !box.checked
      const onLink = (e.target as HTMLElement).closest('a')
      // Pressing a company link and releasing without dragging should still
      // just open the deal, so its row is only ticked once a drag begins.
      startApplied = !onLink
      if (!onLink) apply(box)
      e.preventDefault() // no text selection while dragging
    }
    const onOver = (e: MouseEvent) => {
      if (!startBox) return
      const box = rowBox(e.target)
      if (!box) return
      if (!startApplied && box !== startBox) {
        apply(startBox)
        startApplied = true
      }
      if (startApplied) apply(box)
    }
    const onUp = () => {
      startBox = null
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseup', onUp)
    }
  }, [selecting])

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

  function done() {
    setAll(false)
    setViewOnly(false)
    setSelecting(false)
  }

  if (!selecting) {
    return (
      <div className="flex justify-end">
        <form id="bulk-form" />
        <button
          type="button"
          onClick={() => setSelecting(true)}
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          Select deals
        </button>
      </div>
    )
  }

  return (
    <form
      id="bulk-form"
      action={async (formData) => {
        await markDealsDead(formData)
        done()
      }}
      onSubmit={(e) => {
        if (!confirm(`Mark ${count} deal${count === 1 ? '' : 's'} as dead?`)) e.preventDefault()
      }}
      className="flex flex-wrap items-center gap-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
    >
      <span className="text-slate-700">
        {count === 0 ? 'Tick deals, or click and drag across rows' : `${count} selected`}
      </span>
      <button
        type="button"
        onClick={() => setAll(true)}
        className="text-slate-600 underline hover:text-slate-900"
      >
        Select all
      </button>
      {count > 0 && (
        <>
          <button
            type="button"
            onClick={() => setAll(false)}
            className="text-slate-600 underline hover:text-slate-900"
          >
            Unselect all
          </button>
          <button
            type="button"
            onClick={() => setViewOnly((v) => !v)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-slate-700 hover:bg-slate-100"
          >
            {viewOnly ? 'View all' : 'View selected'}
          </button>
          <button
            type="submit"
            className="rounded-md border border-red-200 bg-white px-3 py-1 text-red-600 hover:bg-red-50"
          >
            Mark as dead
          </button>
        </>
      )}
      <button
        type="button"
        onClick={done}
        className="ml-auto rounded-md px-3 py-1 text-slate-500 hover:bg-slate-200"
      >
        Done
      </button>
    </form>
  )
}
