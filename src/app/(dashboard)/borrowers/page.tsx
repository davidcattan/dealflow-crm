import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { NewBorrowerForm } from './new-borrower-form'

export default async function BorrowersPage() {
  const supabase = await createClient()
  const { data: borrowers } = await supabase
    .from('borrowers')
    .select('id, company_name, industry, status, contact_name, created_at')
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Borrowers</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every deal you&apos;re working, in one place.
          </p>
        </div>
      </div>

      <NewBorrowerForm />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Industry</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {borrowers && borrowers.length > 0 ? (
              borrowers.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/borrowers/${b.id}`}
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
                      {b.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(b.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  No borrowers yet. Add your first one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
