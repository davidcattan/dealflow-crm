import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { InboxControls } from './inbox-controls'
import { RetryButton } from './retry-button'
import { AssignToDeal } from './assign-to-deal'
import { DisconnectButton } from './disconnect-button'
import { EmailProfile } from './email-profile'
import { getInboxHealth } from '@/lib/inbox/health'
import { TimeAgo } from '@/components/time-ago'

const KIND_STYLES: Record<string, string> = {
  new_deal: 'bg-emerald-100 text-emerald-800',
  lender_reply: 'bg-violet-100 text-violet-800',
  other: 'bg-slate-100 text-slate-600',
  error: 'bg-red-100 text-red-700',
}
const KIND_LABELS: Record<string, string> = {
  new_deal: 'Deal',
  lender_reply: 'Lender reply',
  other: 'Other',
  error: 'Error',
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ outlook_connected?: string; outlook_error?: string }>
}) {
  const { outlook_connected, outlook_error } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const [{ data: connections }, { data: syncState }, { data: recent }, health, { data: runs }, { data: dealRows }] = await Promise.all([
    supabase
      .from('outlook_connections')
      .select('id, account_email, connected_by, created_at, updated_at, email_intro, email_signature')
      .order('created_at', { ascending: true }),
    supabase.from('inbox_sync_state').select('*').eq('id', 1).maybeSingle(),
    supabase
      .from('inbox_messages')
      .select('id, from_email, subject, received_at, classification, deal_id, summary, action_taken, mailbox, deals(company_name)')
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Connections and account-level options.</p>
      </div>

      {outlook_connected && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Outlook connected successfully.
        </p>
      )}
      {outlook_error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Couldn&apos;t connect Outlook: {outlook_error}
        </p>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Outlook</h2>
        <p className="mt-1 text-sm text-slate-600">
          Each person connects their own Outlook. The CRM creates lender drafts in the mailbox of whoever clicks
          &ldquo;Create draft in Outlook&rdquo;, and reads every connected inbox to log lender replies and pick up new
          deals. Nothing sends automatically — a person reviews and sends every draft.
        </p>

        {connections && connections.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {connections.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              >
                <span>
                  <span className="font-medium">{c.account_email}</span>
                  {c.connected_by === user?.id && <span className="ml-2 text-xs text-emerald-700">connected by you</span>}
                  {c.updated_at && (
                    <span className="text-xs text-slate-400"> — last refreshed {new Date(c.updated_at).toLocaleString()}</span>
                  )}
                </span>
                <DisconnectButton connectionId={c.id} email={c.account_email} />
                <div className="w-full">
                  <EmailProfile
                    connectionId={c.id}
                    email={c.account_email}
                    intro={c.email_intro}
                    signature={c.email_signature}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-slate-400">No mailboxes connected yet.</p>
        )}

        <a
          href="/api/auth/microsoft/connect"
          className="mt-4 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Connect my Outlook
        </a>
        <p className="mt-2 text-xs text-slate-500">
          Sign in with your own work email. Connecting a mailbox that&apos;s already listed just refreshes it — it never
          removes anyone else&apos;s.
        </p>
      </section>

      <section id="inbox" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Inbox</h2>
        <p className="mt-1 text-sm text-slate-600">
          Reads new mail in the connected inbox. New deal submissions become deals (attachments
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
              <p className="mt-0.5 text-xs text-slate-500">Next one within 30 minutes. Pauses overnight (10pm–7am ET).</p>
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

        {recent && recent.length > 0 && (
          <div className="mt-5 rounded-lg border border-slate-200">
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
                          {m.from_email}
                          {m.received_at && ` · ${new Date(m.received_at).toLocaleDateString()}`}
                          {m.mailbox && ` · in ${String(m.mailbox).split('@')[0]}'s inbox`}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        <p className="font-medium text-slate-700">{m.action_taken}</p>
                        {m.summary && <p className="mt-0.5 line-clamp-2">{m.summary}</p>}
                        {(m.classification === 'error' ||
                          (m.classification === 'lender_reply' && !m.deal_id)) && <RetryButton messageId={m.id} />}
                      </td>
                      <td className={`px-3 py-2 ${m.deal_id ? "truncate" : ""}`}>
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
        )}
      </section>
    </div>
  )
}
