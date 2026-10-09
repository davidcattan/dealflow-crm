'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePhoneTab } from './phone-tabs'

// Lets a page section be hidden with a small arrow (shown by default).
// Hidden sections stay mounted — just not displayed — so anything running
// inside them (an underwriting run, a search) keeps going.
//
// phoneClosed: starts hidden on phones (shown on computers). Done with CSS
// until the user toggles, so there's no flash of open content on load.
//
// tab: on a page with PhoneTabs, the phone tab this section lives in. On a
// phone it then shows (fully open, no arrow) only on that tab.

const EVENT = 'collapsible-sections:set-all'
const PHONE = '(max-width: 639px)'

export function CollapsibleSection({
  title,
  children,
  phoneClosed = false,
  closed = false,
  tab,
  keepToggle = false,
}: {
  title: string
  children: ReactNode
  tab?: string
  // In a phone tab, keep the arrow and start closed (e.g. long extras).
  keepToggle?: boolean
  phoneClosed?: boolean
  // Starts hidden everywhere (e.g. a section that's already filled in).
  closed?: boolean
}) {
  // null = follow the default (open; or closed on phones if phoneClosed).
  const [open, setOpen] = useState<boolean | null>(closed ? false : phoneClosed ? null : true)

  useEffect(() => {
    const onSetAll = (e: Event) => setOpen((e as CustomEvent<boolean>).detail)
    window.addEventListener(EVENT, onSetAll)
    return () => window.removeEventListener(EVENT, onSetAll)
  }, [])

  const toggle = () =>
    setOpen((v) => {
      if (v !== null) return !v
      // Default state: closed on phones, open on computers.
      return window.matchMedia(PHONE).matches
    })

  const activeTab = usePhoneTab()
  const inTabs = Boolean(tab && activeTab)
  const forceOpen = inTabs && !keepToggle

  const arrow = open === null ? 'sm:rotate-90' : open ? 'rotate-90' : ''
  const body = `${open === null ? 'hidden sm:block' : open ? '' : 'hidden'} ${forceOpen ? 'max-sm:!block' : ''}`
  const hint = open === null ? 'sm:hidden' : open ? 'hidden' : ''

  return (
    <div className={inTabs && tab !== activeTab ? 'max-sm:hidden' : ''}>
      <button
        type="button"
        onClick={toggle}
        className={`mb-2 flex items-center gap-1.5 py-1 text-xs font-medium uppercase tracking-wide text-slate-400 hover:text-slate-700 ${forceOpen ? 'max-sm:hidden' : ''}`}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className={`h-3.5 w-3.5 transition-transform ${arrow}`} aria-hidden="true">
          <path d="M7.2 4.2a1 1 0 0 1 1.4 0l5.1 5.1a1 1 0 0 1 0 1.4l-5.1 5.1a1 1 0 1 1-1.4-1.4L11.6 10 7.2 5.6a1 1 0 0 1 0-1.4Z" />
        </svg>
        {title}
        <span className={`normal-case tracking-normal text-slate-400 ${hint}`}>— tap to show</span>
      </button>
      <div className={body}>{children}</div>
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
