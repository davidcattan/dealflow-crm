import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { DisconnectButton } from './disconnect-button'
import { EmailProfile } from './email-profile'

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
  const { data: connections } = await supabase
    .from('outlook_connections')
    .select('id, account_email, connected_by, created_at, updated_at, email_intro, email_signature')
    .order('created_at', { ascending: true })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Mailbox connections and your email intro &amp; signature.</p>
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

      <p className="text-sm text-slate-500">
        Looking for the email log and inbox status? They&apos;re on the{' '}
        <Link href="/inbox" className="underline hover:text-slate-700">
          Inbox
        </Link>{' '}
        page.
      </p>
    </div>
  )
}
