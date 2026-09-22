import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { NewDealForm } from './new-deal-form'
import { DealSortBar } from './sort-bar'
import { BackfillIndustryButton } from './backfill-industry-button'
import {
  STATUS_LABELS,
  DEAL_STATUSES,
  activityScoreColor,
  matchScoreColor,
  type DealStatus,
} from '@/lib/types'
import { formatDateOnly } from '@/lib/format'

const RESOLVED_STATUSES = ['closed', 'dead']

type DealRow = {
  id: string
  company_name: string
  industry: string | null
  status: DealStatus
  contact_name: string | null
  activity_score: number | null
  created_at: string
  deal_matches: { score: number }[]
}

function topMatchScore(deal: DealRow): number | null {
  if (!deal.deal_matches || deal.deal_matches.length === 0) return null
  return Math.max(...deal.deal_matches.map((m) => m.score))
}

function sortDeals(deals: DealRow[], sort: string): DealRow[] {
  const sorted = [...deals]
  switch (sort) {
    case 'date_asc':
      sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      break
    case 'activity_desc':
      sorted.sort((a, b) => (b.activity_score ?? -1) - (a.activity_score ?? -1))
      break
    case 'activity_asc':
      sorted.sort((a, b) => (a.activity_score ?? 11) - (b.activity_score ?? 11))
      break
    case 'name_asc':
      sorted.sort((a, b) => a.company_name.localeCompare(b.company_name))
      break
    case 'name_desc':
      sorted.sort((a, b) => b.company_name.localeCompare(a.company_name))
      break
    case 'status':
      sorted.sort((a, b) => DEAL_STATUSES.indexOf(a.status) - DEAL_STATUSES.indexOf(b.status))
      break
    case 'match_desc':
      sorted.sort((a, b) => (topMatchScore(b) ?? -1) - (topMatchScore(a) ?? -1))
      break
    case 'date_desc':
    default:
      sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      break
  }
  return sorted
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; sort?: string }>
}) {
  const { view, sort } = await searchParams
  const showPast = view === 'past'

  const supabase = await createClient()
  let query = supabase
    .from('deals')
    .select(
      'id, company_name, industry, status, contact_name, activity_score, created_at, deal_matches(score)'
    )

  query = showPast
    ? query.in('status', RESOLVED_STATUSES)
    : query.not('status', 'in', `(${RESOLVED_STATUSES.join(',')})`)

  const [{ data: rawDeals }, { count: missingIndustryCount }] = await Promise.all([
    query,
    supabase.from('deals').select('*', { count: 'exact', head: true }).is('industry', null),
  ])
  const deals = sortDeals((rawDeals ?? []) as DealRow[], sort ?? 'date_desc')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Deals</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every deal you&apos;re working, in one place.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <BackfillIndustryButton missingCount={missingIndustryCount ?? 0} />
          <Link
            href="/deals/import"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Import from file
          </Link>
        </div>
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

      <div className="flex justify-end">
        <DealSortBar />
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
              <th className="px-4 py-3">Matches</th>
              <th className="px-4 py-3">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {deals.length > 0 ? (
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
                  <td className="px-4 py-3">
                    {b.activity_score !== null ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${activityScoreColor(b.activity_score)}`}
                        />
                        <span className="text-slate-600">
                          {b.activity_score}
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const score = topMatchScore(b)
                      const count = b.deal_matches?.length ?? 0
                      if (score === null) {
                        return <span className="text-slate-400">—</span>
                      }
                      return (
                        <Link
                          href={`/deals/${b.id}#lender-matches`}
                          className="inline-flex items-center gap-1.5 hover:underline"
                        >
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${matchScoreColor(score)}`}
                          />
                          <span className="text-slate-600">
                            {count} match{count === 1 ? '' : 'es'}
                          </span>
                        </Link>
                      )
                    })()}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDateOnly(b.created_at)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={7}
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
