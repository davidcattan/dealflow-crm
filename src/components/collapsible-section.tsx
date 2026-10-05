'use client'

import { useEffect, useState, type ReactNode } from 'react'

// Lets a page section be hidden with a small arrow (shown by default).
// Hidden sections stay mounted — just not displayed — so anything running
// inside them (an underwriting run, a search) keeps going.

const EVENT = 'collapsible-sections:set-all'

export function CollapsibleSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true)

  useEffect(() => {
    const onSetAll = (e: Event) => setOpen((e as CustomEvent<boolean>).detail)
    window.addEventListener(EVENT, onSetAll)
    return () => window.removeEventListener(EVENT, onSetAll)
  }, [])

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400 hover:text-slate-700"
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        >
          <path d="M7.2 4.2a1 1 0 0 1 1.4 0l5.1 5.1a1 1 0 0 1 0 1.4l-5.1 5.1a1 1 0 1 1-1.4-1.4L11.6 10 7.2 5.6a1 1 0 0 1 0-1.4Z" />
        </svg>
        {title}
        {!open && <span className="normal-case tracking-normal text-slate-400">— hidden, click to show</span>}
      </button>
      <div className={open ? '' : 'hidden'}>{children}</div>
    </div>
  )
}

export function CollapseAllControls() {
  const setAll = (open: boolean) => window.dispatchEvent(new CustomEvent(EVENT, { detail: open }))
  return (
    <div className="flex gap-3 text-xs text-slate-500">
      <button type="button" onClick={() => setAll(false)} className="hover:text-slate-800 hover:underline">
        Collapse all
      </button>
      <button type="button" onClick={() => setAll(true)} className="hover:text-slate-800 hover:underline">
        Expand all
      </button>
    </div>
  )
}
