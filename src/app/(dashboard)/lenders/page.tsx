import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { NewLenderForm } from './new-lender-form'
import { LenderFilterBar } from './filter-bar'

function formatAmount(n: number | null) {
  if (n === null) return '—'
  return `$${n.toLocaleString()}`
}

function formatLoanRange(min: number | null, max: number | null) {
  if (min === null && max === null) return '—'
  if (min !== null && max !== null && max !== min) {
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
  searchParams: Promise<{ q?: string; sort?: string }>
}) {
  const { q, sort } = await searchParams
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

  const { data: lenders } = await query.order(sortConfig.column, {
    ascending: sortConfig.ascending,
    nullsFirst: sortConfig.nullsFirst,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Lenders</h1>
          <p className="mt-1 text-sm text-slate-500">
            Your lender network and their mandates.
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
        <LenderFilterBar />
        <NewLenderForm />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Lender</th>
              <th className="px-4 py-3">Minimum loan</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
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
                  <td className="max-w-xs truncate px-4 py-3 text-slate-600">
                    {l.asset_types.length > 0
                      ? l.asset_types.join(', ')
                      : (l.lending_type ?? '—')}
                  </td>
                  <td className="px-4 py-3">
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
                  {q
                    ? `No lenders match "${q}".`
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
