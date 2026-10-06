'use client'

import { useEffect, useRef, useState } from 'react'
import type { NextStep } from '@/lib/deals/next-step'
import { URGENCY_STYLES } from '@/lib/deals/next-step'

// A small "Next step" button; the step itself shows in a popover on click.
export function NextStepToggle({ step, align = 'left' }: { step: NextStep; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const style = URGENCY_STYLES[step.urgency]

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const hide = () => setOpen(false)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [open])

  // Fixed position so a scrolling table can't clip the box.
  function toggle() {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect()
      const width = 288
      const left = align === 'right' ? r.right - width : Math.min(r.left, window.innerWidth - width - 8)
      setPos({ top: r.bottom + 4, left: Math.max(8, left) })
    }
    setOpen((v) => !v)
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        Next step
        <svg viewBox="0 0 20 20" fill="currentColor" className={`h-3.5 w-3.5 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">
          <path d="M7.2 4.2a1 1 0 0 1 1.4 0l5.1 5.1a1 1 0 0 1 0 1.4l-5.1 5.1a1 1 0 1 1-1.4-1.4L11.6 10 7.2 5.6a1 1 0 0 1 0-1.4Z" />
        </svg>
      </button>
      {open && pos && (
        <div style={{ position: 'fixed', top: pos.top, left: pos.left }} className="z-50 w-72 rounded-lg border bg-white p-3 text-sm shadow-lg">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">{style.label}</p>
          <p className={step.urgency === 'you' || step.urgency === 'follow_up' ? 'font-medium text-slate-900' : 'text-slate-600'}>{step.text}</p>
          {step.detail && <p className="mt-1 text-xs text-slate-500">{step.detail}</p>}
        </div>
      )}
    </div>
  )
}
