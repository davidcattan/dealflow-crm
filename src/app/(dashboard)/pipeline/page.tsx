import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  PIPELINE_STATUSES,
  STATUS_LABELS,
  STATUS_COLORS,
  type BorrowerStatus,
} from '@/lib/types'
import { StatusSelect } from './status-select'

function daysAgo(dateStr: string) {
  const days = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  )
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

export default async function PipelinePage() {
  const supabase = await createClient()

  const [{ data: borrowers }, { count: resolvedCount }] = await Promise.all([
    supabase
      .from('borrowers')
      .select('id, company_name, industry, contact_name, status, updated_at')
      .in('status', PIPELINE_STATUSES)
      .order('updated_at', { ascending: false }),
    supabase
      .from('borrowers')
      .select('*', { count: 'exact', head: true })
      .in('status', ['closed', 'dead']),
  ])

  const deals = (borrowers ?? []).slice().sort((a, b) => {
    const stageDiff =
      PIPELINE_STATUSES.indexOf(a.status as BorrowerStatus) -
      PIPELINE_STATUSES.indexOf(b.status as BorrowerStatus)
    if (stageDiff !== 0) return stageDiff
    return (
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )
  })

  const counts = PIPELINE_STATUSES.map((status) => ({
    status,
    count: deals.filter((d) => d.status === status).length,
  }))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Pipeline</h1>
          <p className="mt-1 text-sm text-slate-500">
            {deals.length} active deal{deals.length === 1 ? '' : 's'}
          </p>
        </div>
        {resolvedCount ? (
          <Link
            href="/borrowers"
            className="text-sm text-slate-500 hover:underline"
          >
            {resolvedCount} closed / dead — view all borrowers
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {counts.map(({ status, count }) => (
          <span
            key={status}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"
          >
            <span
              className={`h-2 w-2 rounded-full ${STATUS_COLORS[status]}`}
            />
            {STATUS_LABELS[status]}
            <span className="font-semibold text-slate-800">{count}</span>
          </span>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Company</th>
              <th className="px-4 py-2.5">Industry</th>
              <th className="px-4 py-2.5">Contact</th>
              <th className="px-4 py-2.5">Stage</th>
              <th className="px-4 py-2.5">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {deals.length > 0 ? (
              deals.map((deal) => (
                <tr key={deal.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <span
                      className={`mr-2 inline-block h-2 w-2 rounded-full ${STATUS_COLORS[deal.status as BorrowerStatus]}`}
                    />
                    <Link
                      href={`/borrowers/${deal.id}`}
                      className="font-medium text-slate-800 hover:underline"
                    >
                      {deal.company_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {deal.industry ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {deal.contact_name ?? '—'}
                  </td>
                  <td className="px-4 py-2">
                    <StatusSelect
                      borrowerId={deal.id}
                      status={deal.status as BorrowerStatus}
                    />
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {daysAgo(deal.updated_at)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  No active deals right now.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
