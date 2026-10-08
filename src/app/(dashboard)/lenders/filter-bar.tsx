'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { SearchBar, type SearchSuggestion } from '@/components/search-bar'

export function LenderFilterBar({
  typeOptions,
  suggestions,
}: {
  typeOptions: { key: string; label: string; count: number }[]
  suggestions: SearchSuggestion[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const q = searchParams.get('q') ?? ''
  const type = searchParams.get('type') ?? ''

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
      <SearchBar placeholder="Search lenders…" suggestions={suggestions} />

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

      {(q || type) && (
        <button
          onClick={() => updateParams({ q: '', type: '' })}
          className="text-sm text-slate-500 hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
