// Displays a timestamp's calendar date without the local-timezone shift that
// `new Date(iso).toLocaleDateString()` introduces — needed for any date that
// may have been stored as a plain "YYYY-MM-DD" (e.g. backdated on import),
// since the browser would otherwise render midnight UTC as the previous day
// in timezones behind UTC.
export function formatDateOnly(isoString: string) {
  const datePart = isoString.slice(0, 10)
  return new Date(`${datePart}T00:00:00`).toLocaleDateString()
}

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  return `$${value.toLocaleString()}`
}

// Compact form for round lender-mandate figures: $5,000,000 -> $5M,
// $250,000 -> $250K. zeroLabel lets callers describe a literal 0 (e.g.
// "No minimum" for a lender with no floor) rather than showing "$0".
export function formatCompactCurrency(
  value: number | null | undefined,
  opts?: { zeroLabel?: string }
) {
  if (value === null || value === undefined) return '—'
  if (value === 0) return opts?.zeroLabel ?? '$0'

  const trim = (n: number) => Number(n.toFixed(1)).toString()
  const abs = Math.abs(value)

  if (abs >= 1_000_000) return `$${trim(value / 1_000_000)}M`
  if (abs >= 1_000) return `$${trim(value / 1_000)}K`
  return `$${value.toLocaleString()}`
}
