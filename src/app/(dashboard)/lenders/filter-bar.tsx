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

export function LenderFilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const q = searchParams.get('q') ?? ''
  const sort = searchParams.get('sort') ?? 'name_asc'

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

      {q && (
        <button
          onClick={() => updateParams({ q: '' })}
          className="text-sm text-slate-500 hover:underline"
        >
          Clear search
        </button>
      )}
    </div>
  )
}
