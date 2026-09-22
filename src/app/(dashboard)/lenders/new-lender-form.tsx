'use client'

import { useActionState, useState } from 'react'
import { createLender } from './actions'
import { CategoryChecklist } from '@/components/category-checklist'
import {
  LENDING_TYPE_CATEGORIES,
  ASSET_TYPE_CATEGORIES,
  INDUSTRY_CATEGORIES,
  GEOGRAPHY_CATEGORIES,
} from '@/lib/lenders/categories'

export function NewLenderForm() {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(createLender, undefined)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        + New lender
      </button>
    )
  }

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600">
          Lender name *
        </label>
        <input
          name="name"
          required
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Contact name
        </label>
        <input
          name="contact_name"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Contact email
        </label>
        <input
          name="contact_email"
          type="email"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Lending type
        </label>
        <select
          name="lending_type"
          defaultValue=""
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
        >
          <option value="">—</option>
          {LENDING_TYPE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Cares about profit?
        </label>
        <select
          name="cares_about_profit"
          defaultValue=""
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Unknown</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Min loan amount
        </label>
        <input
          name="min_loan_amount"
          placeholder="e.g. $250K or 0 = no minimum"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Max loan amount
        </label>
        <input
          name="max_loan_amount"
          placeholder="e.g. $5M"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Min revenue
        </label>
        <input
          name="min_revenue"
          placeholder="e.g. $1M or 0 = no minimum"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Min EBITDA
        </label>
        <input
          name="min_ebitda"
          placeholder="e.g. $250K or 0 = no minimum"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600">
          Asset types
        </label>
        <CategoryChecklist
          name="asset_types"
          categories={ASSET_TYPE_CATEGORIES}
          defaultValue={[]}
        />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600">
          Industries
        </label>
        <CategoryChecklist
          name="industries"
          categories={INDUSTRY_CATEGORIES}
          defaultValue={[]}
        />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600">
          Geographies
        </label>
        <CategoryChecklist
          name="geographies"
          categories={GEOGRAPHY_CATEGORIES}
          defaultValue={[]}
          allLabel="Nationwide"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600">
          Mandate notes
        </label>
        <textarea
          name="mandate_notes"
          rows={3}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {state?.error && (
        <p className="text-sm text-red-600 sm:col-span-2">{state.error}</p>
      )}

      <div className="flex gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create lender'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
