'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { importLenders } from './actions'

export function ImportForm() {
  const [state, formAction, pending] = useActionState(importLenders, undefined)

  return (
    <div className="space-y-6">
      <form
        action={formAction}
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <input
          type="file"
          name="file"
          accept=".xlsx,.xls"
          required
          className="text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
        />
        <p className="text-xs text-slate-400">
          Matches lenders by company name — re-uploading an updated file
          updates existing lenders instead of creating duplicates.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? 'Importing…' : 'Import'}
        </button>
      </form>

      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {state.error}
        </p>
      )}

      {state && 'created' in state && (
        <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <p className="font-medium">Import complete.</p>
          <p className="mt-1">
            {state.created} lender{state.created === 1 ? '' : 's'} created,{' '}
            {state.updated} updated, {state.contactsAdded} contact
            {state.contactsAdded === 1 ? '' : 's'} added.
          </p>
          <Link href="/lenders" className="mt-2 inline-block underline">
            View lenders
          </Link>
        </div>
      )}
    </div>
  )
}
