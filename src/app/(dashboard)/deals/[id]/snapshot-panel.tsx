'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { Snapshot } from '@/lib/snapshot/schema'
import { snapshotToText } from '@/lib/snapshot/text'
import { readJsonResponse } from '@/lib/fetch-json'
import { ErrorText } from '@/components/error-text'
import { SnapshotEditor } from './snapshot-editor'
import { ManualUnderwriting, type ManualDoc } from './manual-underwriting'

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : n < 0
      ? `($${Math.abs(Math.round(n)).toLocaleString('en-US')})`
      : `$${Math.round(n).toLocaleString('en-US')}`

function PeriodsTable({
  periods,
  showSource,
}: {
  periods: Snapshot['entities'][number]['periods']
  showSource: boolean
}) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase text-slate-500">
        <tr>
          <th className="py-1 pr-3">Period</th>
          <th className="py-1 pr-3">Revenue</th>
          <th className="py-1 pr-3">EBITDA</th>
          <th className="py-1 pr-3">Net income</th>
          {showSource && <th className="py-1">Source</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {periods.map((p) => (
          <tr key={p.label}>
            <td className="py-1.5 pr-3 font-medium text-slate-700">{p.label}</td>
            <td className="py-1.5 pr-3 text-slate-700">{money(p.revenue)}</td>
            <td className="py-1.5 pr-3 text-slate-700">{money(p.ebitda)}</td>
            <td className="py-1.5 pr-3 text-slate-700">{money(p.net_income)}</td>
            {showSource && <td className="py-1.5 text-xs text-slate-500">{'source' in p ? p.source : ''}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Line({ items }: { items: [string, string][] }) {
  return (
    <p className="text-sm text-slate-700">
      {items.map(([label, value], i) => (
        <span key={label}>
          {i > 0 && <span className="mx-2 text-slate-300">|</span>}
          <span className="text-slate-500">{label}:</span> <span className="font-medium">{value}</span>
        </span>
      ))}
    </p>
  )
}

// The lender snapshot: the short template the brokerage sends to lenders,
// stored separately from (and alongside) the older research-report
// underwriting. Also offers the paid one-click build.
export function SnapshotPanel({
  dealId,
  snapshot,
  generatedAt,
  queuedAt,
  manualDocs,
  manualPrompt,
  snapshotPrompt,
  hasReportUnderwriting,
}: {
  dealId: string
  snapshot: Snapshot | null
  generatedAt: string | null
  queuedAt: string | null
  manualDocs: ManualDoc[]
  manualPrompt: string
  snapshotPrompt: string
  hasReportUnderwriting: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [editing, setEditing] = useState(false)

  async function build() {
    setConfirming(false)
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/deals/${dealId}/snapshot`, { method: 'POST' })
      const result = await readJsonResponse(res)
      if (!result.ok) throw new Error(result.message)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Snapshot failed')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!snapshot) return
    try {
      await navigator.clipboard.writeText(snapshotToText(snapshot))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy automatically.')
    }
  }

  return (
    <section id="lender-snapshot" className="scroll-mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">AI underwriting</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {generatedAt
              ? `Built ${new Date(generatedAt).toLocaleString()}`
              : 'Produces the lender-ready snapshot: financials, assets, debt, flags and a request list.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {snapshot && (
            <>
              <a
                href={`/deals/${dealId}/snapshot-print`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Open printable one-pager
              </a>
              <button
                onClick={copy}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                {copied ? 'Copied ✓' : 'Copy as text'}
              </button>
              <button
                onClick={() => setEditing((v) => !v)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                {editing ? 'Close editor' : 'Edit'}
              </button>
            </>
          )}
          <button
            onClick={() => setConfirming(true)}
            disabled={busy || confirming}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? 'Analyzing…' : snapshot ? 'Re-run underwriting (paid)' : 'Run underwriting (paid)'}
          </button>
        </div>
      </div>

      {confirming && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-slate-800">
          <p>
            This uses the paid API — usually well under $1, since there is no web research. To do it for free, use the
            &ldquo;Underwrite for free&rdquo; box below and pick <em>Lender snapshot</em>.
          </p>
          <div className="mt-2 flex gap-2">
            <button onClick={build} className="rounded-md bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-800">
              Yes, build it
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {editing && snapshot && (
        <SnapshotEditor dealId={dealId} snapshot={snapshot} onDone={() => setEditing(false)} />
      )}

      <ManualUnderwriting
        dealId={dealId}
        prompt={manualPrompt}
        snapshotPrompt={snapshotPrompt}
        docs={manualDocs}
        queuedAt={queuedAt}
        hasUnderwriting={hasReportUnderwriting}
        hasSnapshot={Boolean(snapshot)}
      />

      {error && (
        <p className="mt-3 text-sm text-red-600">
          <ErrorText message={error} />
        </p>
      )}

      {snapshot && !editing && (
        <div className="mt-5 space-y-6">
          {snapshot.entities.map((e) => (
            <div key={e.name} className="space-y-2 rounded-lg border border-slate-200 p-4">
              <h3 className="font-semibold text-slate-900">{e.name}</h3>
              <p className="text-sm text-slate-600">{e.about}</p>
              <Line items={[['Owner', e.owner], ['Industry', e.industry]]} />
              <PeriodsTable periods={e.periods} showSource />
              <Line
                items={[
                  ['AR', money(e.assets.accounts_receivable)],
                  ['Equipment', money(e.assets.equipment)],
                  ['Real estate', money(e.assets.real_estate)],
                  ['Inventory', money(e.assets.inventory)],
                ]}
              />
              <p className="text-xs text-slate-400">
                Assets as of {e.assets.as_of} — {e.assets.source}
              </p>
              <Line items={[['AP', money(e.liabilities.accounts_payable)], ['Total debt', money(e.liabilities.total_debt)]]} />
              <ul className="ml-4 list-disc text-sm text-slate-700">
                {e.liabilities.debts.map((d, i) => (
                  <li key={`${d.lender}-${i}`}>
                    {d.lender} <span className="text-xs text-slate-400">({d.kind === 'real_estate' ? 'real estate' : 'business'})</span>
                    : <span className="font-medium">{money(d.balance)}</span>
                    {d.note && <span className="text-slate-500"> — {d.note}</span>}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-400">
                Liabilities as of {e.liabilities.as_of} — {e.liabilities.source}
              </p>
            </div>
          ))}

          {snapshot.combined && (
            <div className="space-y-2 rounded-lg border border-slate-300 bg-slate-50 p-4">
              <h3 className="font-semibold text-slate-900">Combined</h3>
              <PeriodsTable periods={snapshot.combined.periods} showSource={false} />
              <Line
                items={[
                  ['AR', money(snapshot.combined.accounts_receivable)],
                  ['Equipment', money(snapshot.combined.equipment)],
                  ['Real estate', money(snapshot.combined.real_estate)],
                  ['Inventory', money(snapshot.combined.inventory)],
                ]}
              />
              <Line
                items={[
                  ['AP', money(snapshot.combined.accounts_payable)],
                  ['Real estate debt', money(snapshot.combined.real_estate_debt)],
                  ['Business debt', money(snapshot.combined.business_debt)],
                  ['Total debt', money(snapshot.combined.total_debt)],
                ]}
              />
              {snapshot.combined.note && <p className="text-xs text-slate-500">{snapshot.combined.note}</p>}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700">
            <span className="font-semibold text-slate-900">Coverage: </span>
            {snapshot.coverage.dscr === null ? '—' : `${snapshot.coverage.dscr.toFixed(2)}x`} (debt service{' '}
            {money(snapshot.coverage.annual_debt_service)}, EBITDA {money(snapshot.coverage.ebitda_used)}){' '}
            <span className="text-slate-500">— {snapshot.coverage.note}</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-500">Flags</h3>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-slate-700">
                {snapshot.flags.length > 0 ? snapshot.flags.map((f, i) => <li key={i}>{f}</li>) : <li className="list-none text-slate-400">None noted</li>}
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-500">Documents to request</h3>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-slate-700">
                {snapshot.request_list.length > 0 ? snapshot.request_list.map((r, i) => <li key={i}>{r}</li>) : <li className="list-none text-slate-400">Nothing missing</li>}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
