'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { addEmailFinding, dismissEmailFinding } from './finding-actions'

export type EmailFinding = {
  id: string
  kind: 'new_lender' | 'new_contact' | 'lender_request' | 'follow_up' | 'possible_deal'
  title: string
  detail: string | null
  people: { name: string; title?: string | null; email?: string | null; phone?: string | null }[]
  dealId: string | null
  subject: string | null
}

const LABELS: Record<EmailFinding['kind'], string> = {
  new_lender: 'New lender',
  new_contact: 'New contact',
  lender_request: 'Request',
  follow_up: 'Follow up',
  possible_deal: 'Possible deal',
}

const ADDS_TO_CRM = new Set<EmailFinding['kind']>(['new_lender', 'new_contact'])

function Row({ item, onGone }: { item: EmailFinding; onGone: (id: string) => void }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const run = (action: (id: string) => Promise<{ error?: string; ok?: boolean }>) => {
    setError(null)
    start(async () => {
      const r = await action(item.id)
      if (r.error) setError(r.error)
      else onGone(item.id)
    })
  }
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">
            <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{LABELS[item.kind]}</span>
            {item.title.replace(/^New (lender|contact): /, '')}
          </p>
          {item.people.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
              {item.people.map((p) => (
                <li key={`${p.name}${p.email ?? ''}`}>{[p.name, p.title, p.email, p.phone].filter(Boolean).join(' · ')}</li>
              ))}
            </ul>
          )}
          {item.detail && <p className="mt-1 text-xs text-slate-500">{item.detail}</p>}
          {item.subject && <p className="mt-0.5 truncate text-xs text-slate-400">Email: {item.subject}</p>}
          {item.dealId && (
            <Link href={`/deals/${item.dealId}`} className="mt-0.5 inline-block text-xs font-medium text-emerald-700 hover:underline">
              Open deal
            </Link>
          )}
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(addEmailFinding)}
            className="cursor-pointer rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {ADDS_TO_CRM.has(item.kind) ? 'Add to CRM' : 'Done'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(dismissEmailFinding)}
            className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      </div>
    </li>
  )
}

// New lenders, requests and follow-ups the inbox reader picked up. Nothing
// here changes the CRM until someone clicks Add.
export function EmailFindings({ items }: { items: EmailFinding[] }) {
  const [gone, setGone] = useState<Set<string>>(new Set())
  const shown = items.filter((i) => !gone.has(i.id))
  if (!shown.length) return null
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">From your email ({shown.length})</h2>
      <ul className="divide-y divide-slate-100">
        {shown.map((item) => (
          <Row key={item.id} item={item} onGone={(id) => setGone((s) => new Set(s).add(id))} />
        ))}
      </ul>
    </section>
  )
}
