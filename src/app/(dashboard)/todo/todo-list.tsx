'use client'

import Link from 'next/link'
import { useState } from 'react'

export type TodoItem = { id: string; name: string; text: string; detail: string | null; days: number }
export type TodoSection = { rank: number; title: string; items: TodoItem[] }

// Look of each section: a small colored icon and chip.
const LOOK: Record<number, { icon: string; tint: string; chip: string }> = {
  1: { icon: '↩', tint: 'bg-rose-100 text-rose-700', chip: 'Lenders' },
  2: { icon: '☎', tint: 'bg-violet-100 text-violet-700', chip: 'Calls' },
  3: { icon: '📄', tint: 'bg-amber-100 text-amber-700', chip: 'Docs' },
  4: { icon: '➤', tint: 'bg-sky-100 text-sky-700', chip: 'Send out' },
  5: { icon: '✕', tint: 'bg-slate-200 text-slate-600', chip: 'Passed' },
  6: { icon: '⏱', tint: 'bg-orange-100 text-orange-700', chip: 'Follow up' },
  9: { icon: '…', tint: 'bg-slate-100 text-slate-500', chip: 'Waiting' },
}

function Row({ item, rank }: { item: TodoItem; rank: number }) {
  const look = LOOK[rank] ?? LOOK[9]
  return (
    <li>
      <Link href={`/deals/${item.id}`} className="flex items-center gap-3 px-3.5 py-3 hover:bg-slate-50 active:bg-slate-100 sm:px-4">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${look.tint}`} aria-hidden="true">
          {look.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-[15px] font-semibold text-slate-900">{item.name}</span>
            {item.days >= 2 && (
              <span className={`shrink-0 text-[11px] ${item.days >= 5 ? 'text-amber-700' : 'text-slate-400'}`}>{item.days}d</span>
            )}
          </span>
          <span className="line-clamp-2 text-sm text-slate-600">{item.text}</span>
          {item.detail && <span className="mt-0.5 line-clamp-1 text-xs text-slate-400">{item.detail}</span>}
        </span>
        <span className="shrink-0 text-lg leading-none text-slate-300">›</span>
      </Link>
    </li>
  )
}

export function TodoList({ sections, waiting }: { sections: TodoSection[]; waiting: TodoItem[] }) {
  // null = everything; otherwise one section's rank.
  const [only, setOnly] = useState<number | null>(null)
  const total = sections.reduce((n, s) => n + s.items.length, 0)
  const shown = only === null ? sections : sections.filter((s) => s.rank === only)

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">To do</h1>
        <p className="text-sm text-slate-500">
          {total ? `${total} to do` : 'All clear'}
          {waiting.length > 0 && ` · ${waiting.length} waiting`}
        </p>
      </div>

      {/* Section chips — pinned while you scroll. */}
      {sections.length > 1 && (
        <div className="sticky top-0 z-30 -mx-4 bg-slate-50/95 px-4 py-2 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setOnly(null)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${only === null ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
            >
              All <span className={only === null ? 'text-white/70' : 'text-slate-400'}>{total}</span>
            </button>
            {sections.map((s) => (
              <button
                key={s.rank}
                type="button"
                onClick={() => setOnly(only === s.rank ? null : s.rank)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${only === s.rank ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
              >
                {(LOOK[s.rank] ?? LOOK[9]).chip} <span className={only === s.rank ? 'text-white/70' : 'text-slate-400'}>{s.items.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {total === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Nothing needs you right now — every deal is waiting on someone else.
        </p>
      )}

      {shown.map((s) => (
        <section key={s.rank}>
          <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {s.title} <span className="font-normal text-slate-400">· {s.items.length}</span>
          </h2>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {s.items.map((i) => (
              <Row key={i.id} item={i} rank={s.rank} />
            ))}
          </ul>
        </section>
      ))}

      {only === null && waiting.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <span className="transition-transform group-open:rotate-90">›</span>
            Waiting on others · {waiting.length}
          </summary>
          <ul className="mt-1.5 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {waiting.map((i) => (
              <Row key={i.id} item={i} rank={9} />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
