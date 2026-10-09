'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

// Opening a page (tapping a tab, a deal, a link) starts at the very top of
// the screen, header included. Going Back still returns to where you were.
export function ScrollToTop() {
  const pathname = usePathname()
  const fromBack = useRef(false)
  const first = useRef(true)

  useEffect(() => {
    const onPop = () => (fromBack.current = true)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (fromBack.current) {
      fromBack.current = false
      return
    }
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
