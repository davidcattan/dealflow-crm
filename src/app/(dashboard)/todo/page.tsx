import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { loadLastActivity, loadNextSteps } from '@/lib/deals/load-next-steps'
import { URGENCY_STYLES, type NextStep } from '@/lib/deals/next-step'

// "What do I need to do next?" — every active deal's next step in one list,
// most pressing first. Worked out from the deals themselves (no AI, free);
// an item goes away on its own once the deal moves on.

const INACTIVE = ['dead', 'closed', 'old']

type Item = { id: string; name: string; step: NextStep; lastActivity: string }

function ago(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return days <= 0 ? 'today' : days === 1 ? '1 day' : `${days} days`
}

function Row({ item, n }: { item: Item; n?: number }) {
  const style = URGENCY_STYLES[item.step.urgency]
  return (
    <li>
      <Link
        href={`/deals/${item.id}`}
        className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm hover:border-slate-300 active:bg-slate-50 sm:p-4"
      >
        {n ? (
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
            {n}
          </span>
        ) : (
          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold text-slate-900">{item.name}</span>
            <span className="shrink-0 text-[11px] text-slate-400">last activity {ago(item.lastActivity)}</span>
          </span>
          <span className="mt-0.5 block text-sm text-slate-700">{item.step.text}</span>
          {item.step.detail && <span className="mt-0.5 block text-xs text-slate-500">{item.step.detail}</span>}
        </span>
      </Link>
    </li>
  )
}

export default async function TodoPage() {
  const supabase = await createClient()
  const { data: deals } = await supabase.from('deals').select('id, company_name, status, updated_at')
  const active = (deals ?? []).filter((d) => !INACTIVE.includes(d.status as string))
  const ids = active.map((d) => d.id as string)
  const [steps, last] = await Promise.all([loadNextSteps(supabase, ids), loadLastActivity(supabase, ids)])

  const items: Item[] = active
    .map((d) => ({
      id: d.id as string,
      name: d.company_name as string,
      step: steps.get(d.id as string)!,
      lastActivity: last.get(d.id as string) ?? (d.updated_at as string),
    }))
    .filter((i) => i.step)
    // Most pressing kind first; within a kind, whatever's been sitting longest.
    .sort((a, b) => (a.step.rank ?? 9) - (b.step.rank ?? 9) || a.lastActivity.localeCompare(b.lastActivity))

  const doNow = items.filter((i) => i.step.urgency === 'you')
  const followUp = items.filter((i) => i.step.urgency === 'follow_up')
  const waiting = items.filter((i) => i.step.urgency === 'waiting' || i.step.urgency === 'done')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">To do</h1>
        <p className="mt-1 text-sm text-slate-500">
          {doNow.length + followUp.length
            ? `${doNow.length + followUp.length} thing${doNow.length + followUp.length === 1 ? '' : 's'} to do across your deals, most important first.`
            : 'Nothing needs you right now — every deal is waiting on someone else.'}
        </p>
      </div>

      {doNow.length > 0 && (
        <section className="space-y-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-red-700">Do now ({doNow.length})</h2>
          <ol className="space-y-2.5">
            {doNow.map((i, idx) => (
              <Row key={i.id} item={i} n={idx + 1} />
            ))}
          </ol>
        </section>
      )}

      {followUp.length > 0 && (
        <section className="space-y-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-700">Follow up ({followUp.length})</h2>
          <ul className="space-y-2.5">
            {followUp.map((i) => (
              <Row key={i.id} item={i} />
            ))}
          </ul>
        </section>
      )}

      {waiting.length > 0 && (
        <details className="group space-y-2.5">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span className="transition-transform group-open:rotate-90">›</span>
            Waiting on others ({waiting.length})
          </summary>
          <ul className="mt-2.5 space-y-2.5">
            {waiting.map((i) => (
              <Row key={i.id} item={i} />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
