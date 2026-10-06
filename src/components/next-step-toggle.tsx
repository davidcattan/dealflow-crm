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
        title={style.label}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
      >
        <span className={`h-2 w-2 rounded-full ${style.dot}`} />
        Next step
        <span className="text-slate-400">{open ? '▴' : '▾'}</span>
      </button>
      {open && pos && (
        <div style={{ position: 'fixed', top: pos.top, left: pos.left }} className="z-50 w-72 rounded-lg border bg-white p-3 text-sm shadow-lg">
          <p className={`mb-1 inline-block rounded-full border px-2 py-0.5 text-[11px] ${style.pill}`}>{style.label}</p>
          <p className="text-slate-800">{step.text}</p>
          {step.detail && <p className="mt-1 text-xs text-slate-500">{step.detail}</p>}
        </div>
      )}
    </div>
  )
}
