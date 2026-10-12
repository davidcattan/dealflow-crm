'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { readJsonResponse } from '@/lib/fetch-json'

type Person = { id: string; name: string; title: string | null; hasEmail: boolean; city: string | null }

// Find contacts at this lender through Apollo: searching is free; getting a
// person's email (saved as a contact) or the company info costs 1 credit.
export function ApolloPanel({ lenderId, lenderName, defaultDomain }: { lenderId: string; lenderName: string; defaultDomain: string }) {
  const router = useRouter()
  const [domain, setDomain] = useState(defaultDomain)
  const [people, setPeople] = useState<Person[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function call(body: Record<string, unknown>) {
    const res = await fetch(`/api/lenders/${lenderId}/apollo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain, ...body }),
    })
    const result = await readJsonResponse<Record<string, unknown>>(res)
    if (!result.ok) throw new Error(result.message)
    return result.body
  }

  async function search() {
    setBusy('search')
    setError(null)
    setMessage(null)
    try {
      const body = await call({ action: 'search' })
      setPeople((body.people as Person[]) ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setBusy(null)
    }
  }

  async function reveal(p: Person) {
    if (!confirm(`Get ${p.name}'s email from Apollo? Uses 1 Apollo credit.`)) return
    setBusy(p.id)
    setError(null)
    try {
      const body = await call({ action: 'reveal', personId: p.id })
      const person = body.person as { name: string; email: string }
      setSaved({ ...saved, [p.id]: person.email })
      setMessage(body.alreadySaved ? `${person.name} was already a contact.` : `Added ${person.name} (${person.email}) to contacts.`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t get the email')
    } finally {
      setBusy(null)
    }
  }

  async function company() {
    if (!confirm(`Get company info for ${lenderName} from Apollo? Uses 1 Apollo credit.`)) return
    setBusy('company')
    setError(null)
    try {
      const body = await call({ action: 'company' })
      const c = body.company as { description: string | null }
      setMessage(c.description ? 'Company info added to the notes.' : 'Apollo had no description for this company.')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t get company info')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-sm font-semibold text-slate-900">Find contacts (Apollo)</h2>
      <p className="mt-1 text-xs text-slate-500">
        Searching is free. Getting someone&apos;s email (saved as a contact) or the company info uses 1 Apollo credit.
      </p>
      <div data-enter-save className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="lender website, e.g. fairviewcl.com"
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          data-save
          onClick={search}
          disabled={!domain.trim() || busy !== null}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy === 'search' ? 'Searching…' : 'Find people'}
        </button>
        <button
          type="button"
          onClick={company}
          disabled={!domain.trim() || busy !== null}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === 'company' ? 'Getting…' : 'Company info'}
        </button>
      </div>
      {message && <p className="mt-2 text-sm text-emerald-700">{message}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {people && (
        <div className="mt-3">
          {people.length === 0 ? (
            <p className="text-sm text-slate-500">No one with a lending-related title found at {domain}.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {people.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium text-slate-800">{p.name}</span>
                    {p.title && <span className="ml-1.5 text-slate-500">· {p.title}</span>}
                    {p.city && <span className="ml-1.5 text-xs text-slate-400">{p.city}</span>}
                  </span>
                  {saved[p.id] ? (
                    <span className="text-xs text-emerald-700">✓ {saved[p.id]}</span>
                  ) : p.hasEmail ? (
                    <button
                      type="button"
                      onClick={() => reveal(p)}
                      disabled={busy !== null}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {busy === p.id ? 'Getting…' : 'Get email · 1 credit'}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">no email in Apollo</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
