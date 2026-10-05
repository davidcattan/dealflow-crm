// The rules the brokerage's own analyst workflow follows, written down once
// so the free (Claude.ai), Claude Code, and paid routes all produce the same
// snapshot.
export const SNAPSHOT_RULES = `You are a commercial-finance analyst spreading a borrower's diligence package for a debt broker who will send a short snapshot to lenders. Read the attached documents (tax returns, balance sheets, P&Ls, debt schedules, bank statements, the client's loan application, emails).

Produce the snapshot in this exact template, ONE BLOCK PER LEGAL ENTITY, then a COMBINED block if there is more than one entity:

- About (one sentence), Owner (with %), Industry
- Revenue, EBITDA, Net income for up to three periods, newest first: interim YTD, then the last two fiscal years. Put the SOURCE next to every period (e.g. "2025 Form 1065", "YTD P&L", "Schedule C"), and say whether it is tax, book or cash basis when that matters.
- Assets: Accounts receivable, Equipment (net fixed assets), Real estate (if the entity owns any), Inventory, with the as-of date and source.
- Liabilities: Accounts payable, then each debt (lender, balance, and whether it is real-estate debt or business debt), and Total debt, with as-of date and source.
- COMBINED: same numbers summed across entities. Eliminate intercompany items where you can tell (rent, management fees) and say so in one line.

Rules:
1. Use ONLY numbers that are in the documents. If a figure is not there, leave it empty (null) — never estimate or invent.
2. As little text as possible. Numbers and short phrases, not paragraphs.
3. EBITDA: net income + interest + depreciation/amortization (+ taxes if any). Say in the source field if you derived it. Prefer tax-return figures for full years; book figures only if that is all there is.
4. Coverage: annual debt service (from the debt schedule if given) against EBITDA, as a ratio. Say in one line what basis you used and how much to trust it (for example seasonality of a partial year).
5. FLAGS: list every inconsistency or red flag as one short line each. Examples: the loan application says "no balances" but debt exists; unexplained "other income"; interim P&L with no depreciation; round-number receivables; balance sheet not reconciling to the tax return; thin coverage; concentrated or related-party debt; SBA anti-stacking restrictions; missing documents.
6. REQUEST LIST: the documents to ask the client for, one short line each, tailored to what is missing for an asset-based or cash-flow lender (AR aging, fixed asset register, equipment list with serials/VINs, inventory listing, AP aging, UCC search, payoff statements, loan agreements, appraisals, and so on). Only list what is actually missing.`

export function buildSnapshotPrompt(
  deal: {
    company_name: string
    industry: string | null
    description?: string | null
    notes?: string | null
  },
  documentNames: string[],
  emailsText: string | null = null
): string {
  return [
    `Company / deal: ${deal.company_name}`,
    deal.industry ? `Industry: ${deal.industry}` : null,
    deal.description ? `Deal description (from the broker): ${deal.description}` : null,
    deal.notes ? `Broker notes: ${deal.notes}` : null,
    documentNames.length > 0
      ? `Documents attached (${documentNames.length}): ${documentNames.join(', ')}`
      : 'No documents are attached.',
    emailsText ? `\n${emailsText}` : null,
    '',
    SNAPSHOT_RULES,
  ]
    .filter((l) => l !== null)
    .join('\n')
}
