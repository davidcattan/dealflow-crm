'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

const SORT_OPTIONS = [
  { value: '', label: 'Default order' },
  { value: 'name_asc', label: 'Company (A–Z)' },
  { value: 'name_desc', label: 'Company (Z–A)' },
  { value: 'updated_desc', label: 'Recently updated' },
  { value: 'updated_asc', label: 'Least recently updated' },
  { value: 'activity_desc', label: 'Activity (high–low)' },
  { value: 'activity_asc', label: 'Activity (low–high)' },
  { value: 'match_desc', label: 'Best lender match (high–low)' },
]

export function PipelineFilterBar({
  industries,
  loanTypes,
}: {
  industries: readonly string[]
  loanTypes: readonly string[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const industry = searchParams.get('industry') ?? ''
  const loanType = searchParams.get('loanType') ?? ''
  const sort = searchParams.get('sort') ?? ''

  function updateParams(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  const hasFilters = industry || loanType

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={industry}
        onChange={(e) => updateParams({ industry: e.target.value })}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600"
      >
        <option value="">All industries</option>
        {industries.map((i) => (
          <option key={i} value={i}>
            {i}
          </option>
        ))}
      </select>

      <select
        value={loanType}
        onChange={(e) => updateParams({ loanType: e.target.value })}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600"
      >
        <option value="">All loan types</option>
        {loanTypes.map((t) => (
          <option key={t} value={t}>
            {t}
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

      {hasFilters && (
        <button
          onClick={() => updateParams({ industry: '', loanType: '' })}
          className="text-sm text-slate-500 hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
