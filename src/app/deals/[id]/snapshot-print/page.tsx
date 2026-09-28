import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import type { Snapshot } from '@/lib/snapshot/schema'
import { PrintControls } from './print-controls'

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : n < 0
      ? `($${Math.abs(Math.round(n)).toLocaleString('en-US')})`
      : `$${Math.round(n).toLocaleString('en-US')}`

function PeriodsTable({ periods }: { periods: Snapshot['entities'][number]['periods'] }) {
  return (
    <table className="w-full border-collapse text-left text-[11px]">
      <thead>
        <tr className="border-b border-slate-300">
          <th className="py-1 pr-2 font-semibold text-slate-500">Period</th>
          <th className="py-1 pr-2 font-semibold text-slate-500">Revenue</th>
          <th className="py-1 pr-2 font-semibold text-slate-500">EBITDA</th>
          <th className="py-1 font-semibold text-slate-500">Net income</th>
        </tr>
      </thead>
      <tbody>
        {periods.map((p) => (
          <tr key={p.label} className="border-b border-slate-100">
            <td className="py-1 pr-2 font-medium text-slate-800">{p.label}</td>
            <td className="py-1 pr-2 text-slate-800">{money(p.revenue)}</td>
            <td className="py-1 pr-2 text-slate-800">{money(p.ebitda)}</td>
            <td className="py-1 text-slate-800">{money(p.net_income)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function StatLine({ items }: { items: [string, string][] }) {
  return (
    <p className="text-[11px] text-slate-700">
      {items.map(([label, value], i) => (
        <span key={label}>
          {i > 0 && <span className="mx-1.5 text-slate-300">·</span>}
          {label} <span className="font-semibold text-slate-900">{value}</span>
        </span>
      ))}
    </p>
  )
}

export default async function SnapshotPrintPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireUser()
  const { id } = await params
  const supabase = await createClient()
  const { data: deal } = await supabase
    .from('deals')
    .select('id, company_name, snapshot, snapshot_generated_at')
    .eq('id', id)
    .single()

  if (!deal) notFound()
  const snapshot = deal.snapshot as Snapshot | null
  if (!snapshot) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="text-sm text-slate-600">
          No lender snapshot has been built for this deal yet.
        </p>
        <Link href={`/deals/${id}`} className="mt-3 inline-block text-sm text-slate-900 underline">
          Back to the deal
        </Link>
      </div>
    )
  }

  const generatedAt = deal.snapshot_generated_at
    ? new Date(deal.snapshot_generated_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  return (
    <>
      {/* Print CSS: hide screen-only chrome, use the full page width, and
          keep each block from splitting awkwardly across pages. */}
      <style>{`
        @media print {
          @page { margin: 0.5in; }
          .print-hide { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        .avoid-break { break-inside: avoid; }
      `}</style>

      <PrintControls />

      <div className="print-hide border-b border-slate-100 bg-slate-50 px-6 py-2">
        <Link href={`/deals/${id}`} className="text-xs text-slate-500 hover:text-slate-800">
          ← Back to {deal.company_name}
        </Link>
      </div>

      <main className="mx-auto max-w-3xl px-8 py-8 text-slate-900">
        <div className="mb-6 flex items-baseline justify-between border-b-2 border-slate-900 pb-3">
          <h1 className="text-xl font-bold">{deal.company_name}</h1>
          <p className="text-xs text-slate-500">
            Lender snapshot{generatedAt ? ` — ${generatedAt}` : ''}
          </p>
        </div>

        <div className="space-y-5">
          {snapshot.entities.map((e) => (
            <section key={e.name} className="avoid-break space-y-1.5 rounded-md border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-900">{e.name}</h2>
              <p className="text-[11px] text-slate-600">{e.about}</p>
              <StatLine items={[['Owner', e.owner], ['Industry', e.industry]]} />
              <div className="pt-1">
                <PeriodsTable periods={e.periods} />
              </div>
              <div className="grid grid-cols-2 gap-x-6 pt-1">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Assets — as of {e.assets.as_of}
                  </p>
                  <StatLine
                    items={[
                      ['AR', money(e.assets.accounts_receivable)],
                      ['Equipment', money(e.assets.equipment)],
                      ['Real estate', money(e.assets.real_estate)],
                      ['Inventory', money(e.assets.inventory)],
                    ]}
                  />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Liabilities — as of {e.liabilities.as_of}
                  </p>
                  <StatLine
                    items={[
                      ['AP', money(e.liabilities.accounts_payable)],
                      ['Total debt', money(e.liabilities.total_debt)],
                    ]}
                  />
                </div>
              </div>
              {e.liabilities.debts.length > 0 && (
                <ul className="ml-4 list-disc text-[11px] text-slate-700">
                  {e.liabilities.debts.map((d, i) => (
                    <li key={`${d.lender}-${i}`}>
                      {d.lender}{' '}
                      <span className="text-slate-400">({d.kind === 'real_estate' ? 'RE' : 'business'})</span>:{' '}
                      <span className="font-medium">{money(d.balance)}</span>
                      {d.note && <span className="text-slate-500"> — {d.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          {snapshot.combined && (
            <section className="avoid-break space-y-1.5 rounded-md border-2 border-slate-900 bg-slate-50 p-4">
              <h2 className="text-sm font-bold text-slate-900">Combined</h2>
              <PeriodsTable periods={snapshot.combined.periods} />
              <StatLine
                items={[
                  ['AR', money(snapshot.combined.accounts_receivable)],
                  ['Equipment', money(snapshot.combined.equipment)],
                  ['Real estate', money(snapshot.combined.real_estate)],
                  ['Inventory', money(snapshot.combined.inventory)],
                ]}
              />
              <StatLine
                items={[
                  ['AP', money(snapshot.combined.accounts_payable)],
                  ['RE debt', money(snapshot.combined.real_estate_debt)],
                  ['Business debt', money(snapshot.combined.business_debt)],
                  ['Total debt', money(snapshot.combined.total_debt)],
                ]}
              />
              {snapshot.combined.note && <p className="text-[10px] text-slate-500">{snapshot.combined.note}</p>}
            </section>
          )}

          <section className="avoid-break rounded-md border border-slate-200 p-4 text-[11px]">
            <span className="font-bold text-slate-900">Coverage: </span>
            {snapshot.coverage.dscr === null ? '—' : `${snapshot.coverage.dscr.toFixed(2)}x`}{' '}
            <span className="text-slate-600">
              (debt service {money(snapshot.coverage.annual_debt_service)}, EBITDA{' '}
              {money(snapshot.coverage.ebitda_used)}) — {snapshot.coverage.note}
            </span>
          </section>

          {(snapshot.flags.length > 0 || snapshot.request_list.length > 0) && (
            <div className="grid grid-cols-2 gap-6">
              {snapshot.flags.length > 0 && (
                <section className="avoid-break">
                  <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Flags</h3>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-slate-700">
                    {snapshot.flags.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </section>
              )}
              {snapshot.request_list.length > 0 && (
                <section className="avoid-break">
                  <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Documents to request
                  </h3>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-slate-700">
                    {snapshot.request_list.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>

        <p className="print-hide mt-8 text-center text-[10px] text-slate-400">
          AI-generated from the deal&apos;s diligence documents — verify figures before sending to a lender.
        </p>
      </main>
    </>
  )
}
