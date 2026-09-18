import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function DashboardHome() {
  const supabase = await createClient()

  const [{ count: borrowerCount }, { count: lenderCount }, { data: recentBorrowers }] =
    await Promise.all([
      supabase.from('borrowers').select('*', { count: 'exact', head: true }),
      supabase.from('lenders').select('*', { count: 'exact', head: true }),
      supabase
        .from('borrowers')
        .select('id, company_name, status, created_at')
        .order('created_at', { ascending: false })
        .limit(5),
    ])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Overview of your active deals and lender network.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-2">
        <Link
          href="/borrowers"
          className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:border-slate-300"
        >
          <p className="text-sm text-slate-500">Borrowers</p>
          <p className="mt-1 text-3xl font-semibold text-slate-900">
            {borrowerCount ?? 0}
          </p>
        </Link>
        <Link
          href="/lenders"
          className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:border-slate-300"
        >
          <p className="text-sm text-slate-500">Lenders</p>
          <p className="mt-1 text-3xl font-semibold text-slate-900">
            {lenderCount ?? 0}
          </p>
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Recent borrowers
          </h2>
        </div>
        {recentBorrowers && recentBorrowers.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {recentBorrowers.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/borrowers/${b.id}`}
                  className="flex items-center justify-between px-6 py-3 text-sm hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-800">
                    {b.company_name}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {b.status.replace('_', ' ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-6 py-8 text-center text-sm text-slate-400">
            No borrowers yet.{' '}
            <Link href="/borrowers" className="text-slate-700 underline">
              Add your first one
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  )
}
