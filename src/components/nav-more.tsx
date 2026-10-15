'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/lenders', label: 'Lenders' },
  { href: '/prospects', label: 'Prospects' },
  { href: '/usage', label: 'Usage' },
  { href: '/settings', label: 'Settings' },
]

// The less-used pages, plus who's signed in and Sign out, behind "More".
export function NavMore({ email, logout }: { email: string | null; logout: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const activeHere = LINKS.some((l) => pathname.startsWith(l.href))

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="More: Lenders, Prospects, Usage, Settings, Sign out"
        aria-label="More"
        aria-expanded={open}
        className={`rounded-md p-1 hover:bg-slate-100 hover:text-slate-800 ${open || activeHere ? 'bg-slate-100 text-slate-800' : 'text-slate-500'}`}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`block px-3 py-2 text-sm hover:bg-slate-50 ${pathname.startsWith(l.href) ? 'font-medium text-slate-900' : 'text-slate-700'}`}
            >
              {l.label}
            </Link>
          ))}
          <div className="mt-1 border-t border-slate-100 px-3 pb-1 pt-2">
            {email && <p className="truncate text-xs text-slate-400">{email}</p>}
            <form action={logout}>
              <button type="submit" className="mt-1 text-sm text-slate-600 hover:text-slate-900">
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
