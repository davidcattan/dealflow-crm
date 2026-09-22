// Simple case-insensitive "does any of these fields contain the query"
// check, shared by the Deals and Pipeline search bars. Pass in whatever
// text a row should be searchable by — including fields not shown as
// columns (e.g. rep name, notes) and pre-formatted date strings so a
// partial date like "9/22" or "2026" matches too.
export function matchesSearch(query: string, fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return fields.some((f) => f && f.toLowerCase().includes(q))
}
