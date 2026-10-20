'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PROSPECT_STATUSES, PROSPECT_STATUS_COLORS, PROSPECT_STATUS_LABELS, type Prospect, type ProspectStatus } from '@/lib/prospects/types'
import { getProspectEmails, importProspects, setProspectStatus, type ProspectEmail } from './actions'
import { parseCsv } from '@/lib/prospects/csv'
import { readXlsx } from '@/lib/prospects/xlsx'
import { FIELD_LABELS, mapColumns, toPeople, type FieldKey, type ImportPerson } from '@/lib/prospects/columns'
import { prospectEmail, type ProspectTemplate } from '@/lib/prospects/email'
import { EmailTemplate } from './email-template'
import { readJsonResponse } from '@/lib/fetch-json'
import { FindProspects } from './find-prospects'
import { ListPicker } from './list-picker'

type Parsed = {
  fileName: string
  rows: number
  map: Partial<Record<FieldKey, string>>
  people: ImportPerson[]
  skipped: number
  companyFromEmail: number
}

function ImportList({ lists }: { lists: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // Read the file right away (CSV or Excel) and show what was found.
  async function readFile(file: File | undefined) {
    setParsed(null)
    setReadError(null)
    if (!file) return
    try {
      // An Excel file can have several tabs: use the one with the most
      // people (that has an email column).
      const sheets = /\.xlsx$/i.test(file.name) ? readXlsx(await file.arrayBuffer()) : [{ name: '', rows: parseCsv(await file.text()) }]
      const options = sheets
        .filter((sh) => sh.rows.length)
        .map((sh) => {
          const map = mapColumns(Object.keys(sh.rows[0]))
          return { sheet: sh.name, map, ...(map.email ? toPeople(sh.rows, map) : { people: [], skipped: sh.rows.length, companyFromEmail: 0 }), cols: Object.keys(sh.rows[0]) }
        })
        .sort((a, b) => b.people.length - a.people.length)
      const best = options[0]
      if (!best) throw new Error('That file looks empty.')
      if (!best.map.email || !best.people.length)
        throw new Error(`Couldn't find an email column. Columns in the file: ${best.cols.join(', ')}. Rename the email column to "Email" and try again.`)
      const { map, people, skipped, companyFromEmail } = best
      setParsed({ fileName: best.sheet ? `${file.name} (tab "${best.sheet}")` : file.name, rows: people.length + skipped, map, people, skipped, companyFromEmail })
      if (!source) setSource(file.name.replace(/\.(csv|xlsx)$/i, ''))
    } catch (err) {
      setReadError(err instanceof Error ? err.message : 'Could not read that file.')
    }
  }

  return (
    <div className={open ? 'w-full rounded-lg border border-slate-200 bg-white p-3' : ''}>
      <button type="button" onClick={() => {
          setOpen((v) => !v)
          setResult(null)
        }} className={open ? 'text-sm font-medium text-slate-700 hover:underline' : 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50'}>
        {open ? 'Close import' : '+ Import a list'}
      </button>
      {result && <p className={`mt-1 text-xs ${result.startsWith('Imported') ? 'text-emerald-700' : 'text-red-600'}`}>{result}</p>}
      {open && (
        <form
          className="mt-2 space-y-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault()
            if (!parsed?.people.length) return
            const form = e.currentTarget
            start(async () => {
              const res = await importProspects(parsed.people, source)
              if ('error' in res && res.error) setResult(res.error)
              else if ('added' in res) {
                setResult(
                  `Imported "${source.trim() || 'list'}": added ${res.added} new ${res.added === 1 ? 'person' : 'people'}${res.updated ? `, updated ${res.updated} already here` : ''}.`
                )
                // Done: clear the form and fold it away.
                form.reset()
                setParsed(null)
                setSource('')
                setOpen(false)
                router.refresh()
              }
            })
          }}
        >
          <div className="flex flex-wrap items-start gap-2">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              File: CSV or Excel, any column names
              <input
                name="file"
                type="file"
                accept=".csv,.xlsx,text/csv"
                onChange={(e) => readFile(e.target.files?.[0])}
                className="text-sm text-slate-700"
              />
            </label>
            <div className="flex flex-col gap-1 text-xs text-slate-500">
              Which list
              <ListPicker lists={lists} value={source} onChange={setSource} startNew />
            </div>
            <button
              disabled={pending || !parsed?.people.length}
              className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {pending ? 'Importing…' : parsed ? `Import ${parsed.people.length} ${parsed.people.length === 1 ? 'person' : 'people'}` : 'Import'}
            </button>
          </div>
          {readError && <p className="text-xs text-red-600">{readError}</p>}
          {parsed && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
              <p className="font-medium text-slate-800">
                {parsed.fileName}: {parsed.people.length} ready to import
                {parsed.skipped > 0 && <span className="font-normal text-amber-700"> · {parsed.skipped} rows skipped (no email)</span>}
              </p>
              <p className="mt-1">How the columns were read:</p>
              <ul className="mt-0.5 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                {(Object.entries(parsed.map) as [FieldKey, string][]).map(([field, col]) => (
                  <li key={field}>
                    <span className="text-slate-400">{FIELD_LABELS[field]} ←</span> &ldquo;{col}&rdquo;
                  </li>
                ))}
              </ul>
              {!parsed.map.company && (
                <p className="mt-1 text-amber-700">No company column found — company names are taken from email addresses (e.g. acme.com → Acme).</p>
              )}
              {parsed.map.company && parsed.companyFromEmail > 0 && (
                <p className="mt-1 text-amber-700">{parsed.companyFromEmail} rows had no company, so it was taken from their email address.</p>
              )}
              {parsed.people[0] && (
                <p className="mt-1 text-slate-500">
                  First row: {[parsed.people[0].first_name, parsed.people[0].last_name].filter(Boolean).join(' ') || '(no name)'} ·{' '}
                  {parsed.people[0].title ?? 'no title'} · {parsed.people[0].company} · {parsed.people[0].email}
                </p>
              )}
            </div>
          )}
          <p className="text-xs text-slate-400">
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

// "$51 million" + "CIT Real Estate Finance" + 2022 → "$51M · CIT Real Estate Finance '22".
function facilityText(p: Prospect) {
  const amount = p.amount?.replace(/\s*million/i, 'M').replace(/\s*billion/i, 'B') ?? null
  const year = p.deal_year ? `'${p.deal_year.slice(-2)}` : null
  return [amount, p.lender, year].filter(Boolean).join(' · ') || ''
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

function EmailPreview({ p, template }: { p: Prospect; template?: ProspectTemplate | null }) {
  const { subject, body } = prospectEmail(p, template)
  return (
    <div className="rounded border border-slate-200 bg-white p-2.5 text-sm text-slate-700">
      <p>
        <span className="font-medium">Subject:</span> {subject}
      </p>
      <p className="mt-1 whitespace-pre-wrap">{body}</p>
      <p className="mt-1 text-xs text-slate-400">+ your JED signature</p>
    </div>
  )
}

// Opens under a prospect when you click their company: where they stand and
// every email with them (read live from Outlook).
function ProspectDetail({
  p,
  onDraft,
  drafting,
  template,
}: {
  p: Prospect
  onDraft: () => void
  drafting: boolean
  template?: ProspectTemplate | null
}) {
  const [showPreview, setShowPreview] = useState(false)
  const [emails, setEmails] = useState<ProspectEmail[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    getProspectEmails(p.email).then((r) => {
      if (!live) return
      setEmails(r.emails)
      setError(r.error ?? null)
    })
    return () => {
      live = false
    }
  }, [p.email])

  return (
    <tr>
      <td colSpan={7} className="bg-slate-50 px-4 py-3">
        <div className="max-w-3xl space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PROSPECT_STATUS_COLORS[p.status]}`}>{PROSPECT_STATUS_LABELS[p.status]}</span>
            {p.last_emailed_at && <span className="text-xs text-slate-500">Last emailed {new Date(p.last_emailed_at).toLocaleDateString()}</span>}
            {p.phone && (
              <a href={`tel:${p.phone}`} className="text-xs text-slate-600 underline">
                {p.phone}
              </a>
            )}
            {p.linkedin && (
              <a href={p.linkedin.startsWith('http') ? p.linkedin : `https://${p.linkedin}`} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-600 underline">
                LinkedIn
              </a>
            )}
          </div>
          <p className="text-xs text-slate-600">
            {[p.first_name, p.last_name].filter(Boolean).join(' ')}
            {p.title ? `, ${p.title}` : ''} ·{' '}
            <a href={`mailto:${p.email}`} className="underline">
              {p.email}
            </a>
          </p>
          {p.reply_summary && <p className="text-xs text-slate-600">Their reply: {p.reply_summary}</p>}
          {p.notes && <p className="whitespace-pre-wrap text-xs text-slate-500">{p.notes}</p>}
          <div className="flex gap-3 text-xs">
            <button type="button" onClick={() => setShowPreview((v) => !v)} className="text-slate-600 underline">
              {showPreview ? 'Hide email' : 'Preview email'}
            </button>
            <button type="button" onClick={onDraft} disabled={drafting} className="text-slate-700 underline disabled:opacity-50">
              Draft in Outlook
            </button>
          </div>
          {showPreview && <EmailPreview p={p} template={template} />}
          {emails === null ? (
            <p className="text-xs text-slate-500">Looking up emails with {p.email}…</p>
          ) : emails.length === 0 ? (
            <p className="text-xs text-slate-500">{error ?? `No emails with ${p.email} yet.`}</p>
          ) : (
            <ul className="space-y-1.5">
              {emails.map((e) => (
                <li key={e.id} className="rounded border border-slate-200 bg-white">
                  <button type="button" onClick={() => setOpenId(openId === e.id ? null : e.id)} className="w-full px-2.5 py-1.5 text-left">
                    <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${e.sent ? 'bg-sky-100 text-sky-800' : 'bg-violet-100 text-violet-800'}`}>
                      {e.sent ? `${e.who} sent` : 'They replied'}
                    </span>
                    <span className="text-xs text-slate-400">{new Date(e.at).toLocaleString()}</span>
                    <span className="ml-2 font-medium text-slate-800">{e.subject}</span>
                  </button>
                  {openId === e.id && <p className="whitespace-pre-wrap border-t border-slate-100 px-2.5 py-2 text-xs text-slate-700">{e.body || '(no text)'}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </td>
    </tr>
  )
}

export function ProspectsTable({ prospects, template }: { prospects: Prospect[]; template?: ProspectTemplate | null }) {
  // Your email: edited in the box above the list, previewed per person.
  const [tpl, setTpl] = useState(template)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
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
  const listNames = lists.map(([name]) => name).filter((n) => n !== NO_LIST)
  // Only worth showing which list someone is on when looking at all of them.
  const showSource = list === 'all' && lists.length > 1
  const inList = list === 'all' ? prospects : prospects.filter((p) => (p.source || NO_LIST) === list)
  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const p of inList) c.set(p.status, (c.get(p.status) ?? 0) + 1)
    return c
  }, [inList])
  const companies = new Set(inList.map((p) => p.company)).size

  // A second contact at the same company (right below the first) doesn't
  // repeat the company and facility.
  const sameCompany = (i: number) => i > 0 && shown[i - 1].company === shown[i].company
  const shown = inList.filter((p) => {
    if (filter !== 'all' && p.status !== filter) return false
    if (!q.trim()) return true
    const hay = [p.company, p.company_display, p.first_name, p.last_name, p.email, p.title, p.lender, p.source].join(' ').toLowerCase()
    return hay.includes(q.trim().toLowerCase())
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <FindProspects lists={listNames} />
        <ImportList lists={listNames} />
      </div>
      <EmailTemplate template={tpl} onSaved={setTpl} />
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
          No prospects yet — import a list above (CSV or Excel, any columns, as long as there&apos;s an email).
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="w-9 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select everyone shown"
                    checked={shown.length > 0 && shown.every((p) => picked.has(p.id))}
                    onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((p) => p.id)) : new Set())}
                    className="rounded border-slate-300"
                  />
                </th>
                <th className="w-[22%] px-2 py-2 text-left font-medium">Company</th>
                <th className="w-[28%] px-2 py-2 text-left font-medium">Contact</th>
                <th className="w-[22%] px-2 py-2 text-left font-medium">Their facility</th>
                <th className="w-32 px-2 py-2 text-left font-medium">Status</th>
                <th className="px-2 py-2 text-left font-medium">Last activity</th>
                <th className="w-16 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((p, i) => [
                <tr
                  key={p.id}
                  onPointerEnter={() => drag.current && setOne(p.id, drag.current.adding)}
                  // Press anywhere on the row (except links, buttons and the
                  // status menu) to select it; keep holding and drag to select more.
                  onPointerDown={(e) => {
                    if (e.button !== 0 || (e.target as HTMLElement).closest('a, button, select, input, textarea')) return
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
                  className={`cursor-pointer select-none align-top ${picked.has(p.id) ? 'bg-sky-50' : 'hover:bg-slate-50'}`}
                >
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={picked.has(p.id)} readOnly tabIndex={-1} className="pointer-events-none rounded border-slate-300" />
                  </td>
                  <td className="truncate px-2 py-2">
                    {sameCompany(i) ? (
                      <span className="pl-4 text-xs text-slate-300">same company</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDetailId(detailId === p.id ? null : p.id)}
                        title={`${p.company_display || p.company} — show status and emails`}
                        className="max-w-full truncate text-left font-medium text-slate-800 hover:underline"
                      >
                        <span className={`mr-1 inline-block text-slate-400 transition-transform ${detailId === p.id ? 'rotate-90' : ''}`}>›</span>
                        {p.company_display || p.company}
                      </button>
                    )}
                    {showSource && !sameCompany(i) && p.source && <div className="truncate pl-3 text-xs text-slate-400">{p.source}</div>}
                  </td>
                  <td className="truncate px-2 py-2" title={[[p.first_name, p.last_name].filter(Boolean).join(' '), p.title, p.email].filter(Boolean).join(' · ')}>
                    <button type="button" onClick={() => setDetailId(detailId === p.id ? null : p.id)} className="block max-w-full truncate text-left">
                      <span className="text-slate-800">{[p.first_name, p.last_name].filter(Boolean).join(' ') || p.email}</span>
                      {p.title && <span className="text-xs text-slate-500"> · {p.title}</span>}
                    </button>
                    <a href={`mailto:${p.email}`} className="block truncate text-xs text-slate-500 hover:underline">
                      {p.email}
                    </a>
                  </td>
                  <td className="truncate px-2 py-2 text-xs text-slate-600" title={[p.amount, p.lender, p.deal_year].filter(Boolean).join(' · ')}>
                    {sameCompany(i) ? '' : facilityText(p)}
                  </td>
                  <td className="px-2 py-2">
                    <StatusSelect p={p} />
                  </td>
                  <td className="truncate px-2 py-2 text-xs text-slate-500" title={p.reply_summary ?? undefined}>
                    {p.deal_id ? (
                      <Link href={`/deals/${p.deal_id}`} className="text-emerald-700 underline">
                        Open deal
                      </Link>
                    ) : p.reply_summary ? (
                      p.reply_summary
                    ) : p.last_emailed_at ? (
                      `Emailed ${new Date(p.last_emailed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      disabled={drafts.busy}
                      onClick={() => drafts.create([p.id])}
                      title="Put the email in your Outlook Drafts"
                      className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                    >
                      Draft
                    </button>
                  </td>
                </tr>,
                detailId === p.id ? <ProspectDetail key={`${p.id}-detail`} p={p} template={tpl} onDraft={() => drafts.create([p.id])} drafting={drafts.busy} /> : null,
              ])}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
