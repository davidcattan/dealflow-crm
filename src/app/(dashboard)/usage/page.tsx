import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

type Row = {
  deal_id: string | null
  feature: string
  cost_usd: number
  created_at: string
  deals: { company_name: string } | { company_name: string }[] | null
}

const usd = (n: number) => `$${n.toFixed(2)}`

// "2026-10-09" in New York time, `daysBack` days ago.
function nyDay(daysBack: number) {
  return new Date(Date.now() - daysBack * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

function Table({
  title,
  items,
}: {
  title: string
  items: [string, { cost: number; calls: number }][]
}) {
  return (
  <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
    <table className="w-full text-sm">
      <tbody className="divide-y divide-slate-100">
        {items.map(([k, v]) => (
          <tr key={k}>
            <td className="py-1.5 text-slate-700">{k}</td>
            <td className="py-1.5 text-right text-slate-400">{v.calls} call{v.calls === 1 ? '' : 's'}</td>
            <td className="w-20 py-1.5 text-right font-medium text-slate-800">{usd(v.cost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </section>
)
}

export default async function UsagePage() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ai_usage')
    .select('deal_id, feature, cost_usd, created_at, deals(company_name)')
    .order('created_at', { ascending: false })
    .limit(5000)

  const rows = (data ?? []) as unknown as Row[]
  const total = rows.reduce((s, r) => s + Number(r.cost_usd), 0)

  // Grouped totals, biggest first — or in date order (newest first) when
  // `sortKey` is given.
  const group = (key: (r: Row) => string, sortKey?: (r: Row) => string) => {
    const m = new Map<string, { cost: number; calls: number; sort: string }>()
    for (const r of rows) {
      const k = key(r)
      const cur = m.get(k) ?? { cost: 0, calls: 0, sort: sortKey ? sortKey(r) : '' }
      cur.cost += Number(r.cost_usd)
      cur.calls += 1
      m.set(k, cur)
    }
    return [...m.entries()].sort((a, b) => (sortKey ? b[1].sort.localeCompare(a[1].sort) : b[1].cost - a[1].cost))
  }

  // Dates in New York time (the server runs on UTC).
  const tz = 'America/New_York'
  const isoDay = (r: Row) => new Date(r.created_at).toLocaleDateString('en-CA', { timeZone: tz })
  const byMonth = group(
    (r) => new Date(r.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: tz }),
    (r) => isoDay(r).slice(0, 7)
  )
  const byDay = group(
    (r) => new Date(r.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }),
    isoDay
  ).filter(([, v]) => v.sort >= nyDay(13))
  const thisMonth = byMonth.find(([, v]) => v.sort === nyDay(0).slice(0, 7))
  const byFeature = group((r) => r.feature)
  const byDeal = group((r) => {
    const d = Array.isArray(r.deals) ? r.deals[0] : r.deals
    return d?.company_name ?? '(not tied to a deal)'
  }).slice(0, 15)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">AI usage</h1>
        <p className="mt-1 text-sm text-slate-500">
          Estimated cost of every AI call the app has made since tracking was
          added. Estimates use published per-token prices — your Anthropic
          Console is the source of truth for the actual bill.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-red-600">
          Usage table isn&apos;t set up yet — run migration 010 in Supabase.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">
          Nothing tracked yet. Costs appear here as AI features run.{' '}
          <Link href="/deals" className="underline">Back to deals</Link>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-10 gap-y-3">
            <p className="text-3xl font-semibold text-slate-900">
              {usd(thisMonth?.[1].cost ?? 0)}
              <span className="ml-2 text-sm font-normal text-slate-400">this month</span>
            </p>
            <p className="text-3xl font-semibold text-slate-400">
              {usd(total)}
              <span className="ml-2 text-sm font-normal text-slate-400">all time</span>
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <Table title="By month" items={byMonth} />
            <Table title="Last 14 days" items={byDay} />
            <Table title="By feature" items={byFeature} />
            <Table title="Most expensive deals" items={byDeal} />
          </div>
        </>
      )}
    </div>
  )
}
