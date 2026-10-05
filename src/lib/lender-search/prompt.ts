import type { Snapshot } from '@/lib/snapshot/schema'
import { snapshotToText } from '@/lib/snapshot/text'

export const LENDER_SEARCH_RULES = `You are helping a commercial debt broker find NEW lenders for the deal below — lenders that are not already in the broker's list.

Search the web for lenders (banks, credit unions, private lenders, debt funds, hard-money and bridge lenders, construction/land lenders, specialty lenders) that would realistically finance this specific deal. Think about what the deal actually needs: the loan product, the collateral, the size, the location, and its weak points (e.g. no income, owner-occupied property, nonprofit borrower) — and look for lenders that are known to accept those.

Rules:
1. Verify every lender on ITS OWN WEBSITE before including it: the site must show it makes this kind of loan. Skip directories, brokers/marketplaces that don't lend themselves, dead or parked sites, and anything you can't verify.
2. Skip every lender already in the broker's list (given below), including obvious name variants.
3. Return 10–15 lenders, best fit first. Prefer ones that lend in the deal's state/region or nationwide.
4. Only state facts the lender's site supports (loan sizes, states, products). If something isn't stated, leave it empty.
5. Add a short "watch out" when a lender's stated rules may conflict with the deal.
6. Include a public submission contact (email, phone or form link) only if the lender's site shows one.

For each lender give: name, website, lending type, loan size range, states/regions, why it fits this deal, watch-out, contact, the page on its site that confirms it, and your confidence (high/medium/low). Start with one or two lines on what kind of lender this deal needs, and end with one line of advice for the broker if useful.`

export function buildLenderSearchPrompt(
  deal: {
    company_name: string
    industry: string | null
    loan_type: string | null
    deal_type: string | null
    description: string | null
    snapshot?: unknown
  },
  existingLenderNames: string[]
): string {
  const snapshot = deal.snapshot as Snapshot | null | undefined
  return [
    `Deal: ${deal.company_name}`,
    deal.industry ? `Industry: ${deal.industry}` : null,
    deal.loan_type ? `Loan type: ${deal.loan_type}` : null,
    deal.deal_type ? `Ask: ${deal.deal_type}` : null,
    deal.description ? `Description: ${deal.description}` : null,
    snapshot ? `\nUnderwriting snapshot:\n${snapshotToText(snapshot)}` : null,
    `\nLenders already in the broker's list (skip these): ${existingLenderNames.join('; ') || 'none'}`,
    '',
    LENDER_SEARCH_RULES,
  ]
    .filter((l) => l !== null)
    .join('\n')
}
