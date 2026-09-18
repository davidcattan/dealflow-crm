'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { importDeals } from './actions'

export function ImportForm() {
  const [state, formAction, pending] = useActionState(importDeals, undefined)

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
          Creates a new deal for every row — this is meant for a one-time
          historical import, not repeated re-uploads of the same file (it
          will create duplicates if run twice on the same rows).
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
            {state.created} deal{state.created === 1 ? '' : 's'} created,{' '}
            {state.updatesAdded} update{state.updatesAdded === 1 ? '' : 's'}{' '}
            logged.
          </p>
          <Link href="/deals" className="mt-2 inline-block underline">
            View deals
          </Link>
        </div>
      )}
    </div>
  )
}
