import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { NewLenderForm } from './new-lender-form'
import { LenderFilterBar } from './filter-bar'
import { formatCompactCurrency, parseCompactCurrency } from '@/lib/format'
import { LENDER_TYPE_GROUPS, lenderTypeKeys, type LenderTypeKey } from '@/lib/lenders/type-groups'

function formatAmount(n: number | null) {
  return formatCompactCurrency(n, { zeroLabel: 'No minimum' })
}

function formatLoanRange(min: number | null, max: number | null) {
  if (min === null && max === null) return '—'
  if (min !== null && max !== null && max !== min && max !== 0) {
    return `${formatAmount(min)} – ${formatAmount(max)}`
  }
  return formatAmount(min ?? max)
}

type SortKey =
  | 'name_asc'
  | 'name_desc'
  | 'min_loan_asc'
  | 'min_loan_desc'
  | 'max_loan_asc'
  | 'max_loan_desc'
  | 'recent'

const SORT_CONFIG: Record<
  SortKey,
  { column: string; ascending: boolean; nullsFirst?: boolean }
> = {
  name_asc: { column: 'name', ascending: true },
  name_desc: { column: 'name', ascending: false },
  min_loan_asc: { column: 'min_loan_amount', ascending: true, nullsFirst: false },
  min_loan_desc: { column: 'min_loan_amount', ascending: false, nullsFirst: false },
  max_loan_asc: { column: 'max_loan_amount', ascending: true, nullsFirst: false },
  max_loan_desc: { column: 'max_loan_amount', ascending: false, nullsFirst: false },
  recent: { column: 'created_at', ascending: false },
}

export default async function LendersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; type?: string; size?: string; unsized?: string }>
}) {
  const { q, sort, type, size, unsized } = await searchParams
  const sortKey: SortKey = sort && sort in SORT_CONFIG ? (sort as SortKey) : 'name_asc'
  const sortConfig = SORT_CONFIG[sortKey]

  const supabase = await createClient()
  let query = supabase
    .from('lenders')
    .select(
      'id, name, min_loan_amount, max_loan_amount, asset_types, lending_type, status, created_at'
    )

  if (q) {
    query = query.ilike('name', `%${q}%`)
  }

  const { data: allLenders } = await query.order(sortConfig.column, {
    ascending: sortConfig.ascending,
    nullsFirst: sortConfig.nullsFirst,
  })

  // Lender-type filter: groups built from each lender's free-text type.
  const withKeys = (allLenders ?? []).map((l) => ({ ...l, typeKeys: lenderTypeKeys(l) }))
  const typeOptions = [
    ...LENDER_TYPE_GROUPS.map((g) => ({ key: g.key as LenderTypeKey, label: g.label })),
    { key: 'unknown' as LenderTypeKey, label: 'Type not set' },
  ]
    .map((o) => ({ ...o, count: withKeys.filter((l) => l.typeKeys.includes(o.key)).length }))
    .filter((o) => o.count > 0)
  const activeType = typeOptions.some((o) => o.key === type) ? (type as LenderTypeKey) : null
  const byType = activeType ? withKeys.filter((l) => l.typeKeys.includes(activeType)) : withKeys

  // Deal-size filter: lenders whose loan range fits the amount. A missing
  // minimum (or 0 = "No minimum") means no floor; a missing/0 max means no cap.
  // Lenders with no size at all are left out unless asked for.
  const dealSize = parseCompactCurrency(size ?? null)
  const hasSize = (l: (typeof byType)[number]) => l.min_loan_amount !== null || (l.max_loan_amount ?? 0) > 0
  const fits = (l: (typeof byType)[number]) =>
    (l.min_loan_amount === null || l.min_loan_amount <= dealSize!) &&
    (!l.max_loan_amount || l.max_loan_amount >= dealSize!)
  const unsizedCount = dealSize ? byType.filter((l) => !hasSize(l)).length : 0
  const lenders = dealSize
    ? byType.filter((l) => (hasSize(l) ? fits(l) : unsized === '1'))
    : byType

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Lenders</h1>
          <p className="mt-1 text-sm text-slate-500">
            {activeType || q || dealSize
              ? `${lenders.length} of ${withKeys.length} lenders${dealSize ? ` that can do ${formatCompactCurrency(dealSize)}` : ''}`
              : 'Your lender network and their mandates.'}
          </p>
        </div>
        <Link
          href="/lenders/import"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          Import from file
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <LenderFilterBar typeOptions={typeOptions} unsizedCount={unsizedCount} />
        <NewLenderForm />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Lender</th>
              <th className="px-4 py-3">Minimum loan</th>
              <th className="hidden px-4 py-3 sm:table-cell">Type</th>
              <th className="hidden px-4 py-3 sm:table-cell">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lenders && lenders.length > 0 ? (
              lenders.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/lenders/${l.id}`}
                      className="font-medium text-slate-800 hover:underline"
                    >
                      {l.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatLoanRange(l.min_loan_amount, l.max_loan_amount)}
                  </td>
                  <td className="hidden max-w-xs truncate px-4 py-3 text-slate-600 sm:table-cell">
                    {l.asset_types.length > 0
                      ? l.asset_types.join(', ')
                      : (l.lending_type ?? '—')}
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {l.status}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  {q || activeType || dealSize
                    ? 'No lenders match these filters.'
                    : 'No lenders yet. Add your first one above.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
