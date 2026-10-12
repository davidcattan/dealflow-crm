'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { readJsonResponse } from '@/lib/fetch-json'
import { ErrorText } from '@/components/error-text'
import { COMPANY_FIELDS, OWNER_FIELDS, type Profile, type ProfileField } from '@/lib/profile/schema'
import { addProfileOwner, removeProfileOwner, setProfileField } from './profile-actions'

type Stored = Profile & { read?: string[] }

const STATUS = {
  confirmed: { icon: '✓', cls: 'text-emerald-600', label: 'From the documents' },
  check: { icon: '!', cls: 'text-amber-600', label: 'Check this' },
  missing: { icon: '–', cls: 'text-slate-300', label: 'Not in the documents' },
} as const

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// One label/value line: status mark, the value (tap to edit), copy button,
// and where it came from.
function Row({
  dealId,
  owner,
  name,
  label,
  cell,
}: {
  dealId: string
  owner: number | null
  name: string
  label: string
  cell: ProfileField | undefined
}) {
  const c = cell ?? { value: null, status: 'missing' as const, source: null, note: null }
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(c.value ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const look = STATUS[c.status] ?? STATUS.missing
  const isSsn = name === 'ssn_where'

  function save() {
    setError(null)
    startTransition(async () => {
      const res = await setProfileField(dealId, owner, name, draft)
      if (res && 'error' in res && res.error) setError(res.error)
      else setEditing(false)
    })
  }

  return (
    <li className="grid grid-cols-[7.5rem_1fr] gap-x-3 py-2 text-sm sm:grid-cols-[10rem_1fr]">
      <span className="flex items-start gap-1.5 text-xs font-medium text-slate-500">
        <span className={`w-3 text-center font-bold ${look.cls}`} title={look.label}>
          {look.icon}
        </span>
        {label}
      </span>
      <div className="min-w-0">
        {editing ? (
          <div className="flex gap-2" data-enter-save>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
              placeholder={isSsn ? 'Where to find it (never the number)' : label}
              className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <button type="button" data-save onClick={save} disabled={pending} className="rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
              Save
            </button>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(c.value ?? '')
                setEditing(true)
              }}
              className={`min-w-0 flex-1 text-left [overflow-wrap:anywhere] hover:underline ${c.value ? 'text-slate-900' : 'text-slate-400'}`}
              title="Tap to edit"
            >
              {c.value ?? (isSsn ? 'Not in the documents' : 'Add…')}
            </button>
            {c.value && !isSsn && <CopyButton text={c.value} />}
          </div>
        )}
        {(c.note || c.source) && !editing && (
          <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
            {c.note && <span className={c.status === 'check' ? 'text-amber-700' : ''}>{c.note}</span>}
            {c.note && c.source && ' · '}
            {c.source}
          </p>
        )}
        {error && <ErrorText message={error} />}
      </div>
    </li>
  )
}

function profileText(p: Stored) {
  const lines: string[] = ['COMPANY']
  for (const [k, label] of COMPANY_FIELDS) if (p.company[k]?.value) lines.push(`${label}: ${p.company[k].value}`)
  p.owners.forEach((o, i) => {
    lines.push('', `OWNER ${i + 1}`)
    for (const [k, label] of OWNER_FIELDS) if (k !== 'ssn_where' && o[k]?.value) lines.push(`${label}: ${o[k].value}`)
  })
  return lines.join('\n')
}

// Owner and company details for lender application forms, pulled from the
// deal's tax returns and entity papers, each with where it came from.
export function ProfilePanel({ dealId, profile, at }: { dealId: string; profile: Stored | null; at: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ownerTab, setOwnerTab] = useState(0)
  const [pending, startTransition] = useTransition()

  async function run() {
    if (
      !confirm(
        `${profile ? 'Re-read' : 'Read'} the tax returns and company papers for owner and company details? It uses the paid AI — usually 10–40¢.${profile ? ' Anything you typed in yourself will be replaced.' : ''}`
      )
    )
      return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/deals/${dealId}/profile`, { method: 'POST' })
      const result = await readJsonResponse(res)
      if (!result.ok) throw new Error(result.message)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t read the documents')
    } finally {
      setBusy(false)
    }
  }

  const owners = profile?.owners ?? []
  const tab = Math.min(ownerTab, Math.max(0, owners.length - 1))
  const toCheck = profile
    ? [...Object.values(profile.company), ...owners.flatMap((o) => Object.values(o))].filter((c) => c?.status === 'check').length
    : 0

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">Borrower profile</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Owner and company details for lender forms, pulled from the tax returns and company papers.
            {at && ` Read ${new Date(at).toLocaleDateString()}.`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {profile && <CopyButton text={profileText(profile)} />}
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
              profile ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50' : 'bg-slate-900 text-white hover:bg-slate-800'
            }`}
          >
            {busy ? 'Reading…' : profile ? 'Re-read' : 'Pull from documents'}
          </button>
        </div>
      </div>
      {error && <ErrorText message={error} />}

      {!profile && !busy && (
        <p className="mt-3 text-sm text-slate-500">
          Upload the tax return (it has the owners, percentages and addresses), articles or operating agreement, then hit{' '}
          <b>Pull from documents</b>.
        </p>
      )}

      {profile && (
        <div className="mt-4 space-y-5">
          {(profile.warnings.length > 0 || toCheck > 0) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {toCheck > 0 && (
                <p className="font-medium">
                  {toCheck} value{toCheck === 1 ? '' : 's'} marked <span className="font-bold">!</span> {toCheck === 1 ? 'needs' : 'need'} checking before
                  you submit a form.
                </p>
              )}
              {profile.warnings.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                  {profile.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Company</h3>
            <ul className="divide-y divide-slate-100">
              {COMPANY_FIELDS.map(([k, label]) => (
                <Row key={k} dealId={dealId} owner={null} name={k} label={label} cell={profile.company[k]} />
              ))}
            </ul>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="mr-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Owners</h3>
              {owners.map((o, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setOwnerTab(i)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${tab === i ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
                >
                  {o.name?.value ?? `Owner ${i + 1}`}
                  {o.ownership_pct?.value && <span className="opacity-70"> · {o.ownership_pct.value}</span>}
                </button>
              ))}
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await addProfileOwner(dealId)
                    setOwnerTab(owners.length)
                  })
                }
                className="rounded-full px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100"
              >
                + Add owner
              </button>
            </div>
            {owners[tab] ? (
              <>
                <ul className="divide-y divide-slate-100">
                  {OWNER_FIELDS.map(([k, label]) => (
                    <Row key={`${tab}-${k}`} dealId={dealId} owner={tab} name={k} label={label} cell={owners[tab][k]} />
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (confirm(`Remove ${owners[tab].name?.value ?? 'this owner'} from the profile?`))
                      startTransition(async () => {
                        await removeProfileOwner(dealId, tab)
                        setOwnerTab(0)
                      })
                  }}
                  className="mt-1 text-xs text-slate-400 hover:text-red-600"
                >
                  Remove owner
                </button>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-400">No owners found in the documents.</p>
            )}
          </div>

          {profile.related_entities.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Related companies</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {profile.related_entities.map((r, i) => (
                  <li key={i} className="text-slate-700">
                    <span className="font-medium">{r.name}</span>
                    {r.ein && <span className="text-slate-500"> · EIN {r.ein}</span>}
                    <span className="text-slate-500"> — {r.relationship}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-slate-400">
            <span className="font-bold text-emerald-600">✓</span> printed in a document · <span className="font-bold text-amber-600">!</span> worked out —
            check it · – not found. Tap any value to fix it. Social Security numbers are never stored; the profile says where to find them.
            {profile.read?.length ? ` Read: ${profile.read.join(', ')}.` : ''}
          </p>
        </div>
      )}
    </section>
  )
}
