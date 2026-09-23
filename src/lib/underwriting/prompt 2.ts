export const RESEARCH_INSTRUCTIONS = `Most deals here are small, private, and sometimes financially distressed businesses — not public companies. It is normal and expected for a company to have no website, no news coverage, and no public footprint at all. Do not treat that as a failure; just work with whatever is actually available.

Using the documents above, the company's website content (if provided), and web search for recent news, please:

1. Research this company using web search — ownership changes, financial distress, litigation, UCC filings, liens, lawsuits, closures, or local news. Before including any search result, verify it actually matches this specific company (same industry, same location if known, plausible size) — small businesses often share names with unrelated companies elsewhere, and a name match alone is not enough. If a search turns up nothing relevant, or nothing you can confidently confirm is the same business, say so plainly rather than including a guess or an unrelated company's news.
2. Extract historical financial performance from the documents: revenue, EBITDA, net income, and cash flow for each fiscal period you can find.
3. Extract the company's current financial position from the documents: accounts receivable, inventory, equipment value, real estate value, accounts payable, and total debt — using the most recent as-of date available.
4. Identify strengths and risks relevant to an asset-based lending decision. For a distressed or thinly-documented deal, this might mean the risks section is short on financial ratios but should still cover what's knowable: document quality/completeness itself, concentration risk, collateral condition, and anything the broker's notes flag.
5. Explicitly note any of the above data points you could NOT find in the provided documents, and say plainly if there was no meaningful public information available at all.

Write your findings as a clear, well-organized plain-text analysis. Be specific with numbers and note which document or source each figure came from. This analysis will be converted into structured data afterward, so make sure every number and finding you want captured appears explicitly in your text. Do not invent or estimate figures that are not present in the documents or a verified source — a short, honest analysis based on thin data is far more useful than a padded one.`

// The same task as a self-contained prompt for pasting into Claude.ai
// (where the documents are attached to the chat instead of sent by the app).
export function buildManualPrompt(deal: {
  company_name: string
  industry: string | null
  website: string | null
  notes: string | null
}, documentNames: string[]): string {
  return [
    `Company: ${deal.company_name}`,
    `Industry: ${deal.industry ?? 'unknown'}`,
    `Website: ${deal.website ?? 'none provided'}`,
    deal.notes ? `Broker notes: ${deal.notes}` : null,
    documentNames.length > 0
      ? `Documents: I have attached ${documentNames.length} file(s): ${documentNames.join(', ')}`
      : 'No documents are attached.',
    '',
    RESEARCH_INSTRUCTIONS.replace('the documents above', 'the attached documents'),
  ]
    .filter((l) => l !== null)
    .join('\n')
}
