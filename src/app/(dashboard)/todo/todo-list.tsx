'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useTransition } from 'react'
import { OwnerSelect } from '@/components/owner-select'
import { TEAM, type TeamMember } from '@/lib/team'
import { addTodo, deleteTodo, dismissStep, markDealDead, restoreDealStatus, setTodoDone } from './actions'
import type { DealStatus } from '@/lib/types'

export type TodoItem = { id: string; name: string; owner: TeamMember | null; text: string; detail: string | null; days: number }
export type TodoSection = { rank: number; title: string; items: TodoItem[] }
// A to-do someone wrote themselves.
export type MyTodo = { id: string; text: string; assignee: string; dueDate: string | null; deal: { id: string; name: string } | null }

// Look of each section: a small colored icon and chip.
const LOOK: Record<number, { icon: string; tint: string; chip: string }> = {
  0: { icon: '✓', tint: 'bg-emerald-100 text-emerald-700', chip: 'Your list' },
  1: { icon: '↩', tint: 'bg-rose-100 text-rose-700', chip: 'Lenders' },
  2: { icon: '☎', tint: 'bg-violet-100 text-violet-700', chip: 'Calls' },
  3: { icon: '📄', tint: 'bg-amber-100 text-amber-700', chip: 'Docs' },
  4: { icon: '➤', tint: 'bg-sky-100 text-sky-700', chip: 'Send out' },
  5: { icon: '✕', tint: 'bg-slate-200 text-slate-600', chip: 'Passed' },
  6: { icon: '⏱', tint: 'bg-orange-100 text-orange-700', chip: 'Follow up' },
  9: { icon: '…', tint: 'bg-slate-100 text-slate-500', chip: 'Waiting' },
}

const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

function dueLabel(due: string) {
  const today = todayIso()
  if (due < today) return { text: `Overdue · ${fmtDay(due)}`, cls: 'text-red-600 font-medium' }
  if (due === today) return { text: 'Today', cls: 'text-amber-700 font-medium' }
  return { text: fmtDay(due), cls: 'text-slate-500' }
}
function fmtDay(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Tap the circle (or swipe right on a phone) to dismiss a row. It comes back if something new happens on the deal.
// Empty circle; tap it and it fills green with a check, then the row goes
// (like Reminders on iPhone).
function CheckCircle({ checked, onCheck, label }: { checked: boolean; onCheck: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onCheck}
      disabled={checked}
      aria-label={label}
      title={label}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-200 ${
        checked ? 'scale-110 border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500'
      }`}
    >
      ✓
    </button>
  )
}

// How long a checked row stays (filled in) before it goes.
const CHECK_DELAY = 600

// Tapping a row (anywhere but the deal name) covers it with "Mark as dead".
function Row({
  item,
  showOwner,
  onDismiss,
  onKill,
}: {
  item: TodoItem
  showOwner: boolean
  onDismiss: (i: TodoItem) => void
  onKill: (i: TodoItem) => void
}) {
  const [checked, setChecked] = useState(false)
  const [menu, setMenu] = useState(false)
  // Clicking anywhere else closes it.
  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])
  const check = () => {
    setChecked(true)
    setTimeout(() => onDismiss(item), CHECK_DELAY)
  }
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const touch = useRef<{ x: number; y: number; id: number; swiping: boolean } | null>(null)
  const swiped = useRef(false)
  const rowRef = useRef<HTMLLIElement>(null)

  const reset = () => {
    touch.current = null
    setDragging(false)
    setDx(0)
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return
    touch.current = { x: e.clientX, y: e.clientY, id: e.pointerId, swiping: false }
    swiped.current = false
  }
  const onPointerMove = (e: React.PointerEvent<HTMLLIElement>) => {
    const t = touch.current
    if (!t || e.pointerId !== t.id) return
    const mx = e.clientX - t.x
    const my = e.clientY - t.y
    if (!t.swiping) {
      // Scrolling up/down: leave it to the page.
      if (Math.abs(my) > 10 && Math.abs(my) >= Math.abs(mx)) return void (touch.current = null)
      if (mx < 10 || mx < Math.abs(my) * 1.5) return
      t.swiping = true
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    setDx(Math.max(0, mx))
  }
  const onPointerUp = () => {
    const t = touch.current
    touch.current = null
    setDragging(false)
    if (!t?.swiping) return
    swiped.current = true
    const width = rowRef.current?.offsetWidth ?? 320
    if (dx > Math.min(110, width * 0.35)) {
      setDx(width)
      setTimeout(() => onDismiss(item), 180)
    } else setDx(0)
  }

  return (
    <li
      ref={rowRef}
      className="relative overflow-hidden"
      style={{ touchAction: 'pan-y' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}
      // A swipe isn't a tap: don't open the deal.
      onClickCapture={(e) => {
        if (swiped.current) {
          e.preventDefault()
          e.stopPropagation()
          swiped.current = false
        }
      }}
    >
      <div aria-hidden="true" className={`absolute inset-0 flex items-center bg-emerald-500 pl-5 text-sm font-semibold text-white ${dx > 0 ? '' : 'invisible'}`}>
        ✓ Done
      </div>
      <div
        className="relative flex items-center bg-white hover:bg-slate-50"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dragging ? 'none' : 'transform 180ms ease-out' }}
      >
        <span className="shrink-0 py-3 pl-3.5 sm:pl-4">
          <CheckCircle checked={checked} onCheck={check} label="Done — it comes back if something new happens on this deal" />
        </span>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setMenu(true)}
          onKeyDown={(e) => e.key === 'Enter' && setMenu(true)}
          className={`flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3 pl-3 transition-opacity duration-300 ${checked ? 'opacity-40' : ''}`}
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <Link
                href={`/deals/${item.id}`}
                onClick={(e) => e.stopPropagation()}
                className="truncate text-[15px] font-semibold text-slate-900 hover:underline"
              >
                {item.name}
              </Link>
              {item.days >= 2 && (
                <span className={`shrink-0 text-[11px] ${item.days >= 5 ? 'text-amber-700' : 'text-slate-400'}`}>{item.days}d</span>
              )}
            </span>
            <span className="line-clamp-2 text-sm text-slate-600">{item.text}</span>
            {item.detail && <span className="mt-0.5 line-clamp-1 text-xs text-slate-400">{item.detail}</span>}
          </span>
        </div>
        {/* Whose deal — set it here; it moves to that person's list. */}
        <span className={`shrink-0 pl-2 pr-3 ${showOwner || !item.owner ? '' : 'max-sm:hidden'}`}>
          <OwnerSelect dealId={item.id} owner={item.owner} />
        </span>
        {menu && (
          <div className="absolute inset-0 z-10 flex items-center justify-end gap-2 bg-white/90 px-3 backdrop-blur-[2px] sm:px-4">
            <span className="mr-auto truncate text-sm font-medium text-slate-500">{item.name}</span>
            <button
              type="button"
              onClick={() => setMenu(false)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setMenu(false)
                onKill(item)
              }}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
            >
              Mark as dead
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

function MyTodoRow({ todo, showWho, onDone }: { todo: MyTodo; showWho: boolean; onDone: (t: MyTodo) => void }) {
  const [pending, startTransition] = useTransition()
  const due = todo.dueDate ? dueLabel(todo.dueDate) : null
  const [checked, setChecked] = useState(false)
  return (
    <li className="flex items-start gap-3 px-3.5 py-3 sm:px-4">
      <span className="mt-0.5">
        <CheckCircle
          checked={checked}
          label="Mark done"
          onCheck={() => {
            setChecked(true)
            setTimeout(() => onDone(todo), CHECK_DELAY)
          }}
        />
      </span>
      <div className={`min-w-0 flex-1 transition-opacity duration-300 ${checked ? 'opacity-40' : ''}`}>
        <p className="text-[15px] text-slate-900 [overflow-wrap:anywhere]">{todo.text}</p>
        {(todo.deal || due || showWho) && (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            {showWho && <span className="font-medium text-slate-500">{todo.assignee}</span>}
            {todo.deal && (
              <Link href={`/deals/${todo.deal.id}`} className="text-slate-600 underline">
                {todo.deal.name}
              </Link>
            )}
            {due && <span className={due.cls}>{due.text}</span>}
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm('Delete this to-do?')) startTransition(() => deleteTodo(todo.id))
        }}
        className="shrink-0 px-1 text-lg leading-none text-slate-300 hover:text-red-500 disabled:opacity-50"
        aria-label="Delete"
      >
        ×
      </button>
    </li>
  )
}

function AddTodo({ defaultFor, deals }: { defaultFor: TeamMember; deals: { id: string; name: string }[] }) {
  const [text, setText] = useState('')
  const [assignee, setAssignee] = useState<TeamMember>(defaultFor)
  const [dealId, setDealId] = useState('')
  const [due, setDue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // Follow the David / Eli switch.
  useEffect(() => setAssignee(defaultFor), [defaultFor])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setError(null)
    startTransition(async () => {
      const res = await addTodo({ text, assignee, dealId: dealId || null, dueDate: due || null })
      if (res && 'error' in res && res.error) setError(res.error)
      else {
        setText('')
        setDealId('')
        setDue('')
      }
    })
  }

  const field = 'rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700'
  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm">
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a to-do…"
          className="min-w-0 flex-1 rounded-lg px-2 py-2 text-[15px] outline-none placeholder:text-slate-400"
        />
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="shrink-0 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {pending ? 'Adding…' : 'Add'}
        </button>
      </div>
      {text.trim() && (
        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 sm:flex sm:flex-wrap">
          <div className="col-span-2 flex rounded-lg bg-slate-100 p-0.5 sm:col-span-1">
            {TEAM.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setAssignee(t)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${assignee === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                For {t}
              </button>
            ))}
          </div>
          <select value={dealId} onChange={(e) => setDealId(e.target.value)} className={`${field} min-w-0 sm:max-w-[14rem]`} aria-label="Deal">
            <option value="">No deal</option>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={`${field} min-w-0`} aria-label="Due date" />
        </div>
      )}
      {error && <p className="mt-1.5 px-2 text-xs text-red-600">{error}</p>}
    </form>
  )
}

export function TodoList({
  who,
  me,
  sections,
  waiting,
  todos,
  deals,
}: {
  who: TeamMember | 'all'
  me: TeamMember | null
  sections: TodoSection[]
  waiting: TodoItem[]
  todos: MyTodo[]
  deals: { id: string; name: string }[]
}) {
  // null = everything; otherwise one section's rank (0 = written to-dos).
  const [only, setOnly] = useState<number | null>(null)
  // Ticked-off to-dos hide right away; "Undo" brings the last one back.
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())
  const [lastDone, setLastDone] = useState<MyTodo | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Dismissed deal steps hide right away too (with Undo).
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [lastDismissed, setLastDismissed] = useState<TodoItem | null>(null)
  const [dismissError, setDismissError] = useState<string | null>(null)
  function dismiss(i: TodoItem) {
    setDismissedIds((s) => new Set(s).add(i.id))
    setLastDismissed(i)
    setLastDone(null)
    setLastDead(null)
    void dismissStep(i.id, i.text).then((r) => {
      if (r && 'error' in r && r.error) {
        setDismissError(r.error)
        setDismissedIds((s) => {
          const next = new Set(s)
          next.delete(i.id)
          return next
        })
      }
    })
    if (undoTimer.current) clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => setLastDismissed(null), 6000)
  }
  function undoDismiss() {
    if (!lastDismissed) return
    const i = lastDismissed
    setDismissedIds((s) => {
      const next = new Set(s)
      next.delete(i.id)
      return next
    })
    setLastDismissed(null)
    void dismissStep(i.id, null)
  }
  // Mark as dead: hide right away, with Undo putting the old status back.
  const [lastDead, setLastDead] = useState<{ item: TodoItem; prev: DealStatus | null } | null>(null)
  function kill(i: TodoItem) {
    setDismissedIds((s) => new Set(s).add(i.id))
    setLastDismissed(null)
    setLastDone(null)
    setLastDead({ item: i, prev: null })
    void markDealDead(i.id).then((r) => {
      if ('error' in r && r.error) {
        setDismissError(r.error)
        setDismissedIds((s) => {
          const next = new Set(s)
          next.delete(i.id)
          return next
        })
        setLastDead(null)
      } else if ('prev' in r) setLastDead((d) => (d?.item.id === i.id ? { item: i, prev: r.prev ?? null } : d))
    })
    if (undoTimer.current) clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => setLastDead(null), 6000)
  }
  function undoKill() {
    if (!lastDead?.prev) return
    const { item, prev } = lastDead
    setDismissedIds((s) => {
      const next = new Set(s)
      next.delete(item.id)
      return next
    })
    setLastDead(null)
    void restoreDealStatus(item.id, prev)
  }
  sections = sections.map((sec) => ({ ...sec, items: sec.items.filter((x) => !dismissedIds.has(x.id)) })).filter((sec) => sec.items.length)
  waiting = waiting.filter((x) => !dismissedIds.has(x.id))

  const openTodos = todos.filter((t) => !doneIds.has(t.id))
  const both = who === 'all'
  const allSections = openTodos.length ? [{ rank: 0, title: both ? 'Written to-dos' : `${who}’s list`, items: [] }, ...sections] : sections
  const total = openTodos.length + sections.reduce((n, s) => n + s.items.length, 0)
  const shown = only === null ? allSections : allSections.filter((s) => s.rank === only)

  function markDone(t: MyTodo) {
    setDoneIds((s) => new Set(s).add(t.id))
    setLastDone(t)
    setLastDismissed(null)
    setLastDead(null)
    void setTodoDone(t.id, true)
    if (undoTimer.current) clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => setLastDone(null), 6000)
  }
  function undo() {
    if (!lastDone) return
    const t = lastDone
    setDoneIds((s) => {
      const next = new Set(s)
      next.delete(t.id)
      return next
    })
    setLastDone(null)
    void setTodoDone(t.id, false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">To do</h1>
        {/* Whose list. */}
        <div className="flex rounded-full bg-slate-200/70 p-0.5 text-sm">
          {[...TEAM, 'all' as const].map((p) => {
            const active = who === p
            return (
              <Link
                key={p}
                href={`/todo?who=${p.toLowerCase()}`}
                replace
                scroll={false}
                onClick={() => setOnly(null)}
                className={`rounded-full px-3.5 py-1.5 font-medium ${active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                {p === 'all' ? 'Both' : p}
                {p === me && <span className="sr-only"> (you)</span>}
              </Link>
            )
          })}
        </div>
      </div>
      <p className="-mt-2 text-sm text-slate-500">
        {total ? `${total} to do` : 'All clear'}
        {waiting.length > 0 && ` · ${waiting.length} waiting`}
        {!both && <span className="text-slate-400"> · {who}’s deals and shared ones</span>}
      </p>

      <AddTodo defaultFor={both ? (me ?? 'David') : who} deals={deals} />

      {/* Section chips — pinned while you scroll. */}
      {allSections.length > 1 && (
        <div className="sticky top-0 z-30 -mx-4 bg-slate-50/95 px-4 py-2 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setOnly(null)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${only === null ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
            >
              All <span className={only === null ? 'text-white/70' : 'text-slate-400'}>{total}</span>
            </button>
            {allSections.map((s) => (
              <button
                key={s.rank}
                type="button"
                onClick={() => setOnly(only === s.rank ? null : s.rank)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${only === s.rank ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
              >
                {(LOOK[s.rank] ?? LOOK[9]).chip}{' '}
                <span className={only === s.rank ? 'text-white/70' : 'text-slate-400'}>{s.rank === 0 ? openTodos.length : s.items.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {total === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Nothing needs {both ? 'you' : who} right now — every deal is waiting on someone else.
        </p>
      )}

      {shown.map((s) =>
        s.rank === 0 ? (
          <section key="mine">
            <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {s.title} <span className="font-normal text-slate-400">· {openTodos.length}</span>
            </h2>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {openTodos.map((t) => (
                <MyTodoRow key={t.id} todo={t} showWho={both} onDone={markDone} />
              ))}
            </ul>
          </section>
        ) : (
          <section key={s.rank}>
            <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {s.title} <span className="font-normal text-slate-400">· {s.items.length}</span>
            </h2>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {s.items.map((i) => (
                <Row key={i.id} item={i} showOwner={both} onDismiss={dismiss} onKill={kill} />
              ))}
            </ul>
          </section>
        )
      )}

      {only === null && waiting.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <span className="transition-transform group-open:rotate-90">›</span>
            Waiting on others · {waiting.length}
          </summary>
          <ul className="mt-1.5 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {waiting.map((i) => (
              <Row key={i.id} item={i} showOwner={both} onDismiss={dismiss} onKill={kill} />
            ))}
          </ul>
        </details>
      )}

      {lastDismissed && (
        <div className="fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-sm items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg sm:bottom-6">
          <span className="truncate">Dismissed: {lastDismissed.name}</span>
          <button type="button" onClick={undoDismiss} className="shrink-0 font-semibold text-emerald-300">
            Undo
          </button>
        </div>
      )}
      {lastDead && (
        <div className="fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-sm items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg sm:bottom-6">
          <span className="truncate">Marked dead: {lastDead.item.name}</span>
          <button type="button" onClick={undoKill} disabled={!lastDead.prev} className="shrink-0 font-semibold text-emerald-300 disabled:opacity-50">
            Undo
          </button>
        </div>
      )}
      {dismissError && <p className="text-center text-xs text-red-600">{dismissError}</p>}
      {lastDone && (
        <div className="fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-sm items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg sm:bottom-6">
          <span className="truncate">Done: {lastDone.text}</span>
          <button type="button" onClick={undo} className="shrink-0 font-semibold text-emerald-300">
            Undo
          </button>
        </div>
      )}
    </div>
  )
}
