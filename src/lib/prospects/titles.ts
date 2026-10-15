// Who to email at a company about its credit facility: the top finance
// person first, then the CEO / owner. Same rules as the Apollo lists.

// 1 = CFO, 2 = VP Finance / Treasurer, 3 = Controller; null = not finance.
export function financeRank(title: string | null | undefined): number | null {
  const t = (title ?? '').toLowerCase()
  if (!t || /\b(assistant|warehouse|inventory|project|production|plant|regional|division|former)\b/.test(t)) return null
  if (/\bcfo\b|chief financial/.test(t)) return 1
  if (/treasurer|(vp|vice president|svp|evp|head|director)\W.*financ|financ\w*\W.*(vp|vice president)/.test(t)) return 2
  if (/\bcontroller\b/.test(t)) return 3
  return null
}

// 1 = CEO, 2 = President / Owner / Founder; null otherwise.
export function bossRank(title: string | null | undefined): number | null {
  const t = (title ?? '').toLowerCase()
  if (!t || /\b(vice|vp|assistant|regional|division|product|office of|lead|manager|former)\b/.test(t)) return null
  if (/\bceo\b|chief executive/.test(t)) return 1
  if (/^(president|owner|founder|co-founder)\b|\b(president|owner|founder)$|president (&|and)/.test(t)) return 2
  return null
}

export function isRelevant(title: string | null | undefined) {
  return financeRank(title) !== null || bossRank(title) !== null
}

// Sort best first: finance people, then the boss, then everyone else.
export function titleScore(title: string | null | undefined) {
  const f = financeRank(title)
  if (f !== null) return f
  const b = bossRank(title)
  if (b !== null) return 10 + b
  return 100
}

// Titles to ask Apollo for.
export const PROSPECT_TITLES = [
  'cfo',
  'chief financial officer',
  'vp finance',
  'vice president finance',
  'treasurer',
  'controller',
  'ceo',
  'chief executive officer',
  'president',
  'owner',
  'founder',
]
