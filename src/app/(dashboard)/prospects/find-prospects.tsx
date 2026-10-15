'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { readJsonResponse } from '@/lib/fetch-json'
import type { FoundCompany } from '@/app/api/prospects/find/route'

// Type companies or websites → Apollo finds the CFO / owner at each (free)
// → you tick who you want → their emails are unlocked (1 credit each) and
// they're added to Prospects.
export function FindProspects() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [list, setList] = useState('')
  const [results, setResults] = useState<FoundCompany[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function search(inputs: string[]) {
    const res = await fetch('/api/prospects/find', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs }),
    })
    const r = await readJsonResponse<{ results: FoundCompany[] }>(res)
    if (!r.ok) throw new Error(r.message)
    return r.body.results
  }

  async function runSearch() {
    const inputs = text.split(/\n|,(?=\s*\S+\.\w{2,})/).map((s) => s.trim()).filter(Boolean)
    if (!inputs.length) return
    setBusy(`Searching Apollo for ${inputs.length} compan${inputs.length === 1 ? 'y' : 'ies'}…`)
    setError(null)
    setMessage(null)
    try {
      const found = await search(inputs)
      setResults(found)
      setPicked(new Set(found.flatMap((c) => c.people.filter((p) => p.picked).map((p) => p.id))))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setBusy(null)
    }
  }

  // "Which Dunn Tire?" — search again with the chosen company's website.
  async function choose(index: number, domain: string, name: string) {
    setBusy(`Looking up ${name}…`)
    try {
      const [found] = await search([domain])
      if (found) {
        found.input = results![index].input
        found.company = name
        setResults((rs) => rs!.map((r, i) => (i === index ? found : r)))
        setPicked((s) => new Set([...s, ...found.people.filter((p) => p.picked).map((p) => p.id)]))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed')
    } finally {
      setBusy(null)
    }
  }

  async function addPicked() {
    const people = (results ?? []).flatMap((c) =>
      c.people.filter((p) => picked.has(p.id)).map((p) => ({ id: p.id, name: p.name, domain: c.domain!, company: c.company ?? c.domain! }))
    )
    if (!people.length) return
    setBusy(`Getting ${people.length} email${people.length === 1 ? '' : 's'} from Apollo…`)
    setError(null)
    try {
      const res = await fetch('/api/prospects/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ people, list }),
      })
      const r = await readJsonResponse<{ added: string[]; noEmail: string[]; duplicates: string[]; unverified: string[]; credits: number }>(res)
      if (!r.ok) throw new Error(r.message)
      const { added, noEmail, duplicates, unverified, credits } = r.body
      setMessage(
        [
          `Added ${added.length} to Prospects${list.trim() ? ` ("${list.trim()}")` : ''}.`,
          noEmail.length ? `No email found for ${noEmail.join(', ')}.` : null,
          duplicates.length ? `Already in Prospects: ${duplicates.join(', ')}.` : null,
          unverified.length ? `Left out (email not verified by Apollo, could bounce): ${unverified.join(', ')}.` : null,
          `${credits} Apollo credit${credits === 1 ? '' : 's'} used.`,
        ]
          .filter(Boolean)
          .join(' ')
      )
      setResults(null)
      setPicked(new Set())
      setText('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add them')
    } finally {
      setBusy(null)
    }
  }

  const pickedCount = picked.size

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          setMessage(null)
        }}
        className="text-sm font-medium text-slate-700 hover:underline"
      >
        {open ? 'Close' : '+ Find prospects with Apollo'}
      </button>
      {message && <p className="mt-1 text-xs text-emerald-700">{message}</p>}
      {open && (
        <div className="mt-2 space-y-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Companies — websites work best, one per line. Finds the CFO, CEO and owner.
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                placeholder={'polder.com\nbuckknives.com\nDunn Tire'}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Add to list
                <input
                  value={list}
                  onChange={(e) => setList(e.target.value)}
                  placeholder="e.g. Trade show Oct, Eli's list"
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>
              <button
                type="button"
                onClick={runSearch}
                disabled={Boolean(busy) || !text.trim()}
                className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Search Apollo (free)
              </button>
            </div>
          </div>
          {busy && <p className="text-xs text-slate-500">{busy}</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}

          {results && (
            <div className="space-y-2">
              {results.map((c, i) => (
                <div key={`${c.input}-${i}`} className="rounded-md border border-slate-200 p-2.5">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-slate-800">{c.company ?? c.input}</span>
                    {c.domain && <span className="text-xs text-slate-400">{c.domain}</span>}
                    {c.alreadyHave > 0 && (
                      <span className="rounded bg-amber-50 px-1.5 text-xs text-amber-700">
                        {c.alreadyHave} already in Prospects
                      </span>
                    )}
                  </div>
                  {c.message && <p className={`text-xs ${c.status === 'error' ? 'text-red-600' : 'text-slate-500'}`}>{c.message}</p>}
                  {c.status === 'choose' && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {c.options!.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => choose(i, o.domain!, o.name)}
                          className="rounded border border-slate-300 px-2 py-1 text-left text-xs hover:bg-slate-50"
                        >
                          <span className="font-medium">{o.name}</span>{' '}
                          <span className="text-slate-500">
                            {[o.domain, [o.city, o.state].filter(Boolean).join(', '), o.employees ? `${o.employees} employees` : null].filter(Boolean).join(' · ')}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {c.people.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {c.people.map((p) => (
                        <li key={p.id}>
                          <label className={`flex items-center gap-2 text-sm ${p.hasEmail ? 'text-slate-700' : 'text-slate-400'}`}>
                            <input
                              type="checkbox"
                              disabled={!p.hasEmail}
                              checked={picked.has(p.id)}
                              onChange={(e) =>
                                setPicked((s) => {
                                  const next = new Set(s)
                                  if (e.target.checked) next.add(p.id)
                                  else next.delete(p.id)
                                  return next
                                })
                              }
                              className="rounded border-slate-300"
                            />
                            {p.name} <span className="text-xs text-slate-500">· {p.title}</span>
                            {!p.hasEmail && <span className="text-xs">(no email in Apollo)</span>}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              <div className="sticky bottom-2 flex flex-wrap items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                <span>
                  {pickedCount} picked · uses about <strong>{pickedCount} Apollo credit{pickedCount === 1 ? '' : 's'}</strong>
                </span>
                <button
                  type="button"
                  onClick={addPicked}
                  disabled={Boolean(busy) || pickedCount === 0}
                  className="rounded-md bg-slate-900 px-2.5 py-1 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Get emails &amp; add {pickedCount}
                </button>
                <span className="text-sky-700">Last names show in full once added.</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
