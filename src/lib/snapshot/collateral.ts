import type { Snapshot } from './schema'

// Collateral backup a lender always needs: if the business shows AR,
// inventory or equipment, ask for the aging / list unless it's already on
// the deal or already requested.

type Need = { has: (s: Snapshot) => boolean; provided: RegExp; requested: RegExp; ask: string }

const pos = (n: number | null | undefined) => typeof n === 'number' && n > 0

const NEEDS: Need[] = [
  {
    has: (s) => s.entities.some((e) => pos(e.assets.accounts_receivable)) || pos(s.combined?.accounts_receivable),
    provided: /\baging\b|a\/?r\s*(aging|report|detail)|receivables? (aging|report|detail)/i,
    requested: /aging/i, // "AR aging …" in any wording
    ask: 'AR aging report (current, by customer)',
  },
  {
    has: (s) => s.entities.some((e) => pos(e.assets.inventory)) || pos(s.combined?.inventory),
    provided: /inventory\s*(list|listing|report|detail|count|valuation)|stock (list|report)/i,
    requested: /inventory\s*(list|listing|report|detail|count)|list of inventory/i,
    ask: 'Inventory list (items, quantities and cost)',
  },
  {
    has: (s) => s.entities.some((e) => pos(e.assets.equipment)) || pos(s.combined?.equipment),
    provided: /equipment\s*(list|listing|schedule)|fixed[- ]asset|asset (list|register|schedule)|machinery list/i,
    requested: /equipment\s*(list|listing|schedule|register)|fixed[- ]asset (list|register|schedule)|list of equipment/i,
    ask: 'Equipment list (make, model, year, serial/VIN and estimated value)',
  },
]

// What's missing among the AR aging / inventory list / equipment list.
// `docTexts` = document file names plus any AI doc types on the deal.
export function missingCollateralDocs(snapshot: Snapshot, docTexts: string[]) {
  return NEEDS.filter(
    (n) =>
      n.has(snapshot) &&
      !docTexts.some((t) => n.provided.test(t)) &&
      !snapshot.request_list.some((r) => n.requested.test(r))
  ).map((n) => n.ask)
}

// The snapshot with those asks added to its request list.
export function withCollateralRequests(snapshot: Snapshot, docTexts: string[]): Snapshot {
  const missing = missingCollateralDocs(snapshot, docTexts)
  return missing.length ? { ...snapshot, request_list: [...missing, ...snapshot.request_list] } : snapshot
}

// File names + AI doc types for a deal's documents.
export function docTextsOf(docs: { file_name: string; triage?: { doc_type?: string } | null }[]) {
  return docs.flatMap((d) => [d.file_name, d.triage?.doc_type ?? '']).filter(Boolean)
}
