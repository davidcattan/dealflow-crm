import { createClient } from '@/lib/supabase/server'
import type { Prospect } from '@/lib/prospects/types'
import { ProspectsTable } from './prospects-table'

// Everyone on the outreach lists (any source), and where each one stands. The inbox sync
// marks people Emailed when you write to them and sorts their replies.
export default async function ProspectsPage() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('prospects').select('*').order('company').limit(5000)
  // Your own prospect email (Settings), for the preview — the drafts use it too.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: mine } = await supabase
    .from('outlook_connections')
    .select('*')
    .eq('connected_by', user?.id ?? '')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const missing = Boolean(error && error.message.includes('prospects'))

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Prospects</h1>
        <p className="text-sm text-slate-500">Everyone you&apos;re reaching out to. Replies are sorted automatically — interested ones become deals.</p>
      </div>
      {missing ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Run migration <code>043_prospects.sql</code> in Supabase to turn this on.
        </p>
      ) : (
        <ProspectsTable prospects={(data ?? []) as Prospect[]} template={{ subject: mine?.prospect_subject, body: mine?.prospect_body }} />
      )}
    </div>
  )
}
