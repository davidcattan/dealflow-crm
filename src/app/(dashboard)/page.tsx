import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  PIPELINE_STATUSES,
  PIPELINE_QUERY_STATUSES,
  STATUS_LABELS,
  STATUS_COLORS,
  activityScoreColor,
  displayStatus,
  type DealStatus,
} from '@/lib/types'
import { formatDateOnly } from '@/lib/format'

type Row = {
  id: string
  company_name: string
  status: DealStatus
  activity_score: number | null
  updated_at: string
  underwriting_generated_at: string | null
  deal_matches: { score: number; draft_status: string }[]
}

const DAY = 24 * 60 * 60 * 1000

// Read the clock outside the component body (server-rendered, per request).
const currentTime = () => Date.now()

function Item({ d, right }: { d: Row; right: (d: Row) => React.ReactNode }) {
  return (
    <li>
      <Link
        href={`/deals/${d.id}`}
        className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-slate-50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${activityScoreColor(d.activity_score)}`}
          />
          <span className="truncate font-medium text-slate-800">{d.company_name}</span>
        </span>
        <span className="shrink-0 text-xs text-slate-500">{right(d)}</span>
      </Link>
    </li>
  )
}

function DealList({
  title,
  hint,
  rows,
  empty,
  right,
}: {
  title: string
  hint: string
  rows: Row[]
  empty: string
  right: (d: Row) => React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">
          {title}
          <span className="ml-2 font-normal text-slate-400">{rows.length}</span>
        </h2>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      {rows.length > 0 ? (
        <ul className="divide-y divide-slate-100">
          {rows.slice(0, 8).map((d) => (
            <Item key={d.id} d={d} right={right} />
          ))}
          {rows.length > 8 && (
            <li>
              <details className="group">
                <summary className="cursor-pointer list-none px-5 py-2 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-800">
                  <span className="group-open:hidden">+ {rows.length - 8} more</span>
                  <span className="hidden group-open:inline">Show fewer</span>
                </summary>
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {rows.slice(8).map((d) => (
                    <Item key={d.id} d={d} right={right} />
                  ))}
                </ul>
              </details>
            </li>
          )}
        </ul>
      ) : (
        <p className="px-5 py-6 text-center text-sm text-slate-400">{empty}</p>
      )}
    </div>
  )
}

export default async function DashboardHome() {
  const supabase = await createClient()

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const [{ data: raw }, { data: usage }] = await Promise.all([
    supabase
      .from('deals')
      .select(
        'id, company_name, status, activity_score, updated_at, underwriting_generated_at, deal_matches(score, draft_status)'
      )
      .in('status', PIPELINE_QUERY_STATUSES),
    supabase.from('ai_usage').select('cost_usd').gte('created_at', monthStart.toISOString()),
  ])

  const deals = (raw ?? []) as Row[]
  const monthSpend = (usage ?? []).reduce((n, r) => n + Number(r.cost_usd), 0)
  const now = currentTime()
  const byActivity = (a: Row, b: Row) => (b.activity_score ?? 0) - (a.activity_score ?? 0)

  const readyToUnderwrite = deals
    .filter(
      (d) =>
        !d.underwriting_generated_at &&
        (d.activity_score ?? 0) >= 7 &&
        ['new', 'in_review'].includes(d.status)
    )
    .sort(byActivity)

  const emailsWaiting = deals
    .filter((d) => d.status !== 'submitted' && d.deal_matches.some((m) => m.draft_status === 'drafted'))
    .sort(byActivity)

  const goingCold = deals
    .filter((d) => (d.activity_score ?? 0) >= 7 && now - new Date(d.updated_at).getTime() > 7 * DAY)
    .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">What needs your attention right now.</p>
        </div>
        <Link href="/usage" className="text-xs text-slate-500 hover:text-slate-800">
          AI spend this month: ${monthSpend.toFixed(2)}
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {PIPELINE_STATUSES.map((status) => (
          <Link
            key={status}
            href={`/pipeline?stage=${status}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-slate-300 hover:bg-slate-50"
          >
            <span className={`h-2 w-2 rounded-full ${STATUS_COLORS[status]}`} />
            {STATUS_LABELS[status]}
            <span className="font-semibold text-slate-800">
              {deals.filter((d) => displayStatus(d.status) === status).length}
            </span>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <DealList
          title="Ready to underwrite"
          hint="Active deals (7+) with no underwriting yet"
          rows={readyToUnderwrite}
          empty="Nothing waiting — nice."
          right={(d) => `activity ${d.activity_score}`}
        />
        <DealList
          title="Emails ready to review"
          hint="Matched deals with a drafted lender email"
          rows={emailsWaiting}
          empty="No drafted emails waiting."
          right={(d) =>
            `${d.deal_matches.filter((m) => m.draft_status === 'drafted').length} draft${
              d.deal_matches.filter((m) => m.draft_status === 'drafted').length === 1 ? '' : 's'
            }`
          }
        />
        <DealList
          title="Going cold"
          hint="Active deals (7+) with no update in over a week"
          rows={goingCold}
          empty="Everything active has been touched recently."
          right={(d) => `updated ${formatDateOnly(d.updated_at)}`}
        />
      </div>
    </div>
  )
}
