'use client'

import Link from 'next/link'
import { useState } from 'react'
import { STATUS_COLORS, STATUS_LABELS, displayStatus, type DealStatus } from '@/lib/types'
import type { NextStep } from '@/lib/deals/next-step'
import { StatusSelect } from './status-select'

export type PipelineRow = {
  id: string
  company_name: string
  industry: string | null
  loan_type: string | null
  status: string
  lenders: string | null
  updatedLabel: string
  step: NextStep | null
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">
      <path d="M7.2 4.2a1 1 0 0 1 1.4 0l5.1 5.1a1 1 0 0 1 0 1.4l-5.1 5.1a1 1 0 1 1-1.4-1.4L11.6 10 7.2 5.6a1 1 0 0 1 0-1.4Z" />
    </svg>
  )
}

export function PipelineTable({ rows, emptyText }: { rows: PipelineRow[]; emptyText: string }) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())

  const toggle = (id: string) =>
    setOpenIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="space-y-2">
      <PhoneCards rows={rows} emptyText={emptyText} />

      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm sm:block">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="w-[30%] truncate px-4 py-2.5">Company</th>
              <th className="hidden w-[17%] truncate px-4 py-2.5 sm:table-cell">Loan Type</th>
              <th className="w-[16%] truncate px-4 py-2.5">Stage</th>
              <th className="w-[20%] truncate px-4 py-2.5">Lenders</th>
              <th className="hidden w-[12%] truncate px-4 py-2.5 sm:table-cell">Updated</th>
              <th className="w-[5%] px-2 py-2.5" aria-label="Next step" />
            </tr>
          </thead>
          {rows.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  {emptyText}
                </td>
              </tr>
            </tbody>
          ) : (
              rows.map((r) => {
                const open = openIds.has(r.id)
                return (
                  <tbody
                    key={r.id}
                    onClick={(e) => {
                      // Clicking empty space opens/closes the next step;
                      // links, the stage dropdown and buttons keep working.
                      if (!r.step || (e.target as HTMLElement).closest('a, button, select, input, label')) return
                      toggle(r.id)
                    }}
                    className={`border-t border-slate-100 first:border-t-0 ${r.step ? 'cursor-pointer' : ''} ${open ? 'bg-slate-50/70' : 'hover:bg-slate-50'}`}
                  >
                    <tr>
                      <td className="px-4 py-2">
                        <div className="flex min-w-0 items-center">
                          <span className={`mr-2 inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_COLORS[r.status as DealStatus]}`} />
                          <Link href={`/deals/${r.id}`} title={r.company_name} className="truncate font-medium text-slate-800 hover:underline">
                            {r.company_name}
                          </Link>
                        </div>
                      </td>
                      <td className="hidden px-4 py-2 text-slate-600 sm:table-cell">
                        <div className="truncate" title={r.loan_type ?? undefined}>
                          {r.loan_type ?? '—'}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <StatusSelect dealId={r.id} status={r.status as DealStatus} />
                      </td>
                      <td className="px-4 py-2">
                        {r.lenders ? (
                          <span className="block truncate text-slate-600" title={r.lenders}>
                            {r.lenders}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="hidden truncate px-4 py-2 text-slate-500 sm:table-cell">{r.updatedLabel}</td>
                      <td className="px-2 py-2 text-right">
                        {r.step && (
                          <button
                            type="button"
                            onClick={() => toggle(r.id)}
                            aria-expanded={open}
                            title={open ? 'Hide next step' : 'Show next step'}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          >
                            <Chevron open={open} />
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && r.step && (
                      <tr>
                        <td colSpan={6} className="px-4 pb-2.5 pt-0">
                          <div className="flex items-baseline gap-2 pl-4">
                            <span className="text-slate-300">→</span>
                            <div className="min-w-0">
                              <p className={r.step.urgency === 'you' || r.step.urgency === 'follow_up' ? 'font-medium text-slate-900' : 'text-slate-500'}>
                                {r.step.text}
                              </p>
                              {r.step.detail && <p className="text-xs text-slate-500">{r.step.detail}</p>}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                )
              })
          )}
        </table>
      </div>
    </div>
  )
}

// Phones: one tappable card per deal instead of a squeezed table.
function PhoneCards({ rows, emptyText }: { rows: PipelineRow[]; emptyText: string }) {
  if (rows.length === 0) {
    return <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400 sm:hidden">{emptyText}</p>
  }
  return (
    <ul className="space-y-2.5 sm:hidden">
      {rows.map((r) => {
        const yours = r.step && (r.step.urgency === 'you' || r.step.urgency === 'follow_up')
        return (
          <li key={r.id}>
            <Link href={`/deals/${r.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm active:bg-slate-50">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-base font-semibold leading-snug text-slate-900">{r.company_name}</p>
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_COLORS[r.status as DealStatus]}`} />
                  {STATUS_LABELS[displayStatus(r.status as DealStatus)]}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-slate-500">
                {[r.loan_type, r.updatedLabel].filter(Boolean).join(' · ')}
              </p>
              {r.lenders && <p className="mt-2 text-sm text-slate-700">Lenders: {r.lenders}</p>}
              {r.step && (
                <p className={`mt-2 border-t border-slate-100 pt-2 text-sm ${yours ? 'font-medium text-slate-900' : 'text-slate-500'}`}>
                  <span className="text-slate-400">Next → </span>
                  {r.step.text}
                </p>
              )}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
