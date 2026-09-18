import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PIPELINE_STATUSES, STATUS_LABELS, type BorrowerStatus } from '@/lib/types'
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

  const columns = PIPELINE_STATUSES.map((status) => ({
    status,
    deals: (borrowers ?? []).filter((b) => b.status === status),
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Pipeline</h1>
          <p className="mt-1 text-sm text-slate-500">
            Your active deals, by stage.
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

      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((col) => (
          <div key={col.status} className="w-72 flex-shrink-0">
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-slate-700">
                {STATUS_LABELS[col.status]}
              </h2>
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                {col.deals.length}
              </span>
            </div>

            <div className="space-y-3">
              {col.deals.length > 0 ? (
                col.deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <Link
                      href={`/borrowers/${deal.id}`}
                      className="text-sm font-medium text-slate-800 hover:underline"
                    >
                      {deal.company_name}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {deal.industry ?? 'No industry'}
                      {deal.contact_name ? ` · ${deal.contact_name}` : ''}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Updated {daysAgo(deal.updated_at)}
                    </p>
                    <StatusSelect
                      borrowerId={deal.id}
                      status={deal.status as BorrowerStatus}
                    />
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                  No deals here
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
