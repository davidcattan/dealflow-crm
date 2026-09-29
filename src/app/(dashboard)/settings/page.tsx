import { createClient } from '@/lib/supabase/server'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ outlook_connected?: string; outlook_error?: string }>
}) {
  const { outlook_connected, outlook_error } = await searchParams
  const supabase = await createClient()
  const { data: connection } = await supabase
    .from('outlook_connections')
    .select('account_email, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

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
          Lets the CRM create draft emails directly in a mailbox, and read that mailbox&apos;s
          inbox to log lender replies and pick up new deal submissions. Nothing sends
          automatically — a person reviews and sends every draft.
        </p>

        {connection ? (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Connected as <span className="font-medium">{connection.account_email}</span>
            {connection.updated_at && (
              <span className="text-slate-400"> — last refreshed {new Date(connection.updated_at).toLocaleString()}</span>
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-400">Not connected yet.</p>
        )}

        <a
          href="/api/auth/microsoft/connect"
          className="mt-4 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {connection ? 'Reconnect Outlook' : 'Connect Outlook'}
        </a>
      </section>
    </div>
  )
}
