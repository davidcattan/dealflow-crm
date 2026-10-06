'use client'

import Link from 'next/link'
import { Fragment, useState } from 'react'
import { STATUS_COLORS, matchScoreColor, type DealStatus } from '@/lib/types'
import type { NextStep } from '@/lib/deals/next-step'
import { StatusSelect } from './status-select'

export type PipelineRow = {
  id: string
  company_name: string
  industry: string | null
  loan_type: string | null
  status: string
  matchCount: number
  topScore: number | null
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
  const allOpen = rows.length > 0 && rows.every((r) => openIds.has(r.id))

  const toggle = (id: string) =>
    setOpenIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={allOpen}
            onChange={(e) => setOpenIds(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
            className="rounded border-slate-300"
          />
          Show next steps
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="w-[25%] truncate px-4 py-2.5">Company</th>
              <th className="w-[16%] truncate px-4 py-2.5">Industry</th>
              <th className="w-[16%] truncate px-4 py-2.5">Loan Type</th>
              <th className="w-[15%] truncate px-4 py-2.5">Stage</th>
              <th className="w-[12%] truncate px-4 py-2.5">Matches</th>
              <th className="w-[11%] truncate px-4 py-2.5">Updated</th>
              <th className="w-[5%] px-2 py-2.5" aria-label="Next step" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const open = openIds.has(r.id)
                return (
                  <Fragment key={r.id}>
                    <tr className={`hover:bg-slate-50 ${open ? 'bg-slate-50' : ''}`}>
                      <td className="px-4 py-2">
                        <div className="flex min-w-0 items-center">
                          <span className={`mr-2 inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_COLORS[r.status as DealStatus]}`} />
                          <Link href={`/deals/${r.id}`} title={r.company_name} className="truncate font-medium text-slate-800 hover:underline">
                            {r.company_name}
                          </Link>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        <div className="truncate" title={r.industry ?? undefined}>
                          {r.industry ?? '—'}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        <div className="truncate" title={r.loan_type ?? undefined}>
                          {r.loan_type ?? '—'}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <StatusSelect dealId={r.id} status={r.status as DealStatus} />
                      </td>
                      <td className="px-4 py-2">
                        {r.topScore === null ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <Link href={`/deals/${r.id}#lender-matches`} className="flex min-w-0 items-center gap-1.5 hover:underline">
                            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${matchScoreColor(r.topScore)}`} />
                            <span className="truncate text-slate-600">
                              {r.matchCount} match{r.matchCount === 1 ? '' : 'es'}
                            </span>
                          </Link>
                        )}
                      </td>
                      <td className="truncate px-4 py-2 text-slate-500">{r.updatedLabel}</td>
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
                      <tr className="bg-slate-50">
                        <td colSpan={7} className="px-4 pb-3 pt-0">
                          <div className="ml-4 flex flex-wrap items-baseline justify-between gap-2 border-l-2 border-slate-300 pl-3">
                            <div className="min-w-0">
                              <p className={r.step.urgency === 'you' || r.step.urgency === 'follow_up' ? 'text-slate-900' : 'text-slate-500'}>
                                <span className="text-xs uppercase tracking-wide text-slate-400">Next step · </span>
                                <span className={r.step.urgency === 'you' || r.step.urgency === 'follow_up' ? 'font-medium' : ''}>
                                  {r.step.text}
                                </span>
                              </p>
                              {r.step.detail && <p className="mt-0.5 text-xs text-slate-500">{r.step.detail}</p>}
                            </div>
                            <Link href={`/deals/${r.id}`} className="shrink-0 text-xs text-slate-500 hover:text-slate-800 hover:underline">
                              Open deal →
                            </Link>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
