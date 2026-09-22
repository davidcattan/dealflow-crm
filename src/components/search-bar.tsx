'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

export type SearchSuggestion = {
  id: string
  label: string
  sublabel?: string | null
  href: string
  /** Extra text this suggestion should match on besides `label` (e.g.
   * contact/rep name) — kept separate so the dropdown can still display
   * just the label cleanly. */
  searchText?: string | null
}

export function SearchBar({
  placeholder,
  suggestions = [],
}: {
  placeholder: string
  suggestions?: SearchSuggestion[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlQuery = searchParams.get('q') ?? ''

  const [value, setValue] = useState(urlQuery)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Stay in sync if ?q= changes from elsewhere (e.g. the "show all" link,
  // or a stage/filter pill that resets search too) — adjusted during
  // render rather than in an effect, per React's guidance for state that
  // needs to reset when a prop changes.
  const [prevUrlQuery, setPrevUrlQuery] = useState(urlQuery)
  if (urlQuery !== prevUrlQuery) {
    setPrevUrlQuery(urlQuery)
    setValue(urlQuery)
  }

  function commit(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next) params.set('q', next)
    else params.delete('q')
    router.push(`${pathname}?${params.toString()}`)
  }

  // Live-narrows the actual table as you type — debounced so it doesn't
  // navigate on every single keystroke.
  useEffect(() => {
    if (value === urlQuery) return
    const timeout = setTimeout(() => commit(value), 300)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const q = value.trim().toLowerCase()
  const visibleSuggestions = q
    ? suggestions
        .filter((s) =>
          `${s.label} ${s.sublabel ?? ''} ${s.searchText ?? ''}`.toLowerCase().includes(q)
        )
        .slice(0, 8)
    : []

  return (
    <div ref={containerRef} className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setOpen(false)
          commit(value)
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-72 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          Search
        </button>
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue('')
              setOpen(false)
              commit('')
            }}
            className="text-sm text-slate-500 hover:underline"
          >
            Clear
          </button>
        )}
      </form>

      {open && visibleSuggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-72 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
          {visibleSuggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  router.push(s.href)
                }}
                className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium text-slate-800">{s.label}</span>
                {s.sublabel && (
                  <span className="ml-2 text-slate-400">{s.sublabel}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
