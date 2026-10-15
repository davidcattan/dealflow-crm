'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PROSPECT_STATUSES, PROSPECT_STATUS_COLORS, PROSPECT_STATUS_LABELS, type Prospect, type ProspectStatus } from '@/lib/prospects/types'
import { importProspects, setProspectStatus } from './actions'
import { prospectEmail } from '@/lib/prospects/email'
import { readJsonResponse } from '@/lib/fetch-json'

function ImportList() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <button type="button" onClick={() => {
          setOpen((v) => !v)
          setResult(null)
        }} className="text-sm font-medium text-slate-700 hover:underline">
        {open ? 'Close import' : '+ Import a list'}
      </button>
      {result && <p className={`mt-1 text-xs ${result.startsWith('Imported') ? 'text-emerald-700' : 'text-red-600'}`}>{result}</p>}
      {open && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault()
            const form = e.currentTarget
            const file = (form.elements.namedItem('file') as HTMLInputElement).files?.[0]
            if (!file) return setResult('Pick a CSV file first.')
            start(async () => {
              const res = await importProspects(await file.text(), source)
              if ('error' in res && res.error) setResult(res.error)
              else if ('added' in res) {
                setResult(
                  `Imported "${source.trim() || 'list'}": added ${res.added} new ${res.added === 1 ? 'person' : 'people'}${res.updated ? `, updated ${res.updated} already here` : ''}.`
                )
                // Done: clear the form and fold it away.
                form.reset()
                setSource('')
                setOpen(false)
                router.refresh()
              }
            })
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            File (Outreach list.csv, or an Apollo export)
            <input name="file" type="file" accept=".csv,text/csv" className="text-sm text-slate-700" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Which list
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g. ABL Advisor 2023"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button disabled={pending} className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            {pending ? 'Importing…' : 'Import'}
          </button>
          <p className="w-full text-xs text-slate-400">
            Nobody is added twice (matched by email). People already here keep their status, except &quot;Not contacted&quot; ones the file
            marks as emailed.
          </p>
        </form>
      )}
    </div>
  )
}

function StatusSelect({ p }: { p: Prospect }) {
  const [pending, start] = useTransition()
  return (
    <select
      value={p.status}
      disabled={pending}
      onChange={(e) => start(async () => void (await setProspectStatus(p.id, e.target.value)))}
      className={`rounded-full border-0 px-2 py-0.5 text-xs font-medium ${PROSPECT_STATUS_COLORS[p.status]}`}
    >
      {PROSPECT_STATUSES.map((s) => (
        <option key={s} value={s}>
          {PROSPECT_STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  )
}

// Creates the approved cold email for these people in your Outlook Drafts.
function useDrafts() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  async function create(ids: string[]) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/prospects/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const result = await readJsonResponse<{ created: number; skipped: string[]; mailbox: string }>(res)
      if (!result.ok) throw new Error(result.message)
      const { created, skipped, mailbox } = result.body
      setMessage(
        `${created} draft${created === 1 ? '' : 's'} in ${mailbox}'s Outlook Drafts — review and send from there.${skipped.length ? ` Skipped: ${skipped.join(', ')}.` : ''}`
      )
      return true
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not create the drafts')
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, message, create }
}

function Preview({ p, onClose }: { p: Prospect; onClose: () => void }) {
  const { subject, body } = prospectEmail(p)
  return (
    <tr>
      <td colSpan={6} className="bg-slate-50 px-4 py-3">
        <div className="max-w-2xl space-y-1 text-sm text-slate-700">
          <p>
            <span className="font-medium">To:</span> {p.email}
          </p>
          <p>
            <span className="font-medium">Subject:</span> {subject}
          </p>
          <p className="whitespace-pre-wrap">{body}</p>
          <p className="text-xs text-slate-400">+ your JED signature</p>
          <button type="button" onClick={onClose} className="text-xs text-slate-500 underline">
            Close preview
          </button>
        </div>
      </td>
    </tr>
  )
}

export function ProspectsTable({ prospects }: { prospects: Prospect[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [previewId, setPreviewId] = useState<string | null>(null)
  const drafts = useDrafts()
  // Click a checkbox to select; press and drag down the checkboxes to select
  // several; shift-click for everything in between.
  const drag = useRef<{ adding: boolean } | null>(null)
  const lastClicked = useRef<string | null>(null)
  useEffect(() => {
    const end = () => {
      drag.current = null
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointerup', end)
    return () => window.removeEventListener('pointerup', end)
  }, [])
  const setOne = (id: string, on: boolean) =>
    setPicked((s) => {
      if (s.has(id) === on) return s
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const [filter, setFilter] = useState<ProspectStatus | 'all'>('all')
  const [q, setQ] = useState('')
  // Each imported list ("ABL Advisor 2021–2022", "ABL Advisor 2023"…).
  const [list, setList] = useState<string>('all')
  const NO_LIST = '(no list name)'
  const lists = useMemo(() => {
    const c = new Map<string, number>()
    for (const p of prospects) c.set(p.source || NO_LIST, (c.get(p.source || NO_LIST) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [prospects])
  const inList = list === 'all' ? prospects : prospects.filter((p) => (p.source || NO_LIST) === list)
  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const p of inList) c.set(p.status, (c.get(p.status) ?? 0) + 1)
    return c
  }, [inList])
  const companies = new Set(inList.map((p) => p.company)).size

  const shown = inList.filter((p) => {
    if (filter !== 'all' && p.status !== filter) return false
    if (!q.trim()) return true
    const hay = [p.company, p.company_display, p.first_name, p.last_name, p.email, p.title, p.lender, p.source].join(' ').toLowerCase()
    return hay.includes(q.trim().toLowerCase())
  })

  return (
    <div className="space-y-3">
      <ImportList />
      {(picked.size > 0 || drafts.message) && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 shadow-sm">
          {picked.size > 0 && (
            <>
              <span className="font-medium">{picked.size} selected</span>
              <button
                type="button"
                disabled={drafts.busy}
                onClick={async () => {
                  if (await drafts.create([...picked])) setPicked(new Set())
                }}
                className="rounded-md bg-slate-900 px-2.5 py-1 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {drafts.busy ? 'Creating drafts…' : `Create ${picked.size} Outlook draft${picked.size === 1 ? '' : 's'}`}
              </button>
              <button type="button" onClick={() => setPicked(new Set())} className="hover:underline">
                Clear
              </button>
            </>
          )}
          {drafts.message && <span className="basis-full text-slate-700">{drafts.message}</span>}
        </div>
      )}
      {lists.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 text-sm">
          {[['all', prospects.length] as [string, number], ...lists].map(([name, n]) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                setList(name)
                setPicked(new Set())
              }}
              className={`-mb-px border-b-2 px-3 py-1.5 ${list === name ? 'border-slate-900 font-medium text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            >
              {name === 'all' ? 'All lists' : name} <span className="text-xs text-slate-400">{n}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`rounded-full px-2.5 py-1 ${filter === 'all' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
        >
          All {inList.length} · {companies} companies
        </button>
        {PROSPECT_STATUSES.filter((s) => counts.get(s)).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded-full px-2.5 py-1 ${filter === s ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
          >
            {PROSPECT_STATUS_LABELS[s]} {counts.get(s)}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search company, name, lender…"
          className="ml-auto w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm sm:w-64"
        />
      </div>
      {prospects.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          No prospects yet — import your Outreach list above.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select everyone shown"
                    checked={shown.length > 0 && shown.every((p) => picked.has(p.id))}
                    onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((p) => p.id)) : new Set())}
                    className="rounded border-slate-300"
                  />
                </th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Contact</th>
                <th className="px-3 py-2 font-medium">Their facility</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Latest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((p) => [
                <tr
                  key={p.id}
                  onPointerEnter={() => drag.current && setOne(p.id, drag.current.adding)}
                  className={`align-top ${picked.has(p.id) ? 'bg-sky-50' : ''}`}
                >
                  <td
                    onPointerDown={(e) => {
                      if (e.button !== 0) return
                      e.preventDefault()
                      if (e.shiftKey && lastClicked.current) {
                        const ids = shown.map((x) => x.id)
                        const a = ids.indexOf(lastClicked.current)
                        const b = ids.indexOf(p.id)
                        if (a >= 0 && b >= 0) {
                          setPicked((s) => new Set([...s, ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)]))
                          return
                        }
                      }
                      const adding = !picked.has(p.id)
                      drag.current = { adding }
                      lastClicked.current = p.id
                      document.body.style.userSelect = 'none'
                      setOne(p.id, adding)
                    }}
                    title="Select — press and drag down to select several"
                    className="cursor-pointer select-none px-3 py-2"
                  >
                    <input type="checkbox" checked={picked.has(p.id)} readOnly tabIndex={-1} className="pointer-events-none rounded border-slate-300" />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{p.company_display || p.company}</div>
                    {p.source && <div className="text-xs text-slate-400">{p.source}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-slate-800">{[p.first_name, p.last_name].filter(Boolean).join(' ') || '—'}</div>
                    <div className="text-xs text-slate-500">{p.title}</div>
                    <a href={`mailto:${p.email}`} className="text-xs text-slate-500 underline [overflow-wrap:anywhere]">
                      {p.email}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {[p.amount, p.lender].filter(Boolean).join(' · ')}
                    {p.deal_year && <span className="text-slate-400"> ({p.deal_year})</span>}
                  </td>
                  <td className="px-3 py-2">
                    <StatusSelect p={p} />
                    {p.deal_id && (
                      <Link href={`/deals/${p.deal_id}`} className="mt-1 block text-xs text-emerald-700 underline">
                        Open deal
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {p.reply_summary ? (
                      <span>
                        <span className="text-slate-400">{p.replied_at ? new Date(p.replied_at).toLocaleDateString() : ''} </span>
                        {p.reply_summary}
                      </span>
                    ) : p.last_emailed_at ? (
                      `Emailed ${new Date(p.last_emailed_at).toLocaleDateString()}`
                    ) : (
                      '—'
                    )}
                    {p.notes && <div className="mt-1 whitespace-pre-wrap text-slate-400">{p.notes}</div>}
                    <div className="mt-1 flex gap-3">
                      <button type="button" onClick={() => setPreviewId(previewId === p.id ? null : p.id)} className="text-slate-500 underline">
                        Preview email
                      </button>
                      <button type="button" disabled={drafts.busy} onClick={() => drafts.create([p.id])} className="text-slate-700 underline disabled:opacity-50">
                        Draft in Outlook
                      </button>
                    </div>
                  </td>
                </tr>,
                previewId === p.id ? <Preview key={`${p.id}-preview`} p={p} onClose={() => setPreviewId(null)} /> : null,
              ])}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
