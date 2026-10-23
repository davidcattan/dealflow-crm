// The team's lender email skeleton (Eli's format). Same layout on every
// deal; the numbers come straight from the deal's underwriting snapshot.
// Only blocks with real numbers are shown (a $0 EBITDA off a tax return
// isn't one); the ask shows "[ ]" if missing so it's easy to fill in. No AI.
//
//   Hi Tom, hope all is well.
//
//   I'm working with Orbit Innovations (New York, NY), a wholesale and
//   manufacturing company that turns licensed IP into retail-ready goods.
//
//   Revenue
//   2025: $29.6 million
//   2026 Year to Date (Jan-Jul): $8.0 million
//
//   EBITDA
//   2025: $1.8 million
//   2026 Year to Date (Jan-Jul): $1.5 million
//
//   AR: $4.1 million
//   Inventory: $7.3 million
//   Total Debt: $6.3 million
//
//   ASK: Client needs an ABL lender to replace Hedaya Group.
//
//   Let me know if you have time to discuss briefly.
//
//   Regards,
//   Eli

type Period = { label: string; revenue: number | null; ebitda: number | null }
export type SkeletonSnapshot = {
  entities?: {
    name?: string
    about?: string
    periods?: Period[]
    assets?: { accounts_receivable: number | null; inventory: number | null }
    liabilities?: { total_debt: number | null }
  }[]
  combined?: { periods?: Period[]; accounts_receivable: number | null; inventory: number | null; total_debt: number | null } | null
} | null

const BLANK = '$[ ]'

export function money(n: number | null | undefined) {
  if (n === null || n === undefined) return BLANK
  const sign = n < 0 ? '-' : ''
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)} million`
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000)}K`
  return `${sign}$${Math.round(a)}`
}

// "FY2025" → "2025"; "2026 YTD (Jan-Jul)" → "2026 Year to Date (Jan-Jul)".
function periodLabel(label: string) {
  const fy = label.match(/^\s*(?:FY|Fiscal(?: Year)?)\s*'?(\d{4})\s*$/i)
  if (fy) return fy[1]
  return label.replace(/\bYTD\b/i, 'Year to Date').trim()
}

// "PIGEON HILL EQUIPMENT LLC" (as printed on a tax return) → normal case.
function niceName(name: string) {
  if (name !== name.toUpperCase()) return name
  return name
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Llc|Inc|Lp|Llp|Pc|Pllc|Usa|Dba)\b/g, (m) => m.toUpperCase())
}

const isPlaceholder = (name: string) => /not stated|unknown|unnamed|tbd|n\/a|\?\?/i.test(name)

export function skeletonEmail(opts: {
  companyName: string
  description: string | null
  location: string | null
  loanType: string | null
  ask: string | null
  snapshot: SkeletonSnapshot
  contactFirstName: string | null
  senderFirstName: string
}) {
  const snap = opts.snapshot
  const e = snap?.entities?.[0]
  const c = snap?.combined

  const company = niceName(isPlaceholder(opts.companyName) && e?.name ? e.name : opts.companyName)
  let about = (e?.about || opts.description?.split(/(?<=\.)\s/)[0] || '').trim()
  // "Orbit Innovations is a …" / "The company is a …" → "a …"
  about = about.replace(new RegExp(`^(${company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|the company|the business)\\s+(is|operates as)\\s+`, 'i'), '')
  const where = opts.location ? ` (${opts.location})` : ''
  const intro = !about
    ? `I'm working with ${company}${where}, [what the company does and who it sells to].`
    : /^(a|an)\s/i.test(about)
      ? `I'm working with ${company}${where}, ${about[0].toLowerCase()}${about.slice(1)}`
      : `I'm working with ${company}${where}. ${about}`

  // The two latest periods, older first (as Eli writes them).
  const periods = (c?.periods?.length ? c.periods : (e?.periods ?? [])).slice(0, 2).reverse()
  // A block of periods, or nothing when none has a real (non-zero) number.
  const block = (title: string, pick: (p: Period) => number | null) => {
    const real = periods.filter((p) => pick(p) !== null && pick(p) !== 0)
    return real.length ? [title, ...real.map((p) => `${periodLabel(p.label)}: ${money(pick(p))}`), ''] : []
  }
  const line = (label: string, n: number | null | undefined) => (n ? [`${label}: ${money(n)}`] : [])

  const ar = c ? c.accounts_receivable : (e?.assets?.accounts_receivable ?? null)
  const inventory = c ? c.inventory : (e?.assets?.inventory ?? null)
  const debt = c ? c.total_debt : (e?.liabilities?.total_debt ?? null)

  const body = [
    `Hi ${opts.contactFirstName || '[Name]'}, hope all is well.`,
    '',
    /[.!?]$/.test(intro) ? intro : `${intro}.`,
    '',
    ...block('Revenue', (p) => p.revenue),
    ...block('EBITDA', (p) => p.ebitda),
    ...line('AR', ar),
    ...line('Inventory', inventory),
    ...line('Total Debt', debt),
    ...(ar || inventory || debt ? [''] : []),
    `ASK: ${opts.ask?.trim() || '[What the client needs — amount and product]'}`,
    '',
    'Let me know if you have time to discuss briefly.',
    '',
    'Regards,',
    opts.senderFirstName,
  ].join('\n')

  return { subject: `${company} - ${opts.loanType || 'financing'}`, body }
}
