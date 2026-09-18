import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { updateLender } from './actions'

export default async function LenderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: lender } = await supabase
    .from('lenders')
    .select('*')
    .eq('id', id)
    .single()

  if (!lender) notFound()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          {lender.name}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Added {new Date(lender.created_at).toLocaleDateString()}
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Mandate</h2>
        <form
          action={updateLender}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <input type="hidden" name="lender_id" value={lender.id} />

          <div>
            <label className="block text-xs font-medium text-slate-600">
              Lender name
            </label>
            <input
              name="name"
              defaultValue={lender.name}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Status
            </label>
            <select
              name="status"
              defaultValue={lender.status}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Contact name
            </label>
            <input
              name="contact_name"
              defaultValue={lender.contact_name ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Contact email
            </label>
            <input
              name="contact_email"
              defaultValue={lender.contact_email ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Contact phone
            </label>
            <input
              name="contact_phone"
              defaultValue={lender.contact_phone ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Website
            </label>
            <input
              name="website"
              defaultValue={lender.website ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Min loan amount ($)
            </label>
            <input
              name="min_loan_amount"
              type="number"
              defaultValue={lender.min_loan_amount ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Max loan amount ($)
            </label>
            <input
              name="max_loan_amount"
              type="number"
              defaultValue={lender.max_loan_amount ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Asset types (comma separated)
            </label>
            <input
              name="asset_types"
              defaultValue={lender.asset_types.join(', ')}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Industries (comma separated)
            </label>
            <input
              name="industries"
              defaultValue={lender.industries.join(', ')}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600">
              Geographies (comma separated)
            </label>
            <input
              name="geographies"
              defaultValue={lender.geographies.join(', ')}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600">
              Mandate notes
            </label>
            <textarea
              name="mandate_notes"
              rows={5}
              defaultValue={lender.mandate_notes ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Describe what this lender likes to fund, dealbreakers, structure preferences, recent updates from calls/emails, etc."
            />
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Save changes
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
