import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  PIPELINE_STATUSES,
  PIPELINE_QUERY_STATUSES,
  displayStatus,
  STATUS_LABELS,
  STATUS_COLORS,
  type DealStatus,
} from '@/lib/types'
import { PipelineFilterBar } from './filter-bar'
import { SearchBar } from '@/components/search-bar'
import { matchesSearch } from '@/lib/search'
import { INDUSTRY_CATEGORIES, LOAN_TYPE_CATEGORIES } from '@/lib/deals/categories'
import { loadNextSteps } from '@/lib/deals/load-next-steps'
import { PipelineTable } from './pipeline-table'

function stageHref(
  status: string | null,
  industry: string | undefined,
  loanType: string | undefined,
  search: string | undefined
) {
  const params = new URLSearchParams()
  if (status) params.set('stage', status)
  if (industry) params.set('industry', industry)
  if (loanType) params.set('loanType', loanType)
  if (search) params.set('q', search)
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

type PipelineDeal = {
  id: string
  company_name: string
  industry: string | null
  loan_type: string | null
  status: string
  updated_at: string
  created_at: string
  contact_name: string | null
  rep_name: string | null
  notes: string | null
  activity_score: number | null
  deal_matches: { score: number }[]
  deal_submissions?: { status: string }[]
}

// "3 sent · 1 interested" — how far the deal has got with lenders.
function lenderSummary(deal: PipelineDeal): string | null {
  const subs = deal.deal_submissions ?? []
  if (subs.length === 0) return null
  const n = (s: string) => subs.filter((x) => x.status === s).length
  const best =
    (n('funded') && `${n('funded')} funded`) ||
    (n('term_sheet') && `${n('term_sheet')} term sheet${n('term_sheet') > 1 ? 's' : ''}`) ||
    (n('interested') && `${n('interested')} interested`) ||
    (n('needs_more_info') && `${n('needs_more_info')} need${n('needs_more_info') > 1 ? '' : 's'} info`) ||
    (n('sent') && 'waiting') ||
    'all passed'
  return `${subs.length} sent · ${best}`
}

function topMatchScore(deal: PipelineDeal): number | null {
  if (!deal.deal_matches || deal.deal_matches.length === 0) return null
  return Math.max(...deal.deal_matches.map((m) => m.score))
}

function applySort(deals: PipelineDeal[], sort: string | undefined): PipelineDeal[] {
  if (!sort) return deals
  const sorted = [...deals]
  switch (sort) {
    case 'name_asc':
      sorted.sort((a, b) => a.company_name.localeCompare(b.company_name))
      break
    case 'name_desc':
      sorted.sort((a, b) => b.company_name.localeCompare(a.company_name))
      break
    case 'updated_asc':
      sorted.sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
      break
    case 'activity_desc':
      sorted.sort((a, b) => (b.activity_score ?? -1) - (a.activity_score ?? -1))
      break
    case 'activity_asc':
      sorted.sort((a, b) => (a.activity_score ?? 11) - (b.activity_score ?? 11))
      break
    case 'match_desc':
      sorted.sort((a, b) => (topMatchScore(b) ?? -1) - (topMatchScore(a) ?? -1))
      break
    case 'updated_desc':
      sorted.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      break
    default:
      break
  }
  return sorted
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{
    stage?: string
    industry?: string
    loanType?: string
    sort?: string
    q?: string
  }>
}) {
  const {
    stage: stageParam,
    industry: industryParam,
    loanType: loanTypeParam,
    sort: sortParam,
    q,
  } = await searchParams
  const activeStage = PIPELINE_STATUSES.includes(stageParam as DealStatus)
    ? (stageParam as DealStatus)
    : null

  const supabase = await createClient()

  const [{ data: rawDeals }, { count: resolvedCount }] = await Promise.all([
    supabase
      .from('deals')
      .select(
        'id, company_name, industry, loan_type, status, updated_at, created_at, contact_name, rep_name, notes, activity_score, deal_matches(score), deal_submissions(status)'
      )
      .in('status', PIPELINE_QUERY_STATUSES)
      .order('updated_at', { ascending: false }),
    supabase
      .from('deals')
      .select('*', { count: 'exact', head: true })
      .in('status', ['closed', 'dead', 'old']),
  ])

  const deals = (rawDeals ?? []) as PipelineDeal[]
  const nextSteps = await loadNextSteps(
    supabase,
    deals.map((d) => d.id)
  )

  const defaultOrdered = deals.slice().sort((a, b) => {
    const stageDiff =
      PIPELINE_STATUSES.indexOf(displayStatus(a.status as DealStatus)) -
      PIPELINE_STATUSES.indexOf(displayStatus(b.status as DealStatus))
    if (stageDiff !== 0) return stageDiff
    return (
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )
  })

  const counts = PIPELINE_STATUSES.map((status) => ({
    status,
    count: deals.filter((d) => displayStatus(d.status as DealStatus) === status).length,
  }))

  // The full fixed taxonomies, not just values currently in use — so a
  // category like "Other" is always filterable even before any deal has
  // been classified into it. Sorted alphabetically for easy scanning.
  const industries = [...INDUSTRY_CATEGORIES].sort((a, b) => a.localeCompare(b))
  const loanTypes = [...LOAN_TYPE_CATEGORIES].sort((a, b) => a.localeCompare(b))

  const suggestions = deals.map((d) => ({
    id: d.id,
    label: d.company_name,
    sublabel: d.contact_name,
    searchText: d.rep_name,
    href: `/deals/${d.id}`,
  }))

  const filtered = defaultOrdered
    .filter((d) => !activeStage || displayStatus(d.status as DealStatus) === activeStage)
    .filter((d) => !industryParam || d.industry === industryParam)
    .filter((d) => !loanTypeParam || d.loan_type === loanTypeParam)
    .filter(
      (d) =>
        !q ||
        matchesSearch(q, [
          d.company_name,
          d.contact_name,
          d.rep_name,
          d.notes,
          new Date(d.created_at).toLocaleDateString(),
          new Date(d.updated_at).toLocaleDateString(),
          d.created_at,
          d.updated_at,
        ])
    )

  const visibleDeals = applySort(filtered, sortParam)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Pipeline</h1>
          <p className="mt-1 text-sm text-slate-500">
            {activeStage || industryParam || loanTypeParam || q ? (
              <>
                {visibleDeals.length} deal{visibleDeals.length === 1 ? '' : 's'}
                {activeStage ? ` · ${STATUS_LABELS[activeStage].toLowerCase()}` : ''}
                {industryParam ? ` · ${industryParam}` : ''}
                {loanTypeParam ? ` · ${loanTypeParam}` : ''}
                {q ? ` · "${q}"` : ''} ·{' '}
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
            {resolvedCount} closed / dead / old — view all deals
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {counts.map(({ status, count }) => {
          const isActive = activeStage === status
          return (
            <Link
              key={status}
              href={stageHref(isActive ? null : status, industryParam, loanTypeParam, q)}
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchBar
          placeholder="Search company, contact, rep, notes, date…"
          suggestions={suggestions}
        />
        <PipelineFilterBar industries={industries} loanTypes={loanTypes} />
      </div>

      <PipelineTable
        rows={visibleDeals.map((deal) => ({
          id: deal.id,
          company_name: deal.company_name,
          industry: deal.industry,
          loan_type: deal.loan_type,
          status: deal.status,
          lenders: lenderSummary(deal),
          updatedLabel: daysAgo(deal.updated_at),
          step: nextSteps.get(deal.id) ?? null,
        }))}
        emptyText={
          activeStage || industryParam || loanTypeParam || q ? 'No deals match this filter.' : 'No active deals right now.'
        }
      />
    </div>
  )
}
