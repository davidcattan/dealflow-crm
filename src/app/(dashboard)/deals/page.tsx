import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { NewDealForm } from './new-deal-form'
import { STATUS_LABELS, type DealStatus } from '@/lib/types'
import { formatDateOnly } from '@/lib/format'

const RESOLVED_STATUSES = ['closed', 'dead']

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const { view } = await searchParams
  const showPast = view === 'past'

  const supabase = await createClient()
  let query = supabase
    .from('deals')
    .select(
      'id, company_name, industry, status, contact_name, activity_score, created_at'
    )

  query = showPast
    ? query.in('status', RESOLVED_STATUSES)
    : query.not('status', 'in', `(${RESOLVED_STATUSES.join(',')})`)

  const { data: deals } = await query.order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Deals</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every deal you&apos;re working, in one place.
          </p>
        </div>
        <Link
          href="/deals/import"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          Import from file
        </Link>
      </div>

      <NewDealForm />

      <div className="flex gap-1 border-b border-slate-200">
        <Link
          href="/deals"
          className={`border-b-2 px-3 py-2 text-sm font-medium ${
            !showPast
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Active
        </Link>
        <Link
          href="/deals?view=past"
          className={`border-b-2 px-3 py-2 text-sm font-medium ${
            showPast
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Past / Dead
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Industry</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Activity</th>
              <th className="px-4 py-3">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {deals && deals.length > 0 ? (
              deals.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/deals/${b.id}`}
                      className="font-medium text-slate-800 hover:underline"
                    >
                      {b.company_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {b.industry ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {b.contact_name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {STATUS_LABELS[b.status as DealStatus]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {b.activity_score ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDateOnly(b.created_at)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  {showPast
                    ? 'No closed or dead deals yet.'
                    : 'No active deals yet. Add your first one above.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
