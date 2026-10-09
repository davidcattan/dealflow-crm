'use client'

import { useState, useTransition } from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { DOC_CATEGORIES } from '@/lib/documents/categories'
import type { DocTriage } from '@/lib/types'
import { deleteDocument, setDocumentGroup } from './actions'

export type GroupedDoc = {
  id: string
  file_name: string
  storage_path: string
  url: string | null
  size: string
  uploaded_at: string
  triage: DocTriage | null
  category: string
  lender: { id: string; name: string } | null
  // Same name and size as an earlier upload.
  duplicate?: boolean
}

const TERM_SHEETS = 'Term sheets & offers'

function DocRow({ dealId, doc, lenders }: { dealId: string; doc: GroupedDoc; lenders: { id: string; name: string }[] }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function move(category: string, lenderId: string | null) {
    setError(null)
    startTransition(async () => {
      const res = await setDocumentGroup(dealId, doc.id, category, lenderId)
      if (res && 'error' in res && res.error) setError(res.error)
    })
  }

  return (
    <li className="flex flex-col gap-1.5 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        {doc.url ? (
          <a href={doc.url} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-slate-800 hover:underline">
            {doc.file_name}
          </a>
        ) : (
          <span className="block truncate font-medium text-slate-800">{doc.file_name}</span>
        )}
        <p className="truncate text-xs text-slate-400">
          {doc.duplicate && (
            <span className="mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800" title="Same file as another upload — safe to delete">
              Duplicate
            </span>
          )}
          {doc.lender && <span className="mr-1.5 rounded bg-violet-50 px-1.5 py-0.5 font-medium text-violet-700">{doc.lender.name}</span>}
          {[doc.size, new Date(doc.uploaded_at).toLocaleDateString()].filter(Boolean).join(' · ')}
          {doc.triage && <span className="max-sm:hidden"> · {doc.triage.doc_type}</span>}
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <select
          value={doc.category}
          disabled={pending}
          onChange={(e) => move(e.target.value, e.target.value === TERM_SHEETS ? (doc.lender?.id ?? null) : null)}
          className="max-w-[11rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600"
          aria-label="Move to group"
        >
          {DOC_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c === doc.category ? c : `Move to ${c}`}
            </option>
          ))}
        </select>
        {doc.category === TERM_SHEETS && (
          <select
            value={doc.lender?.id ?? ''}
            disabled={pending}
            onChange={(e) => move(TERM_SHEETS, e.target.value || null)}
            className="max-w-[10rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600"
            aria-label="Which lender"
          >
            <option value="">Which lender?</option>
            {lenders.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <form action={deleteDocument}>
          <input type="hidden" name="deal_id" value={dealId} />
          <input type="hidden" name="document_id" value={doc.id} />
          <input type="hidden" name="storage_path" value={doc.storage_path} />
          <ConfirmButton confirmMessage={`Delete ${doc.file_name}? This cannot be undone.`} className="text-xs text-red-500 hover:underline">
            Delete
          </ConfirmButton>
        </form>
      </div>
    </li>
  )
}

// A deal's documents in groups (bank statements, tax returns, term sheets…),
// each a folder you open. Small sets start open.
export function DocumentGroups({
  dealId,
  docs: rawDocs,
  lenders,
}: {
  dealId: string
  docs: GroupedDoc[]
  lenders: { id: string; name: string }[]
}) {
  // Later copies of the same file (same name and size) are marked.
  const seenFiles = new Set<string>()
  const oldestFirst = [...rawDocs].sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at))
  const dupIds = new Set<string>()
  for (const d of oldestFirst) {
    const key = `${d.file_name.trim().toLowerCase()}|${d.size}`
    if (seenFiles.has(key)) dupIds.add(d.id)
    seenFiles.add(key)
  }
  const docs = rawDocs.map((d) => (dupIds.has(d.id) ? { ...d, duplicate: true } : d))
  const dupCount = dupIds.size

  const groups = DOC_CATEGORIES.map((c) => ({
    name: c,
    docs: docs
      .filter((d) => d.category === c)
      .sort((a, b) =>
        c === TERM_SHEETS
          ? (a.lender?.name ?? '~').localeCompare(b.lender?.name ?? '~') || b.uploaded_at.localeCompare(a.uploaded_at)
          : b.uploaded_at.localeCompare(a.uploaded_at)
      ),
  })).filter((g) => g.docs.length)
  // Anything with a group name from before this list existed.
  const known = new Set<string>(DOC_CATEGORIES)
  const stray = docs.filter((d) => !known.has(d.category))
  if (stray.length) groups.push({ name: 'Other', docs: stray } as (typeof groups)[number])

  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(docs.length <= 6 ? groups.map((g) => g.name) : []))
  const toggle = (name: string) =>
    setOpenGroups((s) => {
      const next = new Set(s)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-slate-500">
        {dupCount > 0 && (
          <span className="mr-auto rounded bg-amber-50 px-2 py-0.5 text-amber-800">
            {dupCount} duplicate upload{dupCount === 1 ? '' : 's'} — marked below, safe to delete
          </span>
        )}
        <button type="button" onClick={() => setOpenGroups(new Set(groups.map((g) => g.name)))} className="hover:underline">
          Open all
        </button>
        <button type="button" onClick={() => setOpenGroups(new Set())} className="hover:underline">
          Close all
        </button>
      </div>
      {groups.map((g) => {
        const open = openGroups.has(g.name)
        const lendersHere = g.name === TERM_SHEETS ? [...new Set(g.docs.map((d) => d.lender?.name).filter(Boolean))] : []
        return (
          <div key={g.name} className="rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => toggle(g.name)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-slate-50"
            >
              <span className={`text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
              <span className="font-medium text-slate-800">{g.name}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{g.docs.length}</span>
              {lendersHere.length > 0 && <span className="truncate text-xs text-slate-400">{lendersHere.join(', ')}</span>}
            </button>
            {open && (
              <ul className="divide-y divide-slate-100 border-t border-slate-100 px-3">
                {g.docs.map((d) => (
                  <DocRow key={d.id} dealId={dealId} doc={d} lenders={lenders} />
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
