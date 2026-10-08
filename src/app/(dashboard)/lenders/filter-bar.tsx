'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

const SORT_OPTIONS = [
  { value: 'name_asc', label: 'Name (A–Z)' },
  { value: 'name_desc', label: 'Name (Z–A)' },
  { value: 'min_loan_asc', label: 'Min loan (low–high)' },
  { value: 'min_loan_desc', label: 'Min loan (high–low)' },
  { value: 'max_loan_asc', label: 'Max loan (low–high)' },
  { value: 'max_loan_desc', label: 'Max loan (high–low)' },
  { value: 'recent', label: 'Recently added' },
]

export function LenderFilterBar({
  typeOptions,
  unsizedCount,
}: {
  typeOptions: { key: string; label: string; count: number }[]
  unsizedCount: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const q = searchParams.get('q') ?? ''
  const sort = searchParams.get('sort') ?? 'name_asc'
  const type = searchParams.get('type') ?? ''
  const size = searchParams.get('size') ?? ''
  const unsized = searchParams.get('unsized') === '1'

  function updateParams(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const input = e.currentTarget.elements.namedItem(
            'q'
          ) as HTMLInputElement
          updateParams({ q: input.value })
        }}
      >
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by lender name…"
          className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
      </form>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          const input = e.currentTarget.elements.namedItem('size') as HTMLInputElement
          updateParams({ size: input.value.trim() })
        }}
        className="flex items-center gap-1"
      >
        <input
          key={size}
          type="text"
          name="size"
          defaultValue={size}
          placeholder="Deal size, e.g. 2M"
          title="Shows lenders whose loan range fits this amount (press Enter)"
          className="w-40 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
      </form>

      <select
        value={type}
        onChange={(e) => updateParams({ type: e.target.value })}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600"
        aria-label="Filter by lender type"
      >
        <option value="">All lender types</option>
        {typeOptions.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label} ({o.count})
          </option>
        ))}
      </select>

      <select
        value={sort}
        onChange={(e) => updateParams({ sort: e.target.value })}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600"
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {size && unsizedCount > 0 && (
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={unsized}
            onChange={(e) => updateParams({ unsized: e.target.checked ? '1' : '' })}
            className="rounded border-slate-300"
          />
          Include {unsizedCount} with no size listed
        </label>
      )}

      {(q || type || size) && (
        <button
          onClick={() => updateParams({ q: '', type: '', size: '', unsized: '' })}
          className="text-sm text-slate-500 hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
