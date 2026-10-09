'use client'

import { useState, useTransition } from 'react'
import { editDealUpdate, removeDealUpdate } from './actions'

// One line in a deal's Updates log, with Edit and Delete.
export function UpdateRow({
  dealId,
  update,
  lenderName,
}: {
  dealId: string
  update: { id: string; note: string; entry_date: string | null; created_at: string }
  lenderName: string | null
}) {
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(update.note)
  const [date, setDate] = useState(update.entry_date ?? update.created_at.slice(0, 10))
  const [pending, startTransition] = useTransition()
  const shownDate = update.entry_date
    ? new Date(`${update.entry_date}T00:00:00`).toLocaleDateString()
    : new Date(update.created_at).toLocaleDateString()

  if (editing) {
    return (
      <li data-enter-save className="space-y-2 py-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={Math.min(6, Math.max(2, Math.ceil(note.length / 90)))}
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            data-save
            disabled={pending || !note.trim()}
            onClick={() =>
              startTransition(async () => {
                await editDealUpdate(dealId, update.id, note, date)
                setEditing(false)
              })
            }
            className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setNote(update.note)
              setEditing(false)
            }}
            className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </li>
    )
  }

  // Phones: one line each; tap to read the rest (and get Edit / Delete).
  return (
    <li className="flex items-start justify-between gap-3 py-3 text-sm max-sm:flex-col max-sm:gap-1.5 max-sm:py-2.5">
      <div className={`min-w-0 max-sm:w-full max-sm:cursor-pointer ${open ? '' : 'max-sm:line-clamp-1'}`} onClick={() => setOpen((v) => !v)}>
        <span className="mr-2 font-medium text-slate-700">{shownDate}</span>
        {lenderName && <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{lenderName}</span>}
        <span className="whitespace-pre-line text-slate-600 [overflow-wrap:anywhere]">{update.note}</span>
      </div>
      <div className={`flex shrink-0 gap-3 text-xs ${open ? '' : 'max-sm:hidden'}`}>
        <button type="button" onClick={() => setEditing(true)} className="text-slate-500 hover:underline">
          Edit
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (confirm('Delete this update? This cannot be undone.')) startTransition(() => removeDealUpdate(dealId, update.id))
          }}
          className="text-red-500 hover:underline disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </li>
  )
}
