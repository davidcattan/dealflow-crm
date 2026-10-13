'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { zipSync } from 'fflate'
import { readJsonResponse } from '@/lib/fetch-json'
import { ErrorText } from '@/components/error-text'
import { CHECKLIST, SIMPLY_CAPITAL, fitsSimplyCapital, prefillUrl, type SimplyCapitalPrep } from '@/lib/simply-capital/schema'

const money = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`)
const STATUS = {
  complete: { icon: '✓', cls: 'text-emerald-600' },
  partial: { icon: '!', cls: 'text-amber-600' },
  missing: { icon: '✕', cls: 'text-red-500' },
} as const
const FOLDER: Record<string, string> = {
  tax_returns: '1 Tax returns',
  pl_bs: '2 P&L and balance sheet',
  bank_statements: '3 Bank statements',
  debt_schedule: '4 Debt schedule',
  application: '5 Application',
}

// Simply Capital (Tom): lender on $300–500K deals who wants his Jotform
// filled in with the diligence files uploaded. The CRM fills in what it knows
// and bundles the files; David types the SSN / DOB / credit score and the
// borrower signs.
export function SimplyCapitalPanel({
  dealId,
  dealName,
  askAmount,
  prep,
  at,
  docNames,
}: {
  dealId: string
  dealName: string
  askAmount: number | null
  prep: SimplyCapitalPrep | null
  at: string | null
  docNames: Record<string, string>
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amount = prep?.requested_amount ?? askAmount
  const fits = fitsSimplyCapital(amount)

  async function prepare() {
    if (!confirm(`${prep ? 'Re-prepare' : 'Prepare'} Simply Capital's application from this deal's files? It uses the paid AI — usually 5–20¢.`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/deals/${dealId}/simply-capital`, { method: 'POST' })
      const result = await readJsonResponse(res)
      if (!result.ok) throw new Error(result.message)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t prepare the application')
    } finally {
      setBusy(false)
    }
  }

  // Fetch the picked files and save them as one zip, a folder per item.
  async function downloadZip() {
    setZipping(true)
    setError(null)
    try {
      const res = await fetch(`/api/deals/${dealId}/simply-capital/files`)
      const result = await readJsonResponse<{ files: { name: string; item: string; url: string | null }[] }>(res)
      if (!result.ok) throw new Error(result.message)
      const entries: Record<string, Uint8Array> = {}
      for (const f of result.body.files) {
        if (!f.url) continue
        const r = await fetch(f.url)
        if (!r.ok) continue
        let path = `${FOLDER[f.item] ?? 'Other'}/${f.name}`
        for (let n = 2; entries[path]; n++) path = `${FOLDER[f.item] ?? 'Other'}/${n}-${f.name}`
        entries[path] = new Uint8Array(await r.arrayBuffer())
      }
      if (!Object.keys(entries).length) throw new Error('No files to download yet — prepare the application first.')
      const blob = new Blob([zipSync(entries, { level: 0 }) as BlobPart], { type: 'application/zip' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${dealName.replace(/[^\w .-]+/g, '').trim() || 'Deal'} - Simply Capital files.zip`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setZipping(false)
    }
  }

  const f = prep?.form
  const filled = f
    ? [
        ['Company', [f.company_name, f.dba && `DBA ${f.dba}`].filter(Boolean).join(' · ')],
        ['Address', [f.street, f.street2, f.city, f.state, f.zip].filter(Boolean).join(', ')],
        ['Tax ID / entity', [f.ein, f.entity_type].filter(Boolean).join(' · ')],
        ['Established', f.established],
        ['Sells', f.product_or_service],
        ['Owner', [f.owner.first_name, f.owner.last_name, f.owner.ownership_pct && `${f.owner.ownership_pct}%`, f.owner.email, f.owner.mobile].filter(Boolean).join(' · ')],
        ['Second owner', f.second_owner ? [f.second_owner.first_name, f.second_owner.last_name, f.second_owner.ownership_pct && `${f.second_owner.ownership_pct}%`].filter(Boolean).join(' · ') : 'None'],
        ['Monthly sales', money(f.monthly_sales)],
        ['Open loans / MCA', f.open_loans_or_mca],
        ['Amount / use', [money(f.funding_amount), f.use_of_funds].filter(Boolean).join(' · ')],
      ]
    : []

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
            Simply Capital application
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                fits ? 'bg-emerald-100 text-emerald-800' : amount ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-800'
              }`}
            >
              {fits ? `Fits his range · ${money(amount)}` : amount ? `Outside $300–500K · ${money(amount)}` : 'Loan amount unknown'}
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Tom’s form, pre-filled from this deal, plus the diligence files in one download.{at && ` Prepared ${new Date(at).toLocaleDateString()}.`}
          </p>
        </div>
        <button
          type="button"
          onClick={prepare}
          disabled={busy}
          className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
            prep ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50' : 'bg-slate-900 text-white hover:bg-slate-800'
          }`}
        >
          {busy ? 'Preparing…' : prep ? 'Re-prepare' : 'Prepare application'}
        </button>
      </div>
      {error && <ErrorText message={error} />}

      {prep && (
        <div className="mt-4 space-y-4 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <a
              href={prefillUrl(prep)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-slate-900 px-3 py-2.5 text-center font-medium text-white hover:bg-slate-800"
            >
              1 · Open the pre-filled form ↗
            </a>
            <button
              type="button"
              onClick={downloadZip}
              disabled={zipping}
              className="rounded-lg border border-slate-300 px-3 py-2.5 font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              {zipping ? 'Bundling files…' : '2 · Download the files (.zip)'}
            </button>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p className="font-medium">3 · Then, in the form:</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
              <li>Type each owner’s SSN, date of birth and approximate credit score (never stored in the CRM).</li>
              <li>Drag the files from the zip into the upload box.</li>
              <li>The borrower signs (Owner Signature) — not us — and tick the terms box.</li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Diligence files</h3>
            <ul className="mt-1 divide-y divide-slate-100">
              {CHECKLIST.map((c) => {
                const item = prep.files.find((x) => x.item === c.key)
                const st = STATUS[item?.status ?? 'missing']
                return (
                  <li key={c.key} className="flex gap-2 py-1.5">
                    <span className={`w-3 shrink-0 text-center font-bold ${st.cls}`}>{st.icon}</span>
                    <div className="min-w-0">
                      <p className="text-slate-800">{c.label}</p>
                      {item?.document_ids.length ? (
                        <p className="truncate text-xs text-slate-500">{item.document_ids.map((id) => docNames[id] ?? 'file').join(', ')}</p>
                      ) : null}
                      {item?.note && <p className="text-xs text-amber-700">{item.note}</p>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          <details className="group">
            <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span className="inline-block transition-transform group-open:rotate-90">›</span> What gets pre-filled
            </summary>
            <ul className="mt-1 space-y-1">
              {filled.map(([label, value]) => (
                <li key={label} className="grid grid-cols-[7.5rem_1fr] gap-2 text-xs sm:grid-cols-[9rem_1fr]">
                  <span className="text-slate-500">{label}</span>
                  <span className={value ? 'text-slate-800' : 'text-slate-400'}>{value || 'Not found — type it in'}</span>
                </li>
              ))}
            </ul>
          </details>

          {prep.check.length > 0 && (
            <div className="text-xs text-slate-600">
              <p className="font-medium text-slate-700">Double-check before submitting:</p>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                {prep.check.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {!prep && (
        <p className="mt-3 text-sm text-slate-500">
          {fits
            ? 'This deal is in his $300–500K range. Prepare the application to get the pre-filled form and the file bundle.'
            : `Simply Capital lends ${money(SIMPLY_CAPITAL.min)}–${money(SIMPLY_CAPITAL.max)}. You can still prepare it if you want to send it to him.`}
        </p>
      )}
    </section>
  )
}
