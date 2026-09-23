'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { readJsonResponse } from '@/lib/fetch-json'

type Run = { dealId: string; dealName: string; startedAt: number }
type Result = { dealId: string; error: string | null } | null

type Ctx = {
  run: Run | null
  result: Result
  start: (dealId: string, dealName: string) => void
  stop: () => void
}

const RunnerContext = createContext<Ctx | null>(null)

export function useUnderwritingRunner() {
  const ctx = useContext(RunnerContext)
  if (!ctx) throw new Error('useUnderwritingRunner must be used inside UnderwritingRunnerProvider')
  return ctx
}

// Lives in the dashboard layout, which stays mounted while you move between
// pages — so an underwriting run (and its banner + Stop button) keeps going
// no matter which deal or page you navigate to.
export function UnderwritingRunnerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [run, setRun] = useState<Run | null>(null)
  const [result, setResult] = useState<Result>(null)
  const [elapsed, setElapsed] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const startedAt = run?.startedAt

  useEffect(() => {
    if (!startedAt) return
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(t)
  }, [startedAt])

  async function start(dealId: string, dealName: string) {
    if (abortRef.current) return // one run at a time
    const controller = new AbortController()
    abortRef.current = controller
    setResult(null)
    setElapsed(0)
    setRun({ dealId, dealName, startedAt: Date.now() })
    let error: string | null = null
    try {
      const res = await fetch(`/api/deals/${dealId}/underwrite`, {
        method: 'POST',
        signal: controller.signal,
      })
      const parsed = await readJsonResponse(res)
      if (!parsed.ok) error = parsed.message
    } catch (err) {
      error =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Underwriting stopped. Nothing was saved and the AI run was cancelled.'
          : err instanceof Error
            ? err.message
            : 'Underwriting failed'
    } finally {
      abortRef.current = null
      setRun(null)
      setResult({ dealId, error })
      router.refresh()
    }
  }

  function stop() {
    abortRef.current?.abort()
  }

  return (
    <RunnerContext.Provider value={{ run, result, start, stop }}>
      {run && (
        <div className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-4 bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow">
          <span>
            Underwriting {run.dealName} — {Math.floor(elapsed / 60)}:
            {String(elapsed % 60).padStart(2, '0')}. This can take several
            minutes. You can browse other pages while it runs.
          </span>
          <Link
            href={`/deals/${run.dealId}`}
            className="rounded-md border border-white/60 px-3 py-1 hover:bg-amber-600"
          >
            Go to deal
          </Link>
          <button
            onClick={stop}
            className="rounded-md bg-white px-3 py-1 text-amber-700 hover:bg-amber-50"
          >
            Stop
          </button>
        </div>
      )}
      {children}
    </RunnerContext.Provider>
  )
}
