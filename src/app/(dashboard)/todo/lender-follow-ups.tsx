import Link from 'next/link'

export type LenderFollowUpItem = {
  dealId: string
  dealName: string
  lenderName: string
  lastTouchAt: string
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' })

function names(list: string[], max = 2) {
  if (list.length <= max) return list.join(' and ')
  return `${list.slice(0, max).join(', ')} +${list.length - max} more`
}

// "Lenders to follow up": one line per deal (lenders that haven't answered
// in 3 days). The buttons live on each deal's Lenders tab.
export function LenderFollowUps({ items }: { items: LenderFollowUpItem[] }) {
  if (!items.length) return null
  const byDeal = new Map<string, LenderFollowUpItem[]>()
  for (const i of items) byDeal.set(i.dealId, [...(byDeal.get(i.dealId) ?? []), i])
  // Items arrive oldest first, so the deal waiting longest leads.
  const deals = [...byDeal.values()]
  return (
    <section>
      <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Lenders to follow up <span className="font-normal text-slate-400">· {deals.length}</span>
      </h2>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
        {deals.map((list) => (
          <li key={list[0].dealId}>
            <Link href={`/deals/${list[0].dealId}?tab=lenders`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-900">
                  <span className="font-medium">{list[0].dealName}</span>
                  <span className="text-slate-500">: follow up with {names(list.map((i) => i.lenderName))}</span>
                </span>
                <span className="block text-xs text-slate-400">Quiet since {day(list[0].lastTouchAt)}</span>
              </span>
              <span className="shrink-0 text-slate-300">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
