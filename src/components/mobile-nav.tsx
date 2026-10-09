'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { logout } from '@/app/login/actions'
import type { InboxHealth } from '@/lib/inbox/health'

// Phone-only bottom tab bar (like a native app), plus a "More" sheet.

export const OPEN_ASK_AI_EVENT = 'ask-ai:open'

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

const ICONS = {
  pipeline: 'M3.75 6h16.5M3.75 12h16.5m-16.5 6h10.5',
  deals: 'M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.06-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.38a1.5 1.5 0 0 1-1.06-.44Z',
  bell: 'M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0',
  lenders:
    'M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21',
  todo: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  more: 'M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm6 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm6 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z',
}

function Tab({ href, label, icon, active, badge }: { href: string; label: string; icon: string; active: boolean; badge?: number }) {
  return (
    <Link
      href={href}
      className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] ${active ? 'text-slate-900' : 'text-slate-400'}`}
    >
      <Icon d={icon} />
      {label}
      {badge ? (
        <span className="absolute right-[calc(50%-18px)] top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  )
}

function SheetLink({ href, children, onClick }: { href: string; children: ReactNode; onClick: () => void }) {
  return (
    <Link href={href} onClick={onClick} className="block rounded-lg px-4 py-3 text-base text-slate-800 active:bg-slate-100">
      {children}
    </Link>
  )
}

export function MobileNav({ unread, health, email }: { unread: number; health: InboxHealth; email: string | null }) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)

  // Close the sheet when the page changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on navigation
    setMoreOpen(false)
  }, [pathname])

  const is = (p: string) => (p === '/' ? pathname === '/' : pathname.startsWith(p))
  const moreActive = ['/lenders', '/inbox', '/usage', '/settings'].some(is) || pathname === '/'

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-stretch">
          <Tab href="/pipeline" label="Pipeline" icon={ICONS.pipeline} active={is('/pipeline') || is('/deals')} />
          <Tab href="/todo" label="To do" icon={ICONS.todo} active={is('/todo')} />
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(OPEN_ASK_AI_EVENT))}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] text-slate-900"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm text-white">✨</span>
            Ask AI
          </button>
          <Tab href="/activity" label="Activity" icon={ICONS.bell} active={is('/activity')} badge={unread} />
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] ${moreActive ? 'text-slate-900' : 'text-slate-400'}`}
          >
            <Icon d={ICONS.more} />
            More
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 sm:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-3 shadow-2xl"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200" />
            <SheetLink href="/lenders" onClick={() => setMoreOpen(false)}>Lenders</SheetLink>
            <SheetLink href="/" onClick={() => setMoreOpen(false)}>Dashboard</SheetLink>
            <SheetLink href="/inbox" onClick={() => setMoreOpen(false)}>
              Inbox
              <span className="ml-2 text-sm text-slate-400">
                · {health.level === 'ok' ? 'live' : health.level === 'paused' ? 'paused overnight' : health.level}
              </span>
            </SheetLink>
            <SheetLink href="/usage" onClick={() => setMoreOpen(false)}>Usage &amp; AI spend</SheetLink>
            <SheetLink href="/settings" onClick={() => setMoreOpen(false)}>Settings</SheetLink>
            <div className="my-2 border-t border-slate-100" />
            <form action={logout}>
              <button type="submit" className="w-full rounded-lg px-4 py-3 text-left text-base text-red-600 active:bg-slate-100">
                Sign out{email ? <span className="ml-2 text-sm text-slate-400">{email}</span> : null}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
