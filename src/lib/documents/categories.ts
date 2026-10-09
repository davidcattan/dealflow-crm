// Groups for a deal's documents. The group is worked out from the file name
// (and the AI document analysis, if it ran) unless someone picked one.

export const DOC_CATEGORIES = [
  'Term sheets & offers',
  'Bank statements',
  'Tax returns',
  'Financial statements',
  'AR / AP & inventory',
  'Debt schedule & loans',
  'Personal financial statement',
  'Applications & forms',
  'Appraisals & property',
  'Legal & corporate',
  'Credit & ID',
  'Decks & business info',
  'Other',
] as const

export type DocCategory = (typeof DOC_CATEGORIES)[number]

// First match wins, so more specific groups come first.
const RULES: [DocCategory, RegExp][] = [
  ['Term sheets & offers', /term\s*sheet|\bloi\b.*(lend|loan|financ)|commitment letter|indicative|proposal|\boffer\b|approval letter|conditional approval/i],
  ['Personal financial statement', /\bpfs\b|personal financial|net worth statement/i],
  ['Bank statements', /bank|\b(chase|wells ?fargo|wellsfargo|bofa|citi|pnc|td bank|truist|mercury|amex|capital one|us bank|regions|huntington|santander)\b|\bstmt|\bdda\b|checking|savings|e-?statement|statements?\b/i],
  ['Tax returns', /tax|1040|1120|1065|990|\bk-?1\b|schedule c|\bw-?2\b|\birs\b|return/i],
  ['AR / AP & inventory', /\bar\b|\bap\b|aging|receivable|payable|inventory|borrowing base|\bbbc\b/i],
  ['Debt schedule & loans', /debt|loan|note payable|mca|lease|amortization|payoff|ucc/i],
  ['Financial statements', /p\s*&\s*l|\bpnl\b|profit|income statement|balance sheet|\bbs\b|financial|ytd|year[- ]end|cash flow|budget|projection|pro ?forma|10-?[kq]\b|audit|trial balance|quickbooks|\bqbo\b/i],
  ['Applications & forms', /application|\bapp\b|form|questionnaire|authorization|consent|signed|docusign|w-?9/i],
  ['Appraisals & property', /apprais|property|survey|\bbpo\b|deed|title|rent roll|lease|plat|site plan|insurance|environmental|phase i/i],
  ['Legal & corporate', /\bloi\b|letter of intent|agreement|contract|operating|articles|bylaws|certificate|good standing|\bein\b|org chart|ownership|cap table|resolution|purchase agreement|\bnda\b/i],
  ['Credit & ID', /credit|\bcbr\b|experian|equifax|transunion|license|passport|\bid\b|driver/i],
  ['Decks & business info', /deck|presentation|overview|teaser|\bcim\b|memo|summary|business plan|website|brochure/i],
]

export function guessCategory(fileName: string, docType?: string | null): DocCategory {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '')
  const name = base.replace(/[_-]+/g, ' ')
  for (const text of [docType ?? '', name]) {
    if (!text) continue
    for (const [cat, re] of RULES) if (re.test(text)) return cat
  }
  // Monthly files named by date, e.g. "26_02 Solid Max Holdings" or
  // "013126 …", are almost always bank statements.
  if (/^\s*(\d{2}[_-]\d{2}|\d{6}|\d{4}[_-]\d{2})\b/.test(base)) return 'Bank statements'
  return 'Other'
}

// A lender named in a term sheet's file name (e.g. "Pathward Term Sheet.pdf").
export function guessLender<T extends { id: string; name: string }>(fileName: string, lenders: T[]): T | null {
  const name = fileName.toLowerCase()
  const hits = lenders.filter((l) => {
    const core = l.name.toLowerCase().replace(/\b(capital|funding|financial|finance|lending|group|partners|llc|inc|bank|commercial|credit)\b/g, '').trim()
    const first = core.split(/\s+/)[0] ?? ''
    return first.length >= 4 && name.includes(first)
  })
  return hits.length === 1 ? hits[0] : null
}
