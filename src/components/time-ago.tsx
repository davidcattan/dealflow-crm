'use client'

import { useEffect, useState } from 'react'

// "12 min ago" in the viewer's own time zone (server-rendered times would
// show the server's UTC clock). Updates every minute.
export function TimeAgo({ iso, withTime = false }: { iso: string; withTime?: boolean }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start the clock on the client only
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const date = new Date(iso)
  const clock = date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  if (now === null) return <span suppressHydrationWarning>{clock}</span>
  const mins = Math.round((now - date.getTime()) / 60000)
  const rel = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)}h ago` : `${Math.round(mins / 1440)}d ago`
  return (
    <span title={clock}>
      {rel}
      {withTime && <span className="text-slate-400"> ({clock})</span>}
    </span>
  )
}
