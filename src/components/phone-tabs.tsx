'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

// A long page (like a deal) is split into tabs instead of one endless
// scroll — on phones and computers; each CollapsibleSection says which tab
// it belongs to. Always opens on the first tab (a deal's Overview).

type Tab = { key: string; label: string; count?: number }

const Ctx = createContext<string | null>(null)
const PickCtx = createContext<((key: string) => void) | null>(null)

export function usePhoneTab() {
  return useContext(Ctx)
}

// Switch tabs from inside the page (e.g. a key fact opening its source).
export function useSetTab() {
  return useContext(PickCtx)
}

export function PhoneTabs({ tabs, children }: { tabs: Tab[]; children: ReactNode }) {
  const [active, setActive] = useState(tabs[0]?.key ?? '')

  function pick(key: string) {
    setActive(key)
    window.scrollTo({ top: 0 })
  }

  return (
    <Ctx.Provider value={active}>
      <PickCtx.Provider value={pick}>
      <div className="sticky top-0 z-30 -mx-4 border-b border-slate-200 bg-slate-50/95 px-4 py-2 backdrop-blur sm:mx-0 sm:px-0 sm:py-0">
        <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] sm:gap-6 [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => pick(t.key)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium sm:-mb-px sm:rounded-none sm:border-b-2 sm:px-1 sm:py-2.5 ${
                active === t.key
                  ? 'bg-slate-900 text-white sm:border-slate-900 sm:bg-transparent sm:text-slate-900'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 sm:border-transparent sm:bg-transparent sm:text-slate-500 sm:ring-0 sm:hover:text-slate-800'
              }`}
            >
              {t.label}
              {t.count ? <span className={active === t.key ? 'ml-1 text-white/70 sm:text-slate-400' : 'ml-1 text-slate-400'}>{t.count}</span> : null}
            </button>
          ))}
        </div>
      </div>
      {children}
      </PickCtx.Provider>
    </Ctx.Provider>
  )
}
