'use client'

import { useState, type ReactNode } from 'react'

// A list that shows only its first 10 items on phones until "Show all"
// (computers always show everything).
export function PhoneShowMore({ count, className = '', children }: { count: number; className?: string; children: ReactNode }) {
  const [all, setAll] = useState(false)
  return (
    <>
      <ul className={`${className} ${all ? '' : 'max-sm:[&>li:nth-child(n+11)]:hidden'}`}>{children}</ul>
      {count > 10 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-sm text-slate-600 underline sm:hidden">
          {all ? 'Show fewer' : `Show all ${count}`}
        </button>
      )}
    </>
  )
}
