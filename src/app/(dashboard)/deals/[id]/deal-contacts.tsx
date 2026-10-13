'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addDealContact, updateDealContact, removeDealContact, makeMainContact, type ContactInput } from './contact-actions'

export type DealContact = { id: string; name: string; title: string | null; email: string | null; phone: string | null; notes: string | null }

const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm'

function ContactForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: DealContact
  onSave: (c: ContactInput) => Promise<{ error?: string } | { ok: boolean }>
  onCancel: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <form
      action={(fd) =>
        start(async () => {
          const res = await onSave({
            name: String(fd.get('name') ?? ''),
            title: String(fd.get('title') ?? ''),
            email: String(fd.get('email') ?? ''),
            phone: String(fd.get('phone') ?? ''),
            notes: String(fd.get('notes') ?? ''),
          })
          if ('error' in res && res.error) setError(res.error)
        })
      }
      className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2"
    >
      <input name="name" defaultValue={initial?.name} placeholder="Name (e.g. Charles Smith)" className={input} required autoFocus />
      <input name="title" defaultValue={initial?.title ?? ''} placeholder="Title (e.g. Treasurer)" className={input} />
      <input name="email" type="email" defaultValue={initial?.email ?? ''} placeholder="Email" className={input} />
      <input name="phone" defaultValue={initial?.phone ?? ''} placeholder="Phone" className={input} />
      <input name="notes" defaultValue={initial?.notes ?? ''} placeholder="Note (optional, e.g. day-to-day contact on the financials)" className={`${input} sm:col-span-2`} />
      {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <button disabled={pending} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-white">
          Cancel
        </button>
      </div>
    </form>
  )
}

// The deal's other people: the main contact stays in Deal details; these sit
// alongside (a treasurer next to the CFO, the controller, the owner's son…).
// Emails from any of them land on this deal.
export function DealContacts({ dealId, contacts }: { dealId: string; contacts: DealContact[] }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const done = () => {
    setAdding(false)
    setEditing(null)
    router.refresh()
  }

  return (
    <div className="border-t border-slate-100 pt-2.5 sm:col-span-3 sm:border-0 sm:pt-0">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500">Other contacts{contacts.length ? ` (${contacts.length})` : ''}</p>
        {!adding && (
          <button onClick={() => setAdding(true)} className="text-xs font-medium text-slate-600 hover:text-slate-900">
            + Add contact
          </button>
        )}
      </div>
      {contacts.length === 0 && !adding && <p className="mt-0.5 text-sm text-slate-400">None yet.</p>}
      <ul className="mt-1.5 space-y-1.5">
        {contacts.map((c) =>
          editing === c.id ? (
            <li key={c.id}>
              <ContactForm
                initial={c}
                onSave={async (v) => {
                  const res = await updateDealContact(dealId, c.id, v)
                  if ('ok' in res) done()
                  return res
                }}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border border-slate-200 px-3 py-2">
              <div className="min-w-0 text-sm text-slate-800 [overflow-wrap:anywhere]">
                <span className="font-medium">{c.name}</span>
                {c.title && <span className="text-slate-500"> · {c.title}</span>}
                <span className="block text-slate-600 sm:inline">
                  {c.email && (
                    <>
                      <span className="max-sm:hidden"> · </span>
                      <a href={`mailto:${c.email}`} className="underline">{c.email}</a>
                    </>
                  )}
                  {c.phone && (
                    <>
                      {' · '}
                      <a href={`tel:${c.phone}`} className="underline">{c.phone}</a>
                    </>
                  )}
                </span>
                {c.notes && <span className="block text-xs text-slate-500">{c.notes}</span>}
              </div>
              <div className="flex shrink-0 gap-3 text-xs text-slate-500">
                <button onClick={() => setEditing(c.id)} className="hover:text-slate-900">Edit</button>
                <button
                  disabled={pending}
                  onClick={() => start(async () => { await makeMainContact(dealId, c.id); done() })}
                  className="hover:text-slate-900"
                >
                  Make main
                </button>
                <button
                  disabled={pending}
                  onClick={() => {
                    if (confirm(`Remove ${c.name} from this deal?`)) start(async () => { await removeDealContact(dealId, c.id); done() })
                  }}
                  className="hover:text-red-600"
                >
                  Remove
                </button>
              </div>
            </li>
          )
        )}
      </ul>
      {adding && (
        <div className="mt-1.5">
          <ContactForm
            onSave={async (v) => {
              const res = await addDealContact(dealId, v)
              if ('ok' in res) done()
              return res
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}
    </div>
  )
}
