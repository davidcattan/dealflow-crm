import Link from 'next/link'
import { STATUS_COLORS, STATUS_LABELS, displayStatus, type DealStatus } from '@/lib/types'
import { SUBMISSION_LABELS, SUBMISSION_STYLES, type SubmissionStatus } from '@/lib/deals/submission-status'

export type GlanceLender = { id: string; name: string; status: SubmissionStatus; person: string | null }

// The deal on one card: what it is, who to call, where the lenders stand and
// what happened last. The first thing you see on a deal.
export function AtAGlance({
  status,
  owner,
  ask,
  loanType,
  industry,
  contact,
  lenders,
  last,
}: {
  status: DealStatus
  owner: string | null
  ask: string | null
  loanType: string | null
  industry: string | null
  contact: { name: string | null; phone: string | null; email: string | null }
  lenders: GlanceLender[]
  last: { at: string; text: string } | null
}) {
  const shown = displayStatus(status)
  const counts = new Map<SubmissionStatus, number>()
  for (const l of lenders) counts.set(l.status, (counts.get(l.status) ?? 0) + 1)
  // Lenders worth naming: anyone past "sent".
  const live = lenders.filter((l) => ['interested', 'needs_more_info', 'term_sheet', 'funded'].includes(l.status))

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="grid gap-3 text-sm sm:grid-cols-[7rem_1fr]">
        <span className="text-xs font-medium text-slate-500 sm:pt-0.5">Status</span>
        <span className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_COLORS[shown]}`} />
            {STATUS_LABELS[shown]}
          </span>
          <span className="text-xs text-slate-500">{owner ? `${owner}'s deal` : 'Shared deal'}</span>
        </span>

        <span className="text-xs font-medium text-slate-500 sm:pt-0.5">The ask</span>
        <span className="text-slate-800">
          {ask || <span className="text-slate-400">Not set</span>}
          {(loanType || industry) && <span className="text-slate-500"> · {[loanType, industry].filter(Boolean).join(' · ')}</span>}
        </span>

        <span className="text-xs font-medium text-slate-500 sm:pt-0.5">Contact</span>
        <span className="text-slate-800 [overflow-wrap:anywhere]">
          {contact.name || contact.email || contact.phone ? (
            <>
              {contact.name ?? ''}
              {contact.phone && (
                <>
                  {contact.name ? ' · ' : ''}
                  <a href={`tel:${contact.phone}`} className="underline">
                    {contact.phone}
                  </a>
                </>
              )}
              {contact.email && (
                <>
                  {contact.name || contact.phone ? ' · ' : ''}
                  <a href={`mailto:${contact.email}`} className="underline">
                    {contact.email}
                  </a>
                </>
              )}
            </>
          ) : (
            <span className="text-slate-400">No contact yet</span>
          )}
        </span>

        <span className="text-xs font-medium text-slate-500 sm:pt-0.5">Lenders</span>
        <span className="text-slate-800">
          {lenders.length === 0 ? (
            <span className="text-slate-400">Not sent to any lender yet</span>
          ) : (
            <span className="flex flex-wrap items-center gap-1.5">
              <span>{lenders.length} sent</span>
              {[...counts.entries()]
                .filter(([s]) => s !== 'sent')
                .map(([s, n]) => (
                  <span key={s} className={`rounded-full px-2 py-0.5 text-xs font-medium ${SUBMISSION_STYLES[s]}`}>
                    {n} {SUBMISSION_LABELS[s].toLowerCase()}
                  </span>
                ))}
            </span>
          )}
          {live.length > 0 && (
            <span className="mt-1 block text-xs text-slate-600">
              {live.map((l, i) => (
                <span key={l.id}>
                  {i > 0 && ' · '}
                  <Link href={`/lenders/${l.id}`} className="font-medium hover:underline">
                    {l.name}
                  </Link>
                  {l.person && ` (with ${l.person})`} — {SUBMISSION_LABELS[l.status].toLowerCase()}
                </span>
              ))}
            </span>
          )}
        </span>

        <span className="text-xs font-medium text-slate-500 sm:pt-0.5">Last activity</span>
        <span className="text-slate-700">
          {last ? (
            <>
              <span className="text-slate-400">{new Date(last.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · </span>
              {last.text}
            </>
          ) : (
            <span className="text-slate-400">Nothing yet</span>
          )}
        </span>
      </div>
    </section>
  )
}
