'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

export function SearchBar({ placeholder }: { placeholder: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const q = searchParams.get('q') ?? ''

  function updateQuery(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set('q', value)
    else params.delete('q')
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const input = e.currentTarget.elements.namedItem('q') as HTMLInputElement
        updateQuery(input.value)
      }}
      className="flex items-center gap-2"
    >
      <input
        type="text"
        name="q"
        defaultValue={q}
        placeholder={placeholder}
        className="w-72 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
      />
      {q && (
        <button
          type="button"
          onClick={() => updateQuery('')}
          className="text-sm text-slate-500 hover:underline"
        >
          Clear
        </button>
      )}
    </form>
  )
}
