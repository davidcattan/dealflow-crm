import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { NewLenderForm } from './new-lender-form'

function formatAmount(n: number | null) {
  if (n === null) return '—'
  return `$${n.toLocaleString()}`
}

export default async function LendersPage() {
  const supabase = await createClient()
  const { data: lenders } = await supabase
    .from('lenders')
    .select(
      'id, name, min_loan_amount, max_loan_amount, asset_types, lending_type, status, created_at'
    )
    .order('created_at', { ascending: false })

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

      <NewLenderForm />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Lender</th>
              <th className="px-4 py-3">Loan range</th>
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
                    {formatAmount(l.min_loan_amount)} –{' '}
                    {formatAmount(l.max_loan_amount)}
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
                  No lenders yet. Add your first one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
