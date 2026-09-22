'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateLender, deleteLender } from './actions'
import { ConfirmButton } from '@/components/confirm-button'
import { CategoryChecklist } from '@/components/category-checklist'
import { formatCompactCurrency } from '@/lib/format'
import {
  LENDING_TYPE_CATEGORIES,
  ASSET_TYPE_CATEGORIES,
  INDUSTRY_CATEGORIES,
  GEOGRAPHY_CATEGORIES,
} from '@/lib/lenders/categories'
import type { Lender, LenderContact } from '@/lib/types'

function moneyInputDefault(value: number | null): string {
  return value === null ? '' : formatCompactCurrency(value)
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{value || '—'}</p>
    </div>
  )
}

export function LenderDetail({
  lender,
  contacts,
}: {
  lender: Lender
  contacts: LenderContact[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)

  const caresLabel =
    lender.cares_about_profit === true
      ? 'Yes'
      : lender.cares_about_profit === false
        ? 'No'
        : null

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {lender.name}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Added {new Date(lender.created_at).toLocaleDateString()} ·{' '}
            <span className="capitalize">{lender.status}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setEditing((v) => !v)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            {editing ? 'Cancel edit' : 'Edit'}
          </button>
          <form action={deleteLender}>
            <input type="hidden" name="lender_id" value={lender.id} />
            <ConfirmButton
              confirmMessage={`Delete ${lender.name}? This cannot be undone.`}
              className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              Delete lender
            </ConfirmButton>
          </form>
        </div>
      </div>

      {!editing ? (
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">
              Overview
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Fact label="Lending type" value={lender.lending_type} />
              <Fact label="Cares about profit?" value={caresLabel} />
              <Fact
                label="Website"
                value={
                  lender.website ? (
                    <a
                      href={
                        lender.website.startsWith('http')
                          ? lender.website
                          : `https://${lender.website}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-800 underline"
                    >
                      {lender.website}
                    </a>
                  ) : null
                }
              />
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">
              Loan criteria
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Fact
                label="Min loan amount"
                value={formatCompactCurrency(lender.min_loan_amount, {
                  zeroLabel: 'No minimum',
                })}
              />
              <Fact
                label="Max loan amount"
                value={formatCompactCurrency(lender.max_loan_amount)}
              />
              <Fact
                label="Min revenue"
                value={formatCompactCurrency(lender.min_revenue, {
                  zeroLabel: 'No minimum',
                })}
              />
              <Fact
                label="Min EBITDA"
                value={formatCompactCurrency(lender.min_ebitda, {
                  zeroLabel: 'No minimum',
                })}
              />
              <Fact
                label="Asset types"
                value={lender.asset_types.join(', ')}
              />
              <Fact label="Industries" value={lender.industries.join(', ')} />
              <Fact
                label="Geographies"
                value={lender.geographies.join(', ')}
              />
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">
              Contact
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Fact label="Name" value={lender.contact_name} />
              <Fact label="Email" value={lender.contact_email} />
              <Fact label="Phone" value={lender.contact_phone} />
            </div>

            {contacts.length > 1 && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="mb-2 text-xs font-medium text-slate-500">
                  All contacts
                </p>
                <ul className="divide-y divide-slate-100">
                  {contacts.map((c) => (
                    <li key={c.id} className="py-2 text-sm">
                      <span className="font-medium text-slate-800">
                        {c.name ?? 'Unnamed contact'}
                      </span>
                      {c.email && (
                        <span className="ml-2 text-slate-500">{c.email}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">
              Notes
            </h2>
            <p className="whitespace-pre-wrap text-sm text-slate-700">
              {lender.mandate_notes || 'No notes yet.'}
            </p>
          </section>
        </div>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">
            Edit mandate
          </h2>
          <form
            action={async (formData) => {
              await updateLender(formData)
              setEditing(false)
              router.refresh()
            }}
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
                Lending type
              </label>
              <select
                name="lending_type"
                defaultValue={lender.lending_type ?? ''}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
              >
                <option value="">—</option>
                {lender.lending_type &&
                  !(LENDING_TYPE_CATEGORIES as readonly string[]).includes(
                    lender.lending_type
                  ) && (
                    <option value={lender.lending_type}>
                      {lender.lending_type} (non-standard)
                    </option>
                  )}
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
                defaultValue={
                  lender.cares_about_profit === true
                    ? 'yes'
                    : lender.cares_about_profit === false
                      ? 'no'
                      : ''
                }
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
                defaultValue={moneyInputDefault(lender.min_loan_amount)}
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
                defaultValue={moneyInputDefault(lender.max_loan_amount)}
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
                defaultValue={moneyInputDefault(lender.min_revenue)}
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
                defaultValue={moneyInputDefault(lender.min_ebitda)}
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
                defaultValue={lender.asset_types}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600">
                Industries
              </label>
              <CategoryChecklist
                name="industries"
                categories={INDUSTRY_CATEGORIES}
                defaultValue={lender.industries}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600">
                Geographies
              </label>
              <CategoryChecklist
                name="geographies"
                categories={GEOGRAPHY_CATEGORIES}
                defaultValue={lender.geographies}
                allLabel="Nationwide"
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
            <div className="flex gap-2 sm:col-span-2">
              <button
                type="submit"
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Save changes
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  )
}
