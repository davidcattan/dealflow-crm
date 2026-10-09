'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { Snapshot } from '@/lib/snapshot/schema'
import { snapshotToText } from '@/lib/snapshot/text'
import { readJsonResponse } from '@/lib/fetch-json'
import { ErrorText } from '@/components/error-text'
import { SnapshotEditor } from './snapshot-editor'
import { ManualUnderwriting, type ManualDoc } from './manual-underwriting'
import { formatCompactCurrency } from '@/lib/format'

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
    <>
    {/* Phones: one small block per period instead of a wide table. */}
    <div className="space-y-2 sm:hidden">
      {periods.map((p) => (
        <div key={p.label} className="rounded-md bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold text-slate-700">{p.label}</p>
          <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
            <span>
              <span className="block text-slate-400">Revenue</span>
              <span className="font-medium text-slate-800">{short(p.revenue)}</span>
            </span>
            <span>
              <span className="block text-slate-400">EBITDA</span>
              <span className="font-medium text-slate-800">{short(p.ebitda)}</span>
            </span>
            <span>
              <span className="block text-slate-400">Net income</span>
              <span className="font-medium text-slate-800">{short(p.net_income)}</span>
            </span>
          </div>
        </div>
      ))}
    </div>
    <table className="hidden w-full text-left text-sm sm:table">
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
    </>
  )
}

// "AR: $X | Equipment: $Y" on computers; a two-column list on phones.
function Line({ items, compact }: { items: [string, string][]; compact?: [string, string][] }) {
  return (
    <>
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:hidden">
      {(compact ?? items).map(([label, value]) => (
        <span key={label} className="min-w-0">
          <span className="block text-xs text-slate-400">{label}</span>
          <span className="font-medium text-slate-800 [overflow-wrap:anywhere]">{value}</span>
        </span>
      ))}
    </div>
    <p className="hidden text-sm text-slate-700 sm:block">
      {items.map(([label, value], i) => (
        <span key={label}>
          {i > 0 && <span className="mx-2 text-slate-300">|</span>}
          <span className="text-slate-500">{label}:</span> <span className="font-medium">{value}</span>
        </span>
      ))}
    </p>
    </>
  )
}

// "$32.1M", or "($38.3M)" for a loss.
const short = (n: number | null | undefined) =>
  n !== null && n !== undefined && n < 0 ? `(${formatCompactCurrency(-n)})` : formatCompactCurrency(n)

// Phones: a section that starts closed, with a one-line summary.
function PhoneFold({ title, glance, children, className = '' }: { title: string; glance?: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={className}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2 text-left sm:hidden">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-slate-900">{title}</span>
          {glance && !open && <span className="mt-0.5 block text-xs text-slate-500">{glance}</span>}
        </span>
        <span className={`mt-0.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      <div className={`space-y-2 ${open ? 'max-sm:mt-2' : 'max-sm:hidden'}`}>{children}</div>
    </div>
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
  // Phones: Edit / Re-run / the free-underwriting box stay tucked away.
  const [tools, setTools] = useState(false)

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
                <span className="sm:hidden">One-pager</span>
                <span className="hidden sm:inline">Open printable one-pager</span>
              </a>
              <button
                onClick={copy}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                {copied ? 'Copied ✓' : 'Copy as text'}
              </button>
              <button
                onClick={() => setEditing((v) => !v)}
                className={`rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 ${tools ? '' : 'max-sm:hidden'}`}
              >
                {editing ? 'Close editor' : 'Edit'}
              </button>
            </>
          )}
          {snapshot && (
            <button type="button" onClick={() => setTools((v) => !v)} className="px-1 text-sm text-slate-500 underline sm:hidden">
              {tools ? 'Fewer options' : 'More'}
            </button>
          )}
          <button
            onClick={() => setConfirming(true)}
            disabled={busy || confirming}
            className={`rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 ${snapshot && !tools ? 'max-sm:hidden' : ''}`}
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

      <div className={snapshot && !tools ? 'max-sm:hidden' : ''}>
      <ManualUnderwriting
        dealId={dealId}
        prompt={manualPrompt}
        snapshotPrompt={snapshotPrompt}
        docs={manualDocs}
        queuedAt={queuedAt}
        hasUnderwriting={hasReportUnderwriting}
        hasSnapshot={Boolean(snapshot)}
      />
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600">
          <ErrorText message={error} />
        </p>
      )}

      {snapshot && !editing && (
        <div className="mt-5 space-y-6 max-sm:mt-4 max-sm:space-y-3">
          {snapshot.entities.map((e) => (
            <div key={e.name} className="rounded-lg border border-slate-200 p-4 max-sm:p-3.5">
              <h3 className="hidden font-semibold text-slate-900 sm:block">{e.name}</h3>
              <PhoneFold
                title={e.name}
                glance={[
                  e.periods[0] && `${e.periods[0].label}: rev ${short(e.periods[0].revenue)}, EBITDA ${short(e.periods[0].ebitda)}`,
                  `debt ${short(e.liabilities.total_debt)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                className="sm:mt-2"
              >
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
                compact={[
                  ['AR', short(e.assets.accounts_receivable)],
                  ['Equipment', short(e.assets.equipment)],
                  ['Real estate', short(e.assets.real_estate)],
                  ['Inventory', short(e.assets.inventory)],
                ]}
              />
              <p className="text-xs text-slate-400">
                Assets as of {e.assets.as_of} — {e.assets.source}
              </p>
              <Line
                items={[['AP', money(e.liabilities.accounts_payable)], ['Total debt', money(e.liabilities.total_debt)]]}
                compact={[['AP', short(e.liabilities.accounts_payable)], ['Total debt', short(e.liabilities.total_debt)]]}
              />
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
              </PhoneFold>
            </div>
          ))}

          {snapshot.combined && (
            <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 max-sm:p-3.5">
              <h3 className="hidden font-semibold text-slate-900 sm:block">Combined</h3>
              <PhoneFold
                title="Combined"
                glance={`total debt ${short(snapshot.combined.total_debt)}`}
                className="sm:mt-2"
              >
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
              </PhoneFold>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700 max-sm:p-3.5">
            <div className="hidden sm:block">
              <span className="font-semibold text-slate-900">Coverage: </span>
              {snapshot.coverage.dscr === null ? '—' : `${snapshot.coverage.dscr.toFixed(2)}x`} (debt service{' '}
              {money(snapshot.coverage.annual_debt_service)}, EBITDA {money(snapshot.coverage.ebitda_used)}){' '}
              <span className="text-slate-500">— {snapshot.coverage.note}</span>
            </div>
            <PhoneFold
              title={`Coverage (DSCR): ${snapshot.coverage.dscr === null ? '—' : `${snapshot.coverage.dscr.toFixed(2)}x`}`}
              glance={`Debt service ${short(snapshot.coverage.annual_debt_service)} · EBITDA ${short(snapshot.coverage.ebitda_used)}`}
              className="sm:hidden"
            >
              <p className="text-slate-600">{snapshot.coverage.note}</p>
            </PhoneFold>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="max-sm:rounded-lg max-sm:border max-sm:border-slate-200 max-sm:p-3.5">
              <h3 className="hidden text-xs font-semibold uppercase text-slate-500 sm:block">Flags</h3>
              <PhoneFold title={`Flags (${snapshot.flags.length})`} glance={snapshot.flags[0]}>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-slate-700">
                {snapshot.flags.length > 0 ? snapshot.flags.map((f, i) => <li key={i}>{f}</li>) : <li className="list-none text-slate-400">None noted</li>}
              </ul>
              </PhoneFold>
            </div>
            <div className="max-sm:rounded-lg max-sm:border max-sm:border-slate-200 max-sm:p-3.5">
              <h3 className="hidden text-xs font-semibold uppercase text-slate-500 sm:block">Documents to request</h3>
              <PhoneFold title={`Documents to request (${snapshot.request_list.length})`} glance={snapshot.request_list[0]}>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-slate-700">
                {snapshot.request_list.length > 0 ? snapshot.request_list.map((r, i) => <li key={i}>{r}</li>) : <li className="list-none text-slate-400">Nothing missing</li>}
              </ul>
              </PhoneFold>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
