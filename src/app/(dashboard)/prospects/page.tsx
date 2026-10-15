import { createClient } from '@/lib/supabase/server'
import type { Prospect } from '@/lib/prospects/types'
import { ProspectsTable } from './prospects-table'

// Everyone on the outreach lists, and where each one stands. The inbox sync
// marks people Emailed when you write to them and sorts their replies.
export default async function ProspectsPage() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('prospects').select('*').order('company').limit(5000)
  const missing = Boolean(error && error.message.includes('prospects'))

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Prospects</h1>
        <p className="text-sm text-slate-500">
          Companies from the ABL Advisor lists and who you&apos;ve contacted. When someone replies, the inbox sync sorts it: interested replies
          become deals, &quot;not interested&quot; gets marked, auto-replies are ignored.
        </p>
      </div>
      {missing ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Run migration <code>043_prospects.sql</code> in Supabase to turn this on.
        </p>
      ) : (
        <ProspectsTable prospects={(data ?? []) as Prospect[]} />
      )}
    </div>
  )
}
