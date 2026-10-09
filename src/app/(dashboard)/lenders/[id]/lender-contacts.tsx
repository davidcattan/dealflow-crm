'use client'

import { useState, useTransition } from 'react'
import type { Lender, LenderContact } from '@/lib/types'
import { addLenderContact, deleteLenderContact, makePrimaryContact, setContactCc, updateLenderContact } from './actions'

type Row = {
  id: string // 'primary' when the main contact only exists on the lender row
  name: string | null
  title: string | null
  email: string | null
  phone: string | null
  cc: boolean
  primary: boolean
}

function buildRows(lender: Lender, contacts: LenderContact[]): Row[] {
  const primaryEmail = lender.contact_email?.toLowerCase() ?? null
  const rows: Row[] = contacts.map((c) => ({
    id: c.id,
    name: c.name,
    title: c.title ?? null,
    email: c.email,
    phone: c.phone ?? null,
    cc: Boolean(c.cc_on_emails),
    primary: Boolean(primaryEmail && c.email?.toLowerCase() === primaryEmail),
  }))
  if (!rows.some((r) => r.primary) && (lender.contact_email || lender.contact_phone || lender.contact_name)) {
    rows.unshift({
      id: 'primary',
      name: lender.contact_name,
      title: null,
      email: lender.contact_email,
      phone: lender.contact_phone,
      cc: false,
      primary: true,
    })
  }
  // Primary first; drop exact duplicates the import sometimes created.
  const seen = new Set<string>()
  return rows
    .sort((a, b) => Number(b.primary) - Number(a.primary))
    .filter((r) => {
      const key = `${r.email ?? ''}|${r.phone ?? ''}|${r.name ?? ''}`.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function ContactForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<Row>
  onSave: (v: { name: string; title: string; email: string; phone: string; cc: boolean }) => void
  onCancel: () => void
  saving: boolean
}) {
  const [v, setV] = useState({
    name: initial?.name ?? '',
    title: initial?.title ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    cc: initial?.cc ?? false,
  })
  const field = (key: 'name' | 'title' | 'email' | 'phone', placeholder: string) => (
    <input
      value={v[key]}
      onChange={(e) => setV({ ...v, [key]: e.target.value })}
      placeholder={placeholder}
      className="min-w-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
    />
  )
  return (
    <div data-enter-save className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {field('name', 'Name (optional)')}
        {field('title', 'Role, e.g. "General inbox", "VP Originations"')}
        {field('email', 'Email')}
        {field('phone', 'Phone')}
      </div>
      {!initial?.primary && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={v.cc} onChange={(e) => setV({ ...v, cc: e.target.checked })} className="rounded border-slate-300" />
          CC on submission emails
        </label>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          data-save
          disabled={saving}
          onClick={() => onSave(v)}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700">
          Cancel
        </button>
      </div>
    </div>
  )
}

export function LenderContacts({ lender, contacts }: { lender: Lender; contacts: LenderContact[] }) {
  const rows = buildRows(lender, contacts)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Contacts ({rows.length})</h2>
          <p className="text-xs text-slate-500">
            Submission emails go to the primary contact, with anyone marked &ldquo;CC&rdquo; copied.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            + Add contact
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-3">
          <ContactForm
            saving={pending}
            onCancel={() => setAdding(false)}
            onSave={(v) =>
              startTransition(async () => {
                setError(null)
                const res = await addLenderContact(lender.id, v)
                if (res?.error) setError(res.error)
                else setAdding(false)
              })
            }
          />
        </div>
      )}
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {rows.length === 0 && !adding ? (
        <p className="py-3 text-sm text-slate-400">No contacts yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) =>
            editingId === r.id ? (
              <li key={r.id} className="py-2">
                <ContactForm
                  initial={r}
                  saving={pending}
                  onCancel={() => setEditingId(null)}
                  onSave={(v) =>
                    startTransition(async () => {
                      await updateLenderContact(lender.id, r.id, v)
                      setEditingId(null)
                    })
                  }
                />
              </li>
            ) : (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 [overflow-wrap:anywhere]">
                    {r.name || r.title || r.email || 'Contact'}
                    {r.primary && <span className="ml-2 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-white">Primary (To)</span>}
                    {!r.primary && r.cc && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] text-sky-800">CC</span>}
                  </p>
                  {r.name && r.title && <p className="text-xs text-slate-500">{r.title}</p>}
                  <p className="text-xs text-slate-600 [overflow-wrap:anywhere]">
                    {r.email && (
                      <a href={`mailto:${r.email}`} className="hover:underline">
                        {r.email}
                      </a>
                    )}
                    {r.email && r.phone && ' · '}
                    {r.phone && (
                      <a href={`tel:${r.phone}`} className="hover:underline">
                        {r.phone}
                      </a>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs">
                  {!r.primary && r.id !== 'primary' && r.email && (
                    <>
                      <label className="flex items-center gap-1 text-slate-600">
                        <input
                          type="checkbox"
                          checked={r.cc}
                          disabled={pending}
                          onChange={(e) => startTransition(() => setContactCc(lender.id, r.id, e.target.checked))}
                          className="rounded border-slate-300"
                        />
                        CC
                      </label>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => startTransition(() => makePrimaryContact(lender.id, r.id))}
                        className="text-slate-600 hover:underline"
                      >
                        Make primary
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => setEditingId(r.id)} className="text-slate-600 hover:underline">
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (confirm(`Remove ${r.name || r.email || 'this contact'}?`))
                        startTransition(() => deleteLenderContact(lender.id, r.id))
                    }}
                    className="text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </li>
            )
          )}
        </ul>
      )}
    </section>
  )
}
