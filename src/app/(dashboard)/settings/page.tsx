import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { InboxControls } from './inbox-controls'
import { RetryButton } from './retry-button'
import { DisconnectButton } from './disconnect-button'

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
  const [{ data: connections }, { data: syncState }, { data: recent }] = await Promise.all([
    supabase
      .from('outlook_connections')
      .select('id, account_email, connected_by, created_at, updated_at')
      .order('created_at', { ascending: true }),
    supabase.from('inbox_sync_state').select('*').eq('id', 1).maybeSingle(),
    supabase
      .from('inbox_messages')
      .select('id, from_email, subject, received_at, classification, deal_id, summary, action_taken, mailbox, deals(company_name)')
      .order('received_at', { ascending: false })
      .limit(30),
  ])

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

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Inbox</h2>
        <p className="mt-1 text-sm text-slate-600">
          Reads new mail in the connected inbox. New deal submissions become deals (attachments
          included), follow-ups are logged on the existing deal, and lender replies are logged on
          the deal they answer.
        </p>
        {syncState?.last_run_at && (
          <p className="mt-2 text-xs text-slate-500">
            Last check {new Date(syncState.last_run_at).toLocaleString()} — {syncState.last_run_status}
            {syncState.last_error && <span className="text-red-600"> ({syncState.last_error})</span>}
          </p>
        )}
        <InboxControls
          connected={Boolean(connections && connections.length > 0)}
          autoSyncEnabled={Boolean(syncState?.auto_sync_enabled)}
          hasRunBefore={Boolean(syncState?.last_synced_at)}
        />

        {recent && recent.length > 0 && (
          <div className="mt-5 overflow-hidden rounded-lg border border-slate-200">
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
                      <td className="truncate px-3 py-2">
                        {m.deal_id ? (
                          <Link href={`/deals/${m.deal_id}`} className="text-slate-800 hover:underline">
                            {deal?.company_name ?? 'Open deal'}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
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
