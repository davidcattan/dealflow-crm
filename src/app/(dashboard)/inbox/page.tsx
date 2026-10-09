import Link from 'next/link'
import { mailboxLabel } from '@/lib/outlook/mailbox-label'
import { createClient } from '@/lib/supabase/server'
import { InboxControls } from '../settings/inbox-controls'
import { RetryButton } from '../settings/retry-button'
import { AssignToDeal, LinkLender } from '../settings/assign-to-deal'
import { getInboxHealth } from '@/lib/inbox/health'
import { TimeAgo } from '@/components/time-ago'

const KIND_STYLES: Record<string, string> = {
  new_deal: 'bg-emerald-100 text-emerald-800',
  lender_reply: 'bg-violet-100 text-violet-800',
  other: 'bg-slate-100 text-slate-600',
  error: 'bg-red-100 text-red-700',
  sent: 'bg-sky-100 text-sky-800',
}
const KIND_LABELS: Record<string, string> = {
  new_deal: 'Deal',
  lender_reply: 'Lender reply',
  other: 'Other',
  error: 'Error',
  sent: 'Sent',
}

export default async function InboxPage() {
  const supabase = await createClient()
  const [{ data: connections }, { data: syncState }, { data: recent }, health, { data: runs }, { data: dealRows }] = await Promise.all([
    supabase
      .from('outlook_connections')
      .select('id, account_email, connected_by, created_at, updated_at, email_intro, email_signature')
      .order('created_at', { ascending: true }),
    supabase.from('inbox_sync_state').select('*').eq('id', 1).maybeSingle(),
    supabase
      .from('inbox_messages')
      .select('id, from_email, to_emails, subject, received_at, classification, deal_id, lender_id, summary, action_taken, mailbox, deals(company_name)')
      .order('received_at', { ascending: false })
      .limit(30),
    getInboxHealth(supabase),
    supabase
      .from('inbox_sync_runs')
      .select('id, kind, started_at, finished_at, summary, error')
      .order('started_at', { ascending: false })
      .limit(12),
    supabase.from('deals').select('id, company_name, status, updated_at').order('updated_at', { ascending: false }),
  ])
  // Active deals first, then the rest — for "Add to deal".
  const dealOptions = [...(dealRows ?? [])]
    .sort((a, b) => Number(['dead', 'old', 'closed'].includes(a.status)) - Number(['dead', 'old', 'closed'].includes(b.status)))
    .map((d) => ({ id: d.id as string, name: d.company_name as string }))
  // Fix-it buttons for one email (retry, re-file, link a lender).
  type Logged = NonNullable<typeof recent>[number]
  const emailActions = (m: Logged) => (
    <>
      {(m.classification === 'error' || (m.classification === 'lender_reply' && !m.deal_id)) && <RetryButton messageId={m.id} />}
      {m.classification !== 'sent' &&
        m.classification !== 'error' &&
        teamEmails.has(String(m.from_email ?? '').toLowerCase()) &&
        String(m.mailbox ?? '').toLowerCase() !== String(m.from_email ?? '').toLowerCase() && (
          <RetryButton messageId={m.id} label="Re-file as sent email" />
        )}
      {m.classification === 'lender_reply' && m.deal_id && !m.lender_id && <LinkLender messageId={m.id} dealId={m.deal_id} />}
    </>
  )
  // Connected mailboxes — a teammate's email filed as incoming can be re-filed.
  const teamEmails = new Set((connections ?? []).map((c) => String(c.account_email).toLowerCase()))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Inbox</h1>
        <p className="mt-1 hidden text-sm text-slate-500 sm:block">
          Every email the CRM reads (inboxes and Sent folders) and what it did with it. Connect mailboxes in{' '}
          <Link href="/settings" className="underline hover:text-slate-700">
            Settings
          </Link>
          .
        </p>
      </div>

      <section id="inbox" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-sm font-semibold text-slate-900">Email reader</h2>
        <p className="mt-1 hidden text-sm text-slate-600 sm:block">
          Reads new mail in the connected inboxes and Sent folders. New deal submissions become deals (attachments
          included), follow-ups are logged on the existing deal, and lender replies are logged on
          the deal they answer.
        </p>
        <div
          className={`mt-4 flex items-start gap-3 rounded-lg border p-3 text-sm ${
            health.level === 'ok'
              ? 'border-emerald-200 bg-emerald-50'
              : health.level === 'problem'
                ? 'border-red-200 bg-red-50'
                : health.level === 'waiting'
                  ? 'border-amber-200 bg-amber-50'
                  : 'border-slate-200 bg-slate-50'
          }`}
        >
          <span
            className={`mt-1 h-3 w-3 shrink-0 rounded-full ${
              health.level === 'ok'
                ? 'animate-pulse bg-emerald-500'
                : health.level === 'problem'
                  ? 'bg-red-500'
                  : health.level === 'waiting'
                    ? 'bg-amber-400'
                    : 'bg-slate-300'
            }`}
          />
          <div>
            <p className="font-medium text-slate-900">{health.headline}</p>
            <p className="text-slate-600">
              {health.lastAutoAt && (
                <>
                  Last automatic check <TimeAgo iso={health.lastAutoAt} withTime />
                  {health.detail ? ' — ' : ''}
                </>
              )}
              {health.detail}
            </p>
            {health.level === 'ok' && (
              <p className="mt-0.5 hidden text-xs text-slate-500 sm:block">Next one within 30 minutes. Pauses overnight (10pm–7am ET).</p>
            )}
          </div>
        </div>
        {syncState?.last_error && health.level !== 'problem' && (
          <p className="mt-2 text-xs text-red-600">Last check note: {syncState.last_error}</p>
        )}
        <InboxControls
          connected={Boolean(connections && connections.length > 0)}
          autoSyncEnabled={Boolean(syncState?.auto_sync_enabled)}
          hasRunBefore={Boolean(syncState?.last_synced_at)}
        />

        {runs && runs.length > 0 && (
          <details className="group mt-5">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 hover:text-slate-800">
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden="true">
                <path d="M7.2 4.2a1 1 0 0 1 1.4 0l5.1 5.1a1 1 0 0 1 0 1.4l-5.1 5.1a1 1 0 1 1-1.4-1.4L11.6 10 7.2 5.6a1 1 0 0 1 0-1.4Z" />
              </svg>
              Recent checks ({runs.length})
            </summary>
            <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                  <span className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        r.kind === 'auto' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {r.kind === 'auto' ? 'Automatic' : 'Manual'}
                    </span>
                    <span className="text-slate-500">
                      <TimeAgo iso={r.started_at} withTime />
                    </span>
                  </span>
                  <span className={`text-xs ${r.error ? 'text-red-600' : 'text-slate-600'}`}>
                    {r.error ?? r.summary ?? (r.finished_at ? 'Done' : 'Running…')}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

      </section>

      {recent && recent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Email log</h2>

          {/* Phone: one card per email. */}
          <ul className="space-y-2.5 sm:hidden">
            {recent.map((m) => {
              const deal = Array.isArray(m.deals) ? m.deals[0] : m.deals
              const where = mailboxLabel(m.mailbox as string | null, m.classification === 'sent')
              return (
                <li key={m.id} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${KIND_STYLES[m.classification] ?? ''}`}>
                      {KIND_LABELS[m.classification] ?? m.classification}
                    </span>
                    <span className="truncate text-[11px] text-slate-400">
                      {m.received_at && new Date(m.received_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      {where && ` · ${where}`}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm font-medium leading-snug text-slate-900">{m.subject || '(no subject)'}</p>
                  <p className="truncate text-xs text-slate-500">
                    {m.classification === 'sent' ? `to ${m.to_emails ?? ''}` : m.from_email}
                  </p>
                  <p className="mt-2 text-xs font-medium text-slate-700">{m.action_taken}</p>
                  {m.summary && <p className="mt-0.5 line-clamp-3 text-xs text-slate-600">{m.summary}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-2 text-sm">
                    {m.deal_id ? (
                      <Link href={`/deals/${m.deal_id}`} className="font-medium text-slate-800 underline">
                        {deal?.company_name ?? 'Open deal'} →
                      </Link>
                    ) : (
                      <AssignToDeal messageId={m.id} deals={dealOptions} />
                    )}
                    {emailActions(m)}
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:block">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="w-[12%] px-3 py-2">Type</th>
                  <th className="w-[30%] px-3 py-2">Email</th>
                  <th className="w-[40%] px-3 py-2">What happened</th>
                  <th className="w-[18%] px-3 py-2">Deal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.map((m) => {
                  const deal = Array.isArray(m.deals) ? m.deals[0] : m.deals
                  const where = mailboxLabel(m.mailbox as string | null, m.classification === 'sent')
                  return (
                    <tr key={m.id} className="align-top">
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${KIND_STYLES[m.classification] ?? ''}`}>
                          {KIND_LABELS[m.classification] ?? m.classification}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <p className="truncate font-medium text-slate-800" title={m.subject ?? ''}>
                          {m.subject || '(no subject)'}
                        </p>
                        <p className="truncate text-xs text-slate-500" title={m.from_email ?? ''}>
                          {m.classification === 'sent' ? `to ${m.to_emails ?? ''}` : m.from_email}
                          {m.received_at && ` · ${new Date(m.received_at).toLocaleDateString()}`}
                          {where && ` · ${where}`}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        <p className="font-medium text-slate-700">{m.action_taken}</p>
                        {m.summary && <p className="mt-0.5 line-clamp-2">{m.summary}</p>}
                        {emailActions(m)}
                      </td>
                      <td className={`px-3 py-2 ${m.deal_id ? 'truncate' : ''}`}>
                        {m.deal_id ? (
                          <Link href={`/deals/${m.deal_id}`} className="text-slate-800 hover:underline">
                            {deal?.company_name ?? 'Open deal'}
                          </Link>
                        ) : (
                          <AssignToDeal messageId={m.id} deals={dealOptions} />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
