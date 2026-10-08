import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { NewLenderForm } from './new-lender-form'
import { LenderFilterBar } from './filter-bar'
import { formatCompactCurrency } from '@/lib/format'
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
  | 'size_desc'
  | 'size_asc'

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
  // Loan size sorts are done below (by the largest amount the lender does).
  size_desc: { column: 'name', ascending: true },
  size_asc: { column: 'name', ascending: true },
}

// The biggest loan a lender does: its max if set, otherwise its minimum.
function loanSize(l: { min_loan_amount: number | null; max_loan_amount: number | null }) {
  if (l.max_loan_amount && l.max_loan_amount > 0) return l.max_loan_amount
  return l.min_loan_amount && l.min_loan_amount > 0 ? l.min_loan_amount : null
}

export default async function LendersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; type?: string }>
}) {
  const { q, sort, type } = await searchParams
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
  const filtered = activeType ? withKeys.filter((l) => l.typeKeys.includes(activeType)) : withKeys
  // Loan size order; lenders with no size listed always go last.
  const lenders =
    sortKey === 'size_desc' || sortKey === 'size_asc'
      ? [...filtered].sort((a, b) => {
          const x = loanSize(a)
          const y = loanSize(b)
          if (x === null && y === null) return a.name.localeCompare(b.name)
          if (x === null) return 1
          if (y === null) return -1
          return sortKey === 'size_desc' ? y - x : x - y
        })
      : filtered

  // Clicking the "Loan size" header flips between largest-first and smallest-first.
  const sizeSortHref = (() => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (type) params.set('type', type)
    params.set('sort', sortKey === 'size_desc' ? 'size_asc' : 'size_desc')
    return `/lenders?${params.toString()}`
  })()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Lenders</h1>
          <p className="mt-1 text-sm text-slate-500">
            {activeType || q
              ? `${lenders.length} of ${withKeys.length} lenders`
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
        <LenderFilterBar typeOptions={typeOptions} />
        <NewLenderForm />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Lender</th>
              <th className="px-4 py-3">
                <Link href={sizeSortHref} className="inline-flex items-center gap-1 hover:text-slate-800" title="Sort by loan size">
                  Loan size
                  <span className={sortKey === 'size_desc' || sortKey === 'size_asc' ? 'text-slate-800' : 'text-slate-300'}>
                    {sortKey === 'size_asc' ? '▲' : '▼'}
                  </span>
                </Link>
              </th>
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
                  {q || activeType
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
