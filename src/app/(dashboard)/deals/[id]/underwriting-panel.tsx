'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { Underwriting } from '@/lib/underwriting/schema'
import { formatCurrency } from '@/lib/format'
import { readJsonResponse } from '@/lib/fetch-json'

export function UnderwritingPanel({
  dealId,
  underwriting,
  generatedAt,
}: {
  dealId: string
  underwriting: Underwriting | null
  generatedAt: string | null
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!loading) return
    const start = Date.now()
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(t)
  }, [loading])

  function stop() {
    abortRef.current?.abort()
  }

  async function run() {
    setLoading(true)
    setElapsed(0)
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch(`/api/deals/${dealId}/underwrite`, {
        method: 'POST',
        signal: controller.signal,
      })
      const result = await readJsonResponse(res)
      if (!result.ok) {
        throw new Error(result.message)
      }
      router.refresh()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Underwriting stopped. Nothing was saved and the AI run was cancelled.')
      } else {
        setError(err instanceof Error ? err.message : 'Underwriting failed')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      {loading && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-4 bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow">
          <span>
            Underwriting in progress — {Math.floor(elapsed / 60)}:
            {String(elapsed % 60).padStart(2, '0')}. This can take several
            minutes; please give it time and stay on this page.
          </span>
          <button
            onClick={stop}
            className="rounded-md bg-white px-3 py-1 text-amber-700 hover:bg-amber-50"
          >
            Stop
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            AI underwriting
          </h2>
          {generatedAt && (
            <p className="mt-0.5 text-xs text-slate-400">
              Last run {new Date(generatedAt).toLocaleString()}
            </p>
          )}
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {loading
            ? 'Analyzing… (see banner above)'
            : underwriting
              ? 'Re-run underwriting'
              : 'Run underwriting'}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {!underwriting && !loading && (
        <p className="mt-4 text-sm text-slate-400">
          Reads whatever is available — uploaded documents, the company
          website, and web search for news — to summarize financials and
          flag risks. Works fine with limited or no public information;
          upload documents first for the best results.
        </p>
      )}

      {underwriting && (
        <div className="mt-5 space-y-6">
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
            AI-generated — verify figures against the source documents before
            making a credit decision.
          </p>

          <div>
            <h3 className="text-xs font-semibold uppercase text-slate-500">
              Company overview
            </h3>
            <p className="mt-1 text-sm text-slate-700">
              {underwriting.company_overview}
            </p>
          </div>

          {underwriting.historical_financials.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-500">
                Historical financials
              </h3>
              <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Period</th>
                      <th className="px-3 py-2">Revenue</th>
                      <th className="px-3 py-2">EBITDA</th>
                      <th className="px-3 py-2">Net income</th>
                      <th className="px-3 py-2">Cash flow</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {underwriting.historical_financials.map((period) => (
                      <tr key={period.period}>
                        <td className="px-3 py-2 font-medium text-slate-700">
                          {period.period}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {formatCurrency(period.revenue)}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {formatCurrency(period.ebitda)}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {formatCurrency(period.net_income)}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {formatCurrency(period.cash_flow)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <h3 className="text-xs font-semibold uppercase text-slate-500">
              Current position
              {underwriting.current_position.as_of &&
                ` (as of ${underwriting.current_position.as_of})`}
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                ['AR', underwriting.current_position.accounts_receivable],
                ['Inventory', underwriting.current_position.inventory],
                ['Equipment', underwriting.current_position.equipment_value],
                ['Real estate', underwriting.current_position.real_estate_value],
                ['AP', underwriting.current_position.accounts_payable],
                ['Total debt', underwriting.current_position.total_debt],
              ].map(([label, value]) => (
                <div
                  key={label as string}
                  className="rounded-lg border border-slate-200 px-3 py-2"
                >
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="text-sm font-medium text-slate-800">
                    {formatCurrency(value as number | null)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-500">
                Strengths
              </h3>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-700">
                {underwriting.strengths.length > 0 ? (
                  underwriting.strengths.map((s, i) => <li key={i}>{s}</li>)
                ) : (
                  <li className="list-none text-slate-400">None noted</li>
                )}
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-500">
                Risks
              </h3>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-700">
                {underwriting.risks.length > 0 ? (
                  underwriting.risks.map((s, i) => <li key={i}>{s}</li>)
                ) : (
                  <li className="list-none text-slate-400">None noted</li>
                )}
              </ul>
            </div>
          </div>

          {underwriting.recent_news.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-500">
                Recent news
              </h3>
              <ul className="mt-2 space-y-2">
                {underwriting.recent_news.map((n, i) => (
                  <li key={i} className="text-sm">
                    {n.url ? (
                      <a
                        href={n.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-slate-800 hover:underline"
                      >
                        {n.headline}
                      </a>
                    ) : (
                      <span className="font-medium text-slate-800">
                        {n.headline}
                      </span>
                    )}
                    <p className="text-slate-600">{n.summary}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {underwriting.data_gaps.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-500">
                Data gaps
              </h3>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-500">
                {underwriting.data_gaps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 className="text-xs font-semibold uppercase text-slate-500">
              Summary
            </h3>
            <p className="mt-1 text-sm text-slate-700">
              {underwriting.summary}
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
