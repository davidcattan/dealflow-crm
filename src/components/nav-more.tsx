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
        className={`flex items-center gap-1 whitespace-nowrap hover:text-slate-900 ${activeHere ? 'text-slate-900' : ''}`}
        aria-expanded={open}
      >
        More
        <svg viewBox="0 0 20 20" fill="currentColor" className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
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
