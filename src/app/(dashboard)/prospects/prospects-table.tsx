'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PROSPECT_STATUSES, PROSPECT_STATUS_COLORS, PROSPECT_STATUS_LABELS, type Prospect, type ProspectStatus } from '@/lib/prospects/types'
import { importProspects, setProspectStatus } from './actions'

function ImportList() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-sm font-medium text-slate-700 hover:underline">
        {open ? 'Close import' : '+ Import a list'}
      </button>
      {open && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault()
            const file = (e.currentTarget.elements.namedItem('file') as HTMLInputElement).files?.[0]
            if (!file) return setResult('Pick a CSV file first.')
            start(async () => {
              const res = await importProspects(await file.text(), source)
              if ('error' in res && res.error) setResult(res.error)
              else if ('added' in res) {
                setResult(`Added ${res.added} new ${res.added === 1 ? 'person' : 'people'}${res.updated ? `, refreshed ${res.updated} already here` : ''}.`)
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
          {result && <p className="w-full text-xs text-slate-600">{result}</p>}
          <p className="w-full text-xs text-slate-400">People already here (same email) keep their status — nobody is added twice.</p>
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

export function ProspectsTable({ prospects }: { prospects: Prospect[] }) {
  const [filter, setFilter] = useState<ProspectStatus | 'all'>('all')
  const [q, setQ] = useState('')
  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const p of prospects) c.set(p.status, (c.get(p.status) ?? 0) + 1)
    return c
  }, [prospects])
  const companies = new Set(prospects.map((p) => p.company)).size

  const shown = prospects.filter((p) => {
    if (filter !== 'all' && p.status !== filter) return false
    if (!q.trim()) return true
    const hay = [p.company, p.company_display, p.first_name, p.last_name, p.email, p.title, p.lender, p.source].join(' ').toLowerCase()
    return hay.includes(q.trim().toLowerCase())
  })

  return (
    <div className="space-y-3">
      <ImportList />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`rounded-full px-2.5 py-1 ${filter === 'all' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
        >
          All {prospects.length} · {companies} companies
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
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Contact</th>
                <th className="px-3 py-2 font-medium">Their facility</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Latest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((p) => (
                <tr key={p.id} className="align-top">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
