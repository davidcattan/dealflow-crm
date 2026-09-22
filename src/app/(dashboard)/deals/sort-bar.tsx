'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

const SORT_OPTIONS = [
  { value: 'date_desc', label: 'Date added (newest)' },
  { value: 'date_asc', label: 'Date added (oldest)' },
  { value: 'activity_desc', label: 'Activity (high–low)' },
  { value: 'activity_asc', label: 'Activity (low–high)' },
  { value: 'name_asc', label: 'Company (A–Z)' },
  { value: 'name_desc', label: 'Company (Z–A)' },
  { value: 'status', label: 'Status' },
  { value: 'match_desc', label: 'Best lender match (high–low)' },
]

export function DealSortBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const sort = searchParams.get('sort') ?? 'date_desc'

  function updateSort(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set('sort', value)
    else params.delete('sort')
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <select
      value={sort}
      onChange={(e) => updateSort(e.target.value)}
      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600"
    >
      {SORT_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
