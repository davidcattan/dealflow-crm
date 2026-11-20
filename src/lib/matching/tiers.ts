// Shared by the matcher and the deal page.

export const MATCH_TIERS = ['best', 'good', 'long_shot'] as const
export type MatchTier = (typeof MATCH_TIERS)[number]

export const TIER_LABEL: Record<MatchTier | 'sba', string> = {
  best: 'Best fits',
  good: 'Also good',
  long_shot: 'Worth a shot',
  sba: 'SBA (only if needed)',
}

// The solution label leads the reasoning ("SBA 7(a) acquisition loan — …").
export function isSbaMatch(reasoning: string) {
  return /^(new lender — no relationship yet\. )?[^—]*\bSBA\b[^—]*—/i.test(reasoning)
}

// "… Send to Bill Herrington. …" → "Bill Herrington"
export function sendToName(reasoning: string) {
  return reasoning.match(/Send to ([^.]+)\./)?.[1]?.trim() ?? null
}
