export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  return `$${value.toLocaleString()}`
}
