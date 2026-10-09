'use client'

import { usePathname } from 'next/navigation'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

// On phones, a long page (like a deal) is split into tabs instead of one
// endless scroll; each CollapsibleSection says which tab it belongs to.
// On computers nothing changes — every section shows as before.

type Tab = { key: string; label: string; count?: number }

const Ctx = createContext<string | null>(null)

export function usePhoneTab() {
  return useContext(Ctx)
}

export function PhoneTabs({ tabs, children }: { tabs: Tab[]; children: ReactNode }) {
  const pathname = usePathname()
  const [active, setActive] = useState(tabs[0]?.key ?? '')

  // Come back to the same tab when returning to this page.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(`tab:${pathname}`)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore the tab once on load
      if (saved && tabs.some((t) => t.key === saved)) setActive(saved)
    } catch {
      // Storage blocked — start on the first tab.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page
  }, [pathname])

  function pick(key: string) {
    setActive(key)
    try {
      sessionStorage.setItem(`tab:${pathname}`, key)
    } catch {
      // Fine without it.
    }
    window.scrollTo({ top: 0 })
  }

  return (
    <Ctx.Provider value={active}>
      <div className="sticky top-0 z-30 -mx-4 border-b border-slate-200 bg-slate-50/95 px-4 py-2 backdrop-blur sm:hidden">
        <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => pick(t.key)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${
                active === t.key ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
              }`}
            >
              {t.label}
              {t.count ? <span className={active === t.key ? 'ml-1 text-white/70' : 'ml-1 text-slate-400'}>{t.count}</span> : null}
            </button>
          ))}
        </div>
      </div>
      {children}
    </Ctx.Provider>
  )
}
