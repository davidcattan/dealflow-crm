'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { zipSync } from 'fflate'
import { readJsonResponse } from '@/lib/fetch-json'
import { ConfirmButton } from '@/components/confirm-button'
import { DOC_CATEGORIES } from '@/lib/documents/categories'
import type { DocTriage } from '@/lib/types'
import { deleteDocument, deleteDocuments, moveDocuments, setDocumentGroup } from './actions'
import { MoveToDeal, type DealChoice } from './move-to-deal'

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

type SelectHandlers = {
  selected: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onPointerEnter: () => void
}

function DocRow({
  dealId,
  doc,
  lenders,
  deals,
  select,
}: {
  dealId: string
  doc: GroupedDoc
  lenders: { id: string; name: string }[]
  deals: DealChoice[]
  select: SelectHandlers
}) {
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
    <li
      onPointerEnter={select.onPointerEnter}
      className={`flex flex-col gap-1.5 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${select.selected ? 'bg-sky-50' : ''}`}
    >
      <div className="flex min-w-0 items-start gap-2">
      {/* Press here and drag over other rows to select several. */}
      <span
        onPointerDown={select.onPointerDown}
        className="-my-1 -ml-1 flex cursor-pointer select-none items-center px-1 py-1.5"
        title="Select — press and drag to select several"
      >
        <input type="checkbox" checked={select.selected} readOnly tabIndex={-1} className="pointer-events-none rounded border-slate-300" />
      </span>
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
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:pl-7">
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
        <MoveToDeal kind="document" dealId={dealId} itemId={doc.id} deals={deals} />
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
// each a folder you open. All start closed.
// Every document on the deal as one zip: "<Deal name>/<Group>/<file>".
function DownloadAll({ dealId, dealName }: { dealId: string; dealName: string }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setError(null)
    setBusy('Getting files…')
    try {
      const res = await fetch(`/api/deals/${dealId}/documents/all`)
      const result = await readJsonResponse<{ files: { name: string; group: string; url: string | null }[] }>(res)
      if (!result.ok) throw new Error(result.message)
      const top = dealName.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Deal'
      const entries: Record<string, Uint8Array> = {}
      let done = 0
      for (const f of result.body.files) {
        setBusy(`Downloading ${++done} of ${result.body.files.length}…`)
        if (!f.url) continue
        const r = await fetch(f.url)
        if (!r.ok) continue
        const folder = `${top}/${f.group.replace(/[\\/:*?"<>|]+/g, '-')}`
        let path = `${folder}/${f.name}`
        for (let n = 2; entries[path]; n++) path = `${folder}/${n}-${f.name}`
        entries[path] = new Uint8Array(await r.arrayBuffer())
      }
      if (!Object.keys(entries).length) throw new Error('No files to download.')
      setBusy('Zipping…')
      const blob = new Blob([zipSync(entries, { level: 0 }) as BlobPart], { type: 'application/zip' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${top}.zip`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <button type="button" onClick={run} disabled={Boolean(busy)} className="font-medium text-slate-700 hover:underline disabled:opacity-60">
        {busy ?? '⬇ Download all'}
      </button>
      {error && <span className="text-red-600">{error}</span>}
    </>
  )
}

export function DocumentGroups({
  dealId,
  dealName,
  docs: rawDocs,
  lenders,
  deals,
}: {
  dealId: string
  dealName: string
  docs: GroupedDoc[]
  lenders: { id: string; name: string }[]
  deals: DealChoice[]
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

  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())

  // Selecting several documents: click a checkbox, shift-click for a range,
  // or press on a checkbox and drag over other rows.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const drag = useRef<{ adding: boolean } | null>(null)
  const lastClicked = useRef<string | null>(null)
  const [bulkPending, startBulk] = useTransition()
  const [bulkError, setBulkError] = useState<string | null>(null)
  const ordered = groups.flatMap((g) => (openGroups.has(g.name) ? g.docs.map((d) => d.id) : []))

  useEffect(() => {
    const end = () => {
      drag.current = null
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointerup', end)
    return () => window.removeEventListener('pointerup', end)
  }, [])

  const setOne = (id: string, on: boolean) =>
    setSelected((s) => {
      if (s.has(id) === on) return s
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const handlersFor = (id: string): SelectHandlers => ({
    selected: selected.has(id),
    onPointerDown: (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      if (e.shiftKey && lastClicked.current) {
        const a = ordered.indexOf(lastClicked.current)
        const b = ordered.indexOf(id)
        if (a >= 0 && b >= 0) {
          const range = ordered.slice(Math.min(a, b), Math.max(a, b) + 1)
          setSelected((s) => new Set([...s, ...range]))
          return
        }
      }
      const adding = !selected.has(id)
      drag.current = { adding }
      lastClicked.current = id
      document.body.style.userSelect = 'none'
      setOne(id, adding)
    },
    onPointerEnter: () => {
      if (drag.current) setOne(id, drag.current.adding)
    },
  })

  // Only documents still on this deal (one may have been moved or deleted).
  const selectedIds = docs.filter((d) => selected.has(d.id)).map((d) => d.id)
  function bulkMove(category: string) {
    setBulkError(null)
    startBulk(async () => {
      const res = await moveDocuments(dealId, selectedIds, category)
      if (res && 'error' in res && res.error) setBulkError(res.error)
      else {
        setSelected(new Set())
        setOpenGroups((s) => new Set([...s, category]))
      }
    })
  }
  function bulkDelete() {
    if (!confirm(`Delete ${selectedIds.length} document${selectedIds.length === 1 ? '' : 's'}? This cannot be undone.`)) return
    setBulkError(null)
    startBulk(async () => {
      const res = await deleteDocuments(dealId, selectedIds)
      if (res && 'error' in res && res.error) setBulkError(res.error)
      else setSelected(new Set())
    })
  }
  const toggle = (name: string) =>
    setOpenGroups((s) => {
      const next = new Set(s)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  return (
    <div className="space-y-2">
      {selectedIds.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 shadow-sm">
          <span className="font-medium">
            {selectedIds.length} selected
          </span>
          <select
            value=""
            disabled={bulkPending}
            onChange={(e) => e.target.value && bulkMove(e.target.value)}
            className="rounded border border-sky-200 bg-white px-1.5 py-1 text-xs text-slate-700"
            aria-label="Move selected to group"
          >
            <option value="">Move to…</option>
            {DOC_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button type="button" onClick={bulkDelete} disabled={bulkPending} className="rounded border border-red-200 bg-white px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-50">
            Delete
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto hover:underline">
            Clear
          </button>
          {bulkPending && <span>Working…</span>}
          {bulkError && <span className="text-red-600">{bulkError}</span>}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-slate-500">
        {dupCount > 0 && (
          <span className="mr-auto rounded bg-amber-50 px-2 py-0.5 text-amber-800">
            {dupCount} duplicate upload{dupCount === 1 ? '' : 's'} — marked below, safe to delete
          </span>
        )}
        <DownloadAll dealId={dealId} dealName={dealName} />
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
            <div className="flex items-center">
            <label className="flex cursor-pointer items-center py-2.5 pl-3" title="Select everything in this group">
              <input
                type="checkbox"
                checked={g.docs.every((d) => selected.has(d.id))}
                onChange={(e) => {
                  const on = e.target.checked
                  setSelected((s) => {
                    const next = new Set(s)
                    for (const d of g.docs) {
                      if (on) next.add(d.id)
                      else next.delete(d.id)
                    }
                    return next
                  })
                  if (on) setOpenGroups((s) => new Set([...s, g.name]))
                }}
                className="rounded border-slate-300"
              />
            </label>
            <button
              type="button"
              onClick={() => toggle(g.name)}
              className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-slate-50"
            >
              <span className={`text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
              <span className="font-medium text-slate-800">{g.name}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{g.docs.length}</span>
              {lendersHere.length > 0 && <span className="truncate text-xs text-slate-400">{lendersHere.join(', ')}</span>}
            </button>
            </div>
            {open && (
              <ul className="divide-y divide-slate-100 border-t border-slate-100 px-3">
                {g.docs.map((d) => (
                  <DocRow key={d.id} dealId={dealId} doc={d} lenders={lenders} deals={deals} select={handlersFor(d.id)} />
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
