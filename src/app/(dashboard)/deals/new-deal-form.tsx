'use client'

import { useActionState, useState } from 'react'
import { createDeal } from './actions'
import { INDUSTRY_CATEGORIES, LOAN_TYPE_CATEGORIES } from '@/lib/deals/categories'

export function NewDealForm() {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(createDeal, undefined)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        + New deal
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
          Company name *
        </label>
        <input
          name="company_name"
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
          Industry
        </label>
        <select
          name="industry"
          defaultValue=""
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
        >
          <option value="">—</option>
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
          defaultValue=""
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
        >
          <option value="">—</option>
          {LOAN_TYPE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
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
          Contact phone
        </label>
        <input
          name="contact_phone"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600">
          Website
        </label>
        <input
          name="website"
          placeholder="https://"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600">
          Diligence documents
        </label>
        <input
          type="file"
          name="files"
          multiple
          className="mt-1 w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
        />
        <p className="mt-1 text-xs text-slate-400">
          Optional — you can also add these later from the deal page.
        </p>
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
          {pending ? 'Creating…' : 'Create deal'}
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
