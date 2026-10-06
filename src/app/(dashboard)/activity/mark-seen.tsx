'use client'

import { useEffect } from 'react'
import { markActivitySeen } from './actions'

// Marks everything as read once the page has been shown (so new items are
// still highlighted on this visit).
export function MarkSeen() {
  useEffect(() => {
    markActivitySeen()
  }, [])
  return null
}
