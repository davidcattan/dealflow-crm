// Lender "type" is free text from the spreadsheet ("ABL. AR, Inv.",
// "Term Loan - Casfhlow", "AR Factor"…). These groups sort it into clean
// filter categories. A lender can belong to several (e.g. ABL + Equipment).

export const LENDER_TYPE_GROUPS = [
  { key: 'abl', label: 'ABL (AR & Inventory)', match: /\bABL\b|asset[- ]?based|\bAR\s*(&|\+|,)\s*inv/i },
  { key: 'factoring', label: 'Factoring / AR financing', match: /factor|\bA\/?R\b(?!\s*(&|\+|,)\s*inv)|receivable|gov'?t contracts/i },
  { key: 'term', label: 'Term loan / Cash flow', match: /\bterm\b|cash\s*flow|casfhlow|ebitda/i },
  { key: 'equipment', label: 'Equipment financing', match: /equip|\bM&E\b/i },
  { key: 'real_estate', label: 'Real estate / Bridge / Construction', match: /real estate|\bbridge\b(?!\s*lenders?\s*-\s*mca)|construction|heloc|\bRE\b|\bTI\b|\bADC\b|\bland\b|hard money/i },
  { key: 'working_capital', label: 'Working capital / Line of credit', match: /working capital|line of credit|\bLOC\b|\bWC\b/i },
  { key: 'sba', label: 'SBA', match: /\bSBA\b/i },
  { key: 'revenue_mca', label: 'Revenue-based / MCA', match: /revenue[- ]based|\bMCA\b|cash advance/i },
  { key: 'po_supply', label: 'PO / Inventory / Supply chain', match: /\bPO\b|purchase order|supply\s*chain|inventory (lender|financing)/i },
  { key: 'venture', label: 'Venture / Growth / SaaS', match: /venture|\bARR\b|saas|growth|recurring/i },
  { key: 'mna_equity', label: 'M&A / Sponsor / Equity', match: /M&A|sponsor|equity/i },
  { key: 'specialty', label: 'Specialty (lender finance, auto, medical…)', match: /lender finance|illiquid|auto dealer|medical|cannab/i },
  { key: 'broker', label: 'Brokers (not lenders)', match: /broker/i },
] as const

export type LenderTypeKey = (typeof LENDER_TYPE_GROUPS)[number]['key'] | 'unknown'

function typeText(l: { lending_type: string | null; asset_types?: string[] | null }) {
  return [l.lending_type ?? '', ...(l.asset_types ?? [])].join(' | ').trim()
}

// Which groups a lender falls into; "unknown" when its type is blank or "?".
export function lenderTypeKeys(l: { lending_type: string | null; asset_types?: string[] | null }): LenderTypeKey[] {
  const text = typeText(l)
  if (!text || /^[?\s|—-]*$/.test(text)) return ['unknown']
  const keys = LENDER_TYPE_GROUPS.filter((g) => g.match.test(text)).map((g) => g.key)
  return keys.length ? keys : ['unknown']
}
