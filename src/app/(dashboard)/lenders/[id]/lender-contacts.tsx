'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import type { Lender, LenderContact } from '@/lib/types'
import { addLenderContact, deleteLenderContact, getContactEmails, makePrimaryContact, setContactCc, updateLenderContact, type ContactEmail } from './actions'

type Row = {
  id: string // 'primary' when the main contact only exists on the lender row
  name: string | null
  title: string | null
  email: string | null
  phone: string | null
  cc: boolean
  primary: boolean
  covers: string | null
  linkedin_url: string | null
  linkedin_status: string | null
  notes: string | null
}

export const LINKEDIN_STATUSES: Record<string, { label: string; tone: string }> = {
  request_sent: { label: 'LinkedIn: request sent', tone: 'bg-slate-100 text-slate-600' },
  connected: { label: 'LinkedIn: connected', tone: 'bg-sky-100 text-sky-800' },
  messaged: { label: 'LinkedIn: messaged', tone: 'bg-indigo-100 text-indigo-800' },
  replied: { label: 'LinkedIn: replied', tone: 'bg-emerald-100 text-emerald-800' },
  not_accepted: { label: 'LinkedIn: not accepted', tone: 'bg-amber-100 text-amber-800' },
}

type FormValues = {
  name: string
  title: string
  email: string
  phone: string
  cc: boolean
  covers: string
  linkedin_url: string
  linkedin_status: string
  notes: string
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
    covers: c.covers ?? null,
    linkedin_url: c.linkedin_url ?? null,
    linkedin_status: c.linkedin_status ?? null,
    notes: c.notes ?? null,
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
      covers: null,
      linkedin_url: null,
      linkedin_status: null,
      notes: null,
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
  onSave: (v: FormValues) => void
  onCancel: () => void
  saving: boolean
}) {
  const [v, setV] = useState<FormValues>({
    name: initial?.name ?? '',
    title: initial?.title ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    cc: initial?.cc ?? false,
    covers: initial?.covers ?? '',
    linkedin_url: initial?.linkedin_url ?? '',
    linkedin_status: initial?.linkedin_status ?? '',
    notes: initial?.notes ?? '',
  })
  const field = (key: 'name' | 'title' | 'email' | 'phone' | 'covers' | 'linkedin_url', placeholder: string) => (
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
        {field('covers', 'Right person for, e.g. "Healthcare cash flow, $5-10M EBITDA"')}
        {field('linkedin_url', 'LinkedIn URL')}
        <select
          value={v.linkedin_status}
          onChange={(e) => setV({ ...v, linkedin_status: e.target.value })}
          className="min-w-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="">LinkedIn: —</option>
          {Object.entries(LINKEDIN_STATUSES).map(([k, s]) => (
            <option key={k} value={k}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={v.notes}
        onChange={(e) => setV({ ...v, notes: e.target.value })}
        placeholder="What they've told us, e.g. 11/19: likes post-acute; cash flow tough under $10M EBITDA"
        rows={2}
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
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

// Opens under a contact: every email with them, newest first.
function ContactHistory({ row, onEdit }: { row: Row; onEdit: () => void }) {
  const [emails, setEmails] = useState<ContactEmail[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (row.email) getContactEmails(row.email).then((e) => live && setEmails(e))
    return () => {
      live = false
    }
  }, [row.email])

  return (
    <div className="mt-2 w-full rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {!row.phone && (
          <button type="button" onClick={onEdit} className="text-slate-700 underline">
            + Add phone
          </button>
        )}
        {!row.email && (
          <button type="button" onClick={onEdit} className="text-slate-700 underline">
            + Add email
          </button>
        )}
        {row.email && row.phone && (
          <button type="button" onClick={onEdit} className="text-slate-700 underline">
            Edit details
          </button>
        )}
      </div>
      {!row.email ? (
        <p className="mt-2 text-xs text-slate-500">Add an email to see your emails with them.</p>
      ) : emails === null ? (
        <p className="mt-2 text-xs text-slate-500">Loading emails…</p>
      ) : emails.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">No emails with {row.email} yet.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          <li className="text-xs font-medium text-slate-600">
            {emails.length} email{emails.length === 1 ? '' : 's'} with {row.name || row.email}
          </li>
          {emails.map((e) => (
            <li key={e.id} className="rounded border border-slate-200 bg-white text-sm">
              <button type="button" onClick={() => setOpenId(openId === e.id ? null : e.id)} className="w-full px-2.5 py-1.5 text-left">
                <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${e.sent ? 'bg-sky-100 text-sky-800' : 'bg-violet-100 text-violet-800'}`}>
                  {e.sent ? 'You sent' : 'They sent'}
                </span>
                <span className="text-xs text-slate-400">{new Date(e.at).toLocaleDateString()}</span>
                <span className="ml-2 font-medium text-slate-800">{e.subject}</span>
                {e.summary && <span className="block truncate text-xs text-slate-500">{e.summary}</span>}
              </button>
              {openId === e.id && (
                <div className="border-t border-slate-100 px-2.5 py-2">
                  {e.dealId && (
                    <Link href={`/deals/${e.dealId}`} className="mb-1 inline-block text-xs text-slate-600 underline">
                      Deal: {e.dealName ?? 'open'}
                    </Link>
                  )}
                  <p className="whitespace-pre-wrap text-xs text-slate-700">{e.body || e.summary || '(no text saved)'}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function LenderContacts({ lender, contacts }: { lender: Lender; contacts: LenderContact[] }) {
  const rows = buildRows(lender, contacts)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
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
                    <button
                      type="button"
                      onClick={() => setOpenId(openId === r.id ? null : r.id)}
                      title="Show emails with this person"
                      className="text-left hover:underline"
                    >
                      <span className={`mr-1 inline-block text-slate-400 transition-transform ${openId === r.id ? 'rotate-90' : ''}`}>›</span>
                      {r.name || r.title || r.email || 'Contact'}
                    </button>
                    {r.primary && <span className="ml-2 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-white">Primary (To)</span>}
                    {!r.primary && r.cc && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] text-sky-800">CC</span>}
                  </p>
                  {r.name && r.title && <p className="text-xs text-slate-500">{r.title}</p>}
                  {(r.covers || r.linkedin_status || r.linkedin_url) && (
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                      {r.covers && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">For: {r.covers}</span>}
                      {r.linkedin_status && LINKEDIN_STATUSES[r.linkedin_status] && (
                        <span className={`rounded px-1.5 py-0.5 ${LINKEDIN_STATUSES[r.linkedin_status].tone}`}>{LINKEDIN_STATUSES[r.linkedin_status].label}</span>
                      )}
                      {r.linkedin_url && (
                        <a href={r.linkedin_url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">
                          LinkedIn
                        </a>
                      )}
                    </p>
                  )}
                  {r.notes && <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-600">{r.notes}</p>}
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
                {openId === r.id && (
                  <ContactHistory
                    row={r}
                    onEdit={() => {
                      setOpenId(null)
                      setEditingId(r.id)
                    }}
                  />
                )}
              </li>
            )
          )}
        </ul>
      )}
    </section>
  )
}
