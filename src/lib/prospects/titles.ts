// Who to email at a company about its credit facility: the CFO, the CEO,
// the owner and the president (David's call, Oct 2026). CFO first.

const NOT_THEM = /\b(assistant|deputy|former|ex-|regional|division|vp|vice|office of|product owner|business owner)\b/

// 1 = CFO; null otherwise.
export function financeRank(title: string | null | undefined): number | null {
  const t = (title ?? '').toLowerCase()
  if (!t || NOT_THEM.test(t)) return null
  return /\bcfo\b|chief financial officer/.test(t) ? 1 : null
}

// 1 = CEO, 2 = Owner / Co-owner, 3 = President; null otherwise.
export function bossRank(title: string | null | undefined): number | null {
  const t = (title ?? '').toLowerCase()
  if (!t || NOT_THEM.test(t)) return null
  if (/\bceo\b|chief executive officer/.test(t)) return 1
  if (/\b(co-?)?owner\b/.test(t)) return 2
  if (/\bpresident\b/.test(t)) return 3
  return null
}

// Sort best first: CFO, then CEO, then owner, then president.
export function titleScore(title: string | null | undefined) {
  const f = financeRank(title)
  if (f !== null) return f
  const b = bossRank(title)
  return b !== null ? 10 + b : 100
}

// Titles to ask Apollo for.
export const PROSPECT_TITLES = ['cfo', 'chief financial officer', 'ceo', 'chief executive officer', 'owner', 'co-owner', 'president']
