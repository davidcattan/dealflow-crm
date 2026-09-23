import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { NewDealForm } from './new-deal-form'
import { DealSortBar } from './sort-bar'
import { BackfillButton } from './backfill-button'
import { BulkDeadBar, SelectAllCheckbox } from './bulk-select'
import { SearchBar } from '@/components/search-bar'
import { matchesSearch } from '@/lib/search'
import { INDUSTRY_CATEGORIES, LOAN_TYPE_CATEGORIES } from '@/lib/deals/categories'
import {
  STATUS_LABELS,
  displayStatus,
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
  rep_name: string | null
  notes: string | null
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
      sorted.sort((a, b) => DEAL_STATUSES.indexOf(displayStatus(a.status)) - DEAL_STATUSES.indexOf(displayStatus(b.status)))
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
  searchParams: Promise<{ view?: string; sort?: string; q?: string }>
}) {
  const { view, sort, q } = await searchParams
  const showPast = view === 'past'

  const supabase = await createClient()
  let query = supabase
    .from('deals')
    .select(
      'id, company_name, industry, status, contact_name, rep_name, notes, activity_score, created_at, deal_matches(score)'
    )

  query = showPast
    ? query.in('status', RESOLVED_STATUSES)
    : query.not('status', 'in', `(${RESOLVED_STATUSES.join(',')})`)

  const [{ data: rawDeals }, { data: categoryCheck }] = await Promise.all([
    query,
    supabase.from('deals').select('industry, loan_type'),
  ])
  const searched = (
    q
      ? (rawDeals ?? []).filter((d) =>
          matchesSearch(q, [
            d.company_name,
            d.contact_name,
            d.rep_name,
            d.notes,
            formatDateOnly(d.created_at),
            d.created_at,
          ])
        )
      : (rawDeals ?? [])
  ) as DealRow[]
  const deals = sortDeals(searched, sort ?? 'date_desc')

  const suggestions = (rawDeals ?? []).map((d) => ({
    id: d.id,
    label: d.company_name,
    sublabel: d.contact_name,
    searchText: d.rep_name,
    href: `/deals/${d.id}`,
  }))

  const industrySet: readonly string[] = INDUSTRY_CATEGORIES
  const loanTypeSet: readonly string[] = LOAN_TYPE_CATEGORIES
  const nonStandardIndustryCount = (categoryCheck ?? []).filter(
    (d) => !d.industry || !industrySet.includes(d.industry)
  ).length
  const nonStandardLoanTypeCount = (categoryCheck ?? []).filter(
    (d) => !d.loan_type || !loanTypeSet.includes(d.loan_type)
  ).length

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
          <BackfillButton
            endpoint="/api/deals/backfill-industry"
            label="Standardize industries"
            missingCount={nonStandardIndustryCount}
          />
          <BackfillButton
            endpoint="/api/deals/backfill-loan-type"
            label="Standardize loan types"
            missingCount={nonStandardLoanTypeCount}
          />
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchBar
          placeholder="Search company, contact, rep, notes, date…"
          suggestions={suggestions}
        />
        <DealSortBar />
      </div>

      {!showPast && <BulkDeadBar />}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table
          id="deals-table"
          data-select="off"
          className="w-full table-fixed text-left text-sm [&_.sel-col]:hidden data-[select=on]:[&_.sel-col]:table-cell"
        >
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              {!showPast && (
                <th className="sel-col w-[4%] px-4 py-3">
                  <SelectAllCheckbox />
                </th>
              )}
              <th className="w-[22%] truncate px-4 py-3">Company</th>
              <th className="w-[16%] truncate px-4 py-3">Industry</th>
              <th className="w-[14%] truncate px-4 py-3">Contact</th>
              <th className="w-[12%] truncate px-4 py-3">Status</th>
              <th className="w-[10%] truncate px-4 py-3">Activity</th>
              <th className="w-[14%] truncate px-4 py-3">Matches</th>
              <th className="w-[12%] truncate px-4 py-3">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {deals.length > 0 ? (
              deals.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50 has-[input:checked]:bg-blue-50">
                  {!showPast && (
                    <td className="sel-col px-4 py-3">
                      <input
                        type="checkbox"
                        name="deal_ids"
                        value={b.id}
                        form="bulk-form"
                        aria-label={`Select ${b.company_name}`}
                        className="rounded border-slate-300"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <Link
                      href={`/deals/${b.id}`}
                      title={b.company_name}
                      className="block truncate font-medium text-slate-800 hover:underline"
                    >
                      {b.company_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div className="truncate" title={b.industry ?? undefined}>
                      {b.industry ?? '—'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div className="truncate" title={b.contact_name ?? undefined}>
                      {b.contact_name ?? '—'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-block max-w-full truncate rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {STATUS_LABELS[b.status as DealStatus]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {b.activity_score !== null ? (
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${activityScoreColor(b.activity_score)}`}
                        />
                        <span className="truncate text-slate-600">
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
                          className="flex min-w-0 items-center gap-1.5 hover:underline"
                        >
                          <span
                            className={`h-2.5 w-2.5 shrink-0 rounded-full ${matchScoreColor(score)}`}
                          />
                          <span className="truncate text-slate-600">
                            {count} match{count === 1 ? '' : 'es'}
                          </span>
                        </Link>
                      )
                    })()}
                  </td>
                  <td className="truncate px-4 py-3 text-slate-500">
                    {formatDateOnly(b.created_at)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={showPast ? 7 : 8}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  {q
                    ? 'No deals match your search.'
                    : showPast
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
