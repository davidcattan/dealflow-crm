'use client'

import Link from 'next/link'
import { useState } from 'react'
import { STATUS_COLORS, STATUS_LABELS, displayStatus, matchScoreColor, type DealStatus } from '@/lib/types'
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
  const [view, setView] = useState<'table' | 'steps'>('table')

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
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
          {(['table', 'steps'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 ${view === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {v === 'table' ? 'Table' : 'Next steps'}
            </button>
          ))}
        </div>
      </div>

      {view === 'steps' ? (
        <NextStepsList rows={rows} emptyText={emptyText} />
      ) : (
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
          {rows.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  {emptyText}
                </td>
              </tr>
            </tbody>
          ) : (
              rows.map((r) => {
                const open = openIds.has(r.id)
                return (
                  <tbody key={r.id} className={`border-t border-slate-100 first:border-t-0 ${open ? 'bg-slate-50/70' : 'hover:bg-slate-50'}`}>
                    <tr>
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
                      <tr>
                        <td colSpan={7} className="px-4 pb-2.5 pt-0">
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
      )}
    </div>
  )
}

// "Next steps" view: a calm list grouped by who has the ball.
function NextStepsList({ rows, emptyText }: { rows: PipelineRow[]; emptyText: string }) {
  const groups = [
    { title: 'Your move', rows: rows.filter((r) => r.step && (r.step.urgency === 'you' || r.step.urgency === 'follow_up')) },
    { title: 'Waiting on lenders', rows: rows.filter((r) => r.step?.urgency === 'waiting') },
    { title: 'Done', rows: rows.filter((r) => r.step?.urgency === 'done') },
  ].filter((g) => g.rows.length > 0)

  if (groups.length === 0) {
    return <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">{emptyText}</p>
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.title}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {g.title} <span className="font-normal text-slate-400">({g.rows.length})</span>
          </h3>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {g.rows.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-4 px-4 py-3 hover:bg-slate-50">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/deals/${r.id}`} className="truncate font-medium text-slate-900 hover:underline">
                      {r.company_name}
                    </Link>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400">
                      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_COLORS[r.status as DealStatus]}`} />
                      {STATUS_LABELS[displayStatus(r.status as DealStatus)]}
                    </span>
                  </div>
                  <p className={`mt-0.5 text-sm ${g.title === 'Your move' ? 'text-slate-800' : 'text-slate-500'}`}>{r.step!.text}</p>
                  {r.step!.detail && <p className="mt-0.5 text-xs text-slate-500">{r.step!.detail}</p>}
                </div>
                <Link href={`/deals/${r.id}`} className="shrink-0 pt-0.5 text-xs text-slate-500 hover:text-slate-800 hover:underline">
                  Open deal →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
