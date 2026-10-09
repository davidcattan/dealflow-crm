'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { Snapshot, SnapshotEntity } from '@/lib/snapshot/schema'
import { readJsonResponse } from '@/lib/fetch-json'
import { ErrorText } from '@/components/error-text'

type Period = SnapshotEntity['periods'][number]
type Debt = SnapshotEntity['liabilities']['debts'][number]

const inputCls =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 focus:border-slate-500 focus:outline-none'
const labelCls = 'block text-[11px] font-medium text-slate-500'

function emptyPeriod(): Period {
  return { label: '', revenue: null, ebitda: null, net_income: null, source: '' }
}
function emptyDebt(): Debt {
  return { lender: '', balance: null, kind: 'business', note: null }
}
function emptyEntity(): SnapshotEntity {
  return {
    name: '',
    about: '',
    owner: '',
    industry: '',
    periods: [emptyPeriod()],
    assets: { accounts_receivable: null, equipment: null, real_estate: null, inventory: null, as_of: '', source: '' },
    liabilities: { accounts_payable: null, debts: [], total_debt: null, as_of: '', source: '' },
  }
}
function emptyCombined(): Snapshot['combined'] {
  return {
    periods: [emptyPeriod()],
    accounts_receivable: null,
    equipment: null,
    real_estate: null,
    inventory: null,
    accounts_payable: null,
    real_estate_debt: null,
    business_debt: null,
    total_debt: null,
    note: null,
  }
}

// Text input for a nullable number. Keeps its own text so partial input
// ("-", "1234.") isn't fought mid-keystroke; strips $ and commas on parse
// so a pasted "$905,000" still works. Remounted (via `key`) whenever the
// editor is opened fresh, so it never needs to resync from outside edits.
function MoneyInput({
  value,
  onChange,
  placeholder,
}: {
  value: number | null
  onChange: (v: number | null) => void
  placeholder?: string
}) {
  const [text, setText] = useState(value === null ? '' : String(value))
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder ?? '—'}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        const cleaned = raw.replace(/[^0-9.-]/g, '')
        if (cleaned === '' || cleaned === '-') {
          onChange(null)
        } else {
          const n = Number(cleaned)
          if (!Number.isNaN(n)) onChange(n)
        }
      }}
      className={inputCls}
    />
  )
}

function RemoveButton({ onClick, label = 'Remove' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="text-xs text-red-500 hover:text-red-700">
      {label}
    </button>
  )
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700"
    >
      + {label}
    </button>
  )
}

function PeriodsEditor({ periods, onChange }: { periods: Period[]; onChange: (p: Period[]) => void }) {
  const update = (i: number, patch: Partial<Period>) =>
    onChange(periods.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  return (
    <div className="space-y-2">
      {periods.map((p, i) => (
        <div key={i} className="grid grid-cols-12 items-start gap-2 rounded-md border border-slate-200 p-2">
          <div className="col-span-3">
            <label className={labelCls}>Period</label>
            <input className={inputCls} value={p.label} onChange={(e) => update(i, { label: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Revenue</label>
            <MoneyInput value={p.revenue} onChange={(v) => update(i, { revenue: v })} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>EBITDA</label>
            <MoneyInput value={p.ebitda} onChange={(v) => update(i, { ebitda: v })} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Net income</label>
            <MoneyInput value={p.net_income} onChange={(v) => update(i, { net_income: v })} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Source</label>
            <input className={inputCls} value={p.source} onChange={(e) => update(i, { source: e.target.value })} />
          </div>
          <div className="col-span-1 pt-5">
            <RemoveButton onClick={() => onChange(periods.filter((_, idx) => idx !== i))} />
          </div>
        </div>
      ))}
      <AddButton onClick={() => onChange([...periods, emptyPeriod()])} label="period" />
    </div>
  )
}

function DebtsEditor({ debts, onChange }: { debts: Debt[]; onChange: (d: Debt[]) => void }) {
  const update = (i: number, patch: Partial<Debt>) =>
    onChange(debts.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  return (
    <div className="space-y-2">
      {debts.map((d, i) => (
        <div key={i} className="grid grid-cols-12 items-start gap-2 rounded-md border border-slate-200 p-2">
          <div className="col-span-4">
            <label className={labelCls}>Lender</label>
            <input className={inputCls} value={d.lender} onChange={(e) => update(i, { lender: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Balance</label>
            <MoneyInput value={d.balance} onChange={(v) => update(i, { balance: v })} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Kind</label>
            <select
              className={inputCls}
              value={d.kind}
              onChange={(e) => update(i, { kind: e.target.value as Debt['kind'] })}
            >
              <option value="business">Business</option>
              <option value="real_estate">Real estate</option>
            </select>
          </div>
          <div className="col-span-3">
            <label className={labelCls}>Note</label>
            <input
              className={inputCls}
              value={d.note ?? ''}
              onChange={(e) => update(i, { note: e.target.value || null })}
            />
          </div>
          <div className="col-span-1 pt-5">
            <RemoveButton onClick={() => onChange(debts.filter((_, idx) => idx !== i))} />
          </div>
        </div>
      ))}
      <AddButton onClick={() => onChange([...debts, emptyDebt()])} label="debt" />
    </div>
  )
}

function TextListEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  return (
    <div className="space-y-1.5">
      {items.map((line, i) => (
        <div key={i} className="flex items-start gap-2">
          <textarea
            value={line}
            rows={1}
            onChange={(e) => onChange(items.map((l, idx) => (idx === i ? e.target.value : l)))}
            className={`${inputCls} resize-y`}
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            className="mt-1 shrink-0 text-xs text-red-500 hover:text-red-700"
          >
            Remove
          </button>
        </div>
      ))}
      <AddButton onClick={() => onChange([...items, ''])} label="line" />
    </div>
  )
}

function EntityEditor({ entity, onChange, onRemove }: { entity: SnapshotEntity; onChange: (e: SnapshotEntity) => void; onRemove: () => void }) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-300 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="grid flex-1 grid-cols-3 gap-2">
          <div>
            <label className={labelCls}>Entity name</label>
            <input className={inputCls} value={entity.name} onChange={(e) => onChange({ ...entity, name: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Owner</label>
            <input className={inputCls} value={entity.owner} onChange={(e) => onChange({ ...entity, owner: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Industry</label>
            <input className={inputCls} value={entity.industry} onChange={(e) => onChange({ ...entity, industry: e.target.value })} />
          </div>
        </div>
        <RemoveButton onClick={onRemove} label="Remove entity" />
      </div>
      <div>
        <label className={labelCls}>About</label>
        <textarea
          className={`${inputCls} resize-y`}
          rows={2}
          value={entity.about}
          onChange={(e) => onChange({ ...entity, about: e.target.value })}
        />
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase text-slate-500">Periods</h4>
        <div className="mt-1">
          <PeriodsEditor periods={entity.periods} onChange={(periods) => onChange({ ...entity, periods })} />
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase text-slate-500">Assets</h4>
        <div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-6">
          <div>
            <label className={labelCls}>AR</label>
            <MoneyInput value={entity.assets.accounts_receivable} onChange={(v) => onChange({ ...entity, assets: { ...entity.assets, accounts_receivable: v } })} />
          </div>
          <div>
            <label className={labelCls}>Equipment</label>
            <MoneyInput value={entity.assets.equipment} onChange={(v) => onChange({ ...entity, assets: { ...entity.assets, equipment: v } })} />
          </div>
          <div>
            <label className={labelCls}>Real estate</label>
            <MoneyInput value={entity.assets.real_estate} onChange={(v) => onChange({ ...entity, assets: { ...entity.assets, real_estate: v } })} />
          </div>
          <div>
            <label className={labelCls}>Inventory</label>
            <MoneyInput value={entity.assets.inventory} onChange={(v) => onChange({ ...entity, assets: { ...entity.assets, inventory: v } })} />
          </div>
          <div>
            <label className={labelCls}>As of</label>
            <input className={inputCls} value={entity.assets.as_of} onChange={(e) => onChange({ ...entity, assets: { ...entity.assets, as_of: e.target.value } })} />
          </div>
          <div>
            <label className={labelCls}>Source</label>
            <input className={inputCls} value={entity.assets.source} onChange={(e) => onChange({ ...entity, assets: { ...entity.assets, source: e.target.value } })} />
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase text-slate-500">Liabilities</h4>
        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <label className={labelCls}>AP</label>
            <MoneyInput value={entity.liabilities.accounts_payable} onChange={(v) => onChange({ ...entity, liabilities: { ...entity.liabilities, accounts_payable: v } })} />
          </div>
          <div>
            <label className={labelCls}>Total debt</label>
            <MoneyInput value={entity.liabilities.total_debt} onChange={(v) => onChange({ ...entity, liabilities: { ...entity.liabilities, total_debt: v } })} />
          </div>
          <div>
            <label className={labelCls}>As of</label>
            <input className={inputCls} value={entity.liabilities.as_of} onChange={(e) => onChange({ ...entity, liabilities: { ...entity.liabilities, as_of: e.target.value } })} />
          </div>
          <div>
            <label className={labelCls}>Source</label>
            <input className={inputCls} value={entity.liabilities.source} onChange={(e) => onChange({ ...entity, liabilities: { ...entity.liabilities, source: e.target.value } })} />
          </div>
        </div>
        <div className="mt-2">
          <DebtsEditor debts={entity.liabilities.debts} onChange={(debts) => onChange({ ...entity, liabilities: { ...entity.liabilities, debts } })} />
        </div>
      </div>
    </div>
  )
}

// Full edit form for the lender snapshot. Saves through save-snapshot,
// which validates with the same zod schema and makes no AI call — editing
// is always free.
export function SnapshotEditor({
  dealId,
  snapshot,
  onDone,
}: {
  dealId: string
  snapshot: Snapshot
  onDone: () => void
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<Snapshot>(snapshot)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/deals/${dealId}/save-snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const result = await readJsonResponse(res)
      if (!result.ok) throw new Error(result.message)
      router.refresh()
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-enter-save className="mt-4 space-y-4 rounded-lg border border-slate-300 bg-slate-50 p-4">
      <p className="text-xs text-slate-500">
        Edit any figure or line directly. Saving is free — this only rewrites the stored snapshot, no AI call.
      </p>

      {draft.entities.map((entity, i) => (
        <EntityEditor
          key={i}
          entity={entity}
          onChange={(e) => setDraft({ ...draft, entities: draft.entities.map((x, idx) => (idx === i ? e : x)) })}
          onRemove={() => setDraft({ ...draft, entities: draft.entities.filter((_, idx) => idx !== i) })}
        />
      ))}
      <AddButton
        onClick={() => setDraft({ ...draft, entities: [...draft.entities, emptyEntity()] })}
        label="entity"
      />

      <div className="rounded-lg border border-slate-300 bg-white p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase text-slate-500">Combined</h4>
          {draft.combined ? (
            <RemoveButton label="Remove combined block" onClick={() => setDraft({ ...draft, combined: null })} />
          ) : (
            <AddButton label="combined block" onClick={() => setDraft({ ...draft, combined: emptyCombined() })} />
          )}
        </div>
        {draft.combined && (
          <div className="mt-2 space-y-2">
            <PeriodsEditor
              periods={draft.combined.periods}
              onChange={(periods) => setDraft({ ...draft, combined: { ...draft.combined!, periods } })}
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ['accounts_receivable', 'AR'],
                  ['equipment', 'Equipment'],
                  ['real_estate', 'Real estate'],
                  ['inventory', 'Inventory'],
                  ['accounts_payable', 'AP'],
                  ['real_estate_debt', 'Real estate debt'],
                  ['business_debt', 'Business debt'],
                  ['total_debt', 'Total debt'],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <label className={labelCls}>{label}</label>
                  <MoneyInput
                    value={draft.combined![key]}
                    onChange={(v) => setDraft({ ...draft, combined: { ...draft.combined!, [key]: v } })}
                  />
                </div>
              ))}
            </div>
            <div>
              <label className={labelCls}>Note</label>
              <input
                className={inputCls}
                value={draft.combined.note ?? ''}
                onChange={(e) => setDraft({ ...draft, combined: { ...draft.combined!, note: e.target.value || null } })}
              />
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-300 bg-white p-4">
        <h4 className="text-xs font-semibold uppercase text-slate-500">Coverage</h4>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <label className={labelCls}>Annual debt service</label>
            <MoneyInput
              value={draft.coverage.annual_debt_service}
              onChange={(v) => setDraft({ ...draft, coverage: { ...draft.coverage, annual_debt_service: v } })}
            />
          </div>
          <div>
            <label className={labelCls}>EBITDA used</label>
            <MoneyInput
              value={draft.coverage.ebitda_used}
              onChange={(v) => setDraft({ ...draft, coverage: { ...draft.coverage, ebitda_used: v } })}
            />
          </div>
          <div>
            <label className={labelCls}>DSCR</label>
            <MoneyInput
              value={draft.coverage.dscr}
              onChange={(v) => setDraft({ ...draft, coverage: { ...draft.coverage, dscr: v } })}
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Note</label>
            <input
              className={inputCls}
              value={draft.coverage.note}
              onChange={(e) => setDraft({ ...draft, coverage: { ...draft.coverage, note: e.target.value } })}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-300 bg-white p-4">
          <h4 className="text-xs font-semibold uppercase text-slate-500">Flags</h4>
          <div className="mt-2">
            <TextListEditor items={draft.flags} onChange={(flags) => setDraft({ ...draft, flags })} />
          </div>
        </div>
        <div className="rounded-lg border border-slate-300 bg-white p-4">
          <h4 className="text-xs font-semibold uppercase text-slate-500">Documents to request</h4>
          <div className="mt-2">
            <TextListEditor items={draft.request_list} onChange={(request_list) => setDraft({ ...draft, request_list })} />
          </div>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600">
          <ErrorText message={error} />
        </p>
      )}

      <div className="flex gap-2">
        <button
          data-save
          onClick={save}
          disabled={saving}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          onClick={onDone}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
