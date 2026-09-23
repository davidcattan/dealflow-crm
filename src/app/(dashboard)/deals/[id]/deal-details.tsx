'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateDeal } from './actions'
import { STATUS_OPTIONS, STATUS_LABELS, displayStatus, activityScoreColor, type Deal } from '@/lib/types'
import { INDUSTRY_CATEGORIES, LOAN_TYPE_CATEGORIES } from '@/lib/deals/categories'

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{value || '—'}</p>
    </div>
  )
}

export function DealDetails({ deal }: { deal: Deal }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Deal details</h2>
        <button
          onClick={() => setEditing((v) => !v)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          {editing ? 'Cancel edit' : 'Edit'}
        </button>
      </div>

      {!editing ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Fact label="Status" value={STATUS_LABELS[deal.status]} />
          <Fact label="Industry" value={deal.industry} />
          <Fact label="Loan type" value={deal.loan_type} />
          <Fact
            label="Website"
            value={
              deal.website ? (
                <a
                  href={deal.website.startsWith('http') ? deal.website : `https://${deal.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-800 underline"
                >
                  {deal.website}
                </a>
              ) : null
            }
          />
          <Fact label="Contact name" value={deal.contact_name} />
          <Fact label="Contact email" value={deal.contact_email} />
          <Fact label="Contact phone" value={deal.contact_phone} />
          <Fact label="Deal type / ask" value={deal.deal_type} />
          <Fact label="Rep" value={deal.rep_name} />
          <Fact
            label="Activity score"
            value={
              deal.activity_score !== null ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${activityScoreColor(deal.activity_score)}`}
                  />
                  {deal.activity_score}/10
                </span>
              ) : null
            }
          />
          <div className="sm:col-span-3">
            <p className="text-xs font-medium text-slate-500">Description</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
              {deal.description || '—'}
            </p>
          </div>
          <div className="sm:col-span-3">
            <p className="text-xs font-medium text-slate-500">Notes</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
              {deal.notes || '—'}
            </p>
          </div>
        </div>
      ) : (
        <form
          action={async (formData) => {
            await updateDeal(formData)
            setEditing(false)
            router.refresh()
          }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <input type="hidden" name="deal_id" value={deal.id} />

          <div>
            <label className="block text-xs font-medium text-slate-600">
              Company name
            </label>
            <input
              name="company_name"
              defaultValue={deal.company_name}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Status
            </label>
            <select
              name="status"
              defaultValue={displayStatus(deal.status)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Industry
            </label>
            <select
              name="industry"
              defaultValue={deal.industry ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
            >
              <option value="">—</option>
              {deal.industry &&
                !(INDUSTRY_CATEGORIES as readonly string[]).includes(deal.industry) && (
                  <option value={deal.industry}>{deal.industry} (non-standard)</option>
                )}
              {INDUSTRY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Loan type
            </label>
            <select
              name="loan_type"
              defaultValue={deal.loan_type ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
            >
              <option value="">—</option>
              {deal.loan_type &&
                !(LOAN_TYPE_CATEGORIES as readonly string[]).includes(deal.loan_type) && (
                  <option value={deal.loan_type}>{deal.loan_type} (non-standard)</option>
                )}
              {LOAN_TYPE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Website
            </label>
            <input
              name="website"
              defaultValue={deal.website ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Contact name
            </label>
            <input
              name="contact_name"
              defaultValue={deal.contact_name ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Contact email
            </label>
            <input
              name="contact_email"
              defaultValue={deal.contact_email ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Contact phone
            </label>
            <input
              name="contact_phone"
              defaultValue={deal.contact_phone ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Deal type / ask
            </label>
            <input
              name="deal_type"
              defaultValue={deal.deal_type ?? ''}
              placeholder="e.g. Ask $250k Bridge"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Rep
            </label>
            <input
              name="rep_name"
              defaultValue={deal.rep_name ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Activity score (0–10)
            </label>
            <input
              name="activity_score"
              type="number"
              min={0}
              max={10}
              defaultValue={deal.activity_score ?? ''}
              placeholder="10 = working it today"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600">
              Description
            </label>
            <textarea
              name="description"
              rows={6}
              defaultValue={deal.description ?? ''}
              placeholder="The rundown of the deal — what the business does, the ask, collateral, anything the broker told you."
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600">
              Notes
            </label>
            <textarea
              name="notes"
              rows={4}
              defaultValue={deal.notes ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
      )}
    </section>
  )
}
