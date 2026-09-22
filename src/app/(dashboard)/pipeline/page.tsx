import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  PIPELINE_STATUSES,
  STATUS_LABELS,
  STATUS_COLORS,
  matchScoreColor,
  type DealStatus,
} from '@/lib/types'
import { StatusSelect } from './status-select'
import { PipelineFilterBar } from './filter-bar'

function stageHref(
  status: string | null,
  industry: string | undefined,
  loanType: string | undefined
) {
  const params = new URLSearchParams()
  if (status) params.set('stage', status)
  if (industry) params.set('industry', industry)
  if (loanType) params.set('loanType', loanType)
  const qs = params.toString()
  return qs ? `/pipeline?${qs}` : '/pipeline'
}

function daysAgo(dateStr: string) {
  const days = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  )
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; industry?: string; loanType?: string }>
}) {
  const { stage: stageParam, industry: industryParam, loanType: loanTypeParam } =
    await searchParams
  const activeStage = PIPELINE_STATUSES.includes(stageParam as DealStatus)
    ? (stageParam as DealStatus)
    : null

  const supabase = await createClient()

  const [{ data: rawDeals }, { count: resolvedCount }] = await Promise.all([
    supabase
      .from('deals')
      .select(
        'id, company_name, industry, loan_type, status, updated_at, deal_matches(score)'
      )
      .in('status', PIPELINE_STATUSES)
      .order('updated_at', { ascending: false }),
    supabase
      .from('deals')
      .select('*', { count: 'exact', head: true })
      .in('status', ['closed', 'dead']),
  ])

  const deals = (rawDeals ?? []).slice().sort((a, b) => {
    const stageDiff =
      PIPELINE_STATUSES.indexOf(a.status as DealStatus) -
      PIPELINE_STATUSES.indexOf(b.status as DealStatus)
    if (stageDiff !== 0) return stageDiff
    return (
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )
  })

  const counts = PIPELINE_STATUSES.map((status) => ({
    status,
    count: deals.filter((d) => d.status === status).length,
  }))

  const industries = Array.from(
    new Set(deals.map((d) => d.industry).filter((v): v is string => Boolean(v)))
  ).sort((a, b) => a.localeCompare(b))
  const loanTypes = Array.from(
    new Set(deals.map((d) => d.loan_type).filter((v): v is string => Boolean(v)))
  ).sort((a, b) => a.localeCompare(b))

  const visibleDeals = deals
    .filter((d) => !activeStage || d.status === activeStage)
    .filter((d) => !industryParam || d.industry === industryParam)
    .filter((d) => !loanTypeParam || d.loan_type === loanTypeParam)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Pipeline</h1>
          <p className="mt-1 text-sm text-slate-500">
            {activeStage || industryParam || loanTypeParam ? (
              <>
                {visibleDeals.length} deal{visibleDeals.length === 1 ? '' : 's'}
                {activeStage ? ` · ${STATUS_LABELS[activeStage].toLowerCase()}` : ''}
                {industryParam ? ` · ${industryParam}` : ''}
                {loanTypeParam ? ` · ${loanTypeParam}` : ''} ·{' '}
                <Link href="/pipeline" className="underline hover:text-slate-700">
                  show all {deals.length}
                </Link>
              </>
            ) : (
              <>
                {deals.length} active deal{deals.length === 1 ? '' : 's'}
              </>
            )}
          </p>
        </div>
        {resolvedCount ? (
          <Link
            href="/deals"
            className="text-sm text-slate-500 hover:underline"
          >
            {resolvedCount} closed / dead — view all deals
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {counts.map(({ status, count }) => {
          const isActive = activeStage === status
          return (
            <Link
              key={status}
              href={stageHref(isActive ? null : status, industryParam, loanTypeParam)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                isActive
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${STATUS_COLORS[status]}`}
              />
              {STATUS_LABELS[status]}
              <span className={isActive ? 'font-semibold text-white' : 'font-semibold text-slate-800'}>
                {count}
              </span>
            </Link>
          )
        })}
      </div>

      <div className="flex justify-end">
        <PipelineFilterBar industries={industries} loanTypes={loanTypes} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-2.5">Company</th>
              <th className="whitespace-nowrap px-4 py-2.5">Industry</th>
              <th className="whitespace-nowrap px-4 py-2.5">Loan Type</th>
              <th className="whitespace-nowrap px-4 py-2.5">Stage</th>
              <th className="whitespace-nowrap px-4 py-2.5">Matches</th>
              <th className="whitespace-nowrap px-4 py-2.5">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleDeals.length > 0 ? (
              visibleDeals.map((deal) => (
                <tr key={deal.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-2">
                    <span
                      className={`mr-2 inline-block h-2 w-2 rounded-full ${STATUS_COLORS[deal.status as DealStatus]}`}
                    />
                    <Link
                      href={`/deals/${deal.id}`}
                      className="font-medium text-slate-800 hover:underline"
                    >
                      {deal.company_name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                    {deal.industry ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                    {deal.loan_type ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <StatusSelect
                      dealId={deal.id}
                      status={deal.status as DealStatus}
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    {(() => {
                      const scores = (deal.deal_matches ?? []).map((m) => m.score)
                      if (scores.length === 0) {
                        return <span className="text-slate-400">—</span>
                      }
                      const topScore = Math.max(...scores)
                      return (
                        <Link
                          href={`/deals/${deal.id}#lender-matches`}
                          className="inline-flex items-center gap-1.5 hover:underline"
                        >
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${matchScoreColor(topScore)}`}
                          />
                          <span className="text-slate-600">
                            {scores.length} match{scores.length === 1 ? '' : 'es'}
                          </span>
                        </Link>
                      )
                    })()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                    {daysAgo(deal.updated_at)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  {activeStage || industryParam || loanTypeParam
                    ? 'No deals match this filter.'
                    : 'No active deals right now.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
