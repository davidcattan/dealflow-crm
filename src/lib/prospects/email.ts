import type { Prospect } from './types'

// "Fifth Third Business Capital" → "Fifth Third", "VNB New York, LLC" →
// "Valley National" — how the lender reads in a subject line.
const LENDER_SHORT: Record<string, string> = {
  'vnb new york, llc': 'Valley National',
  'cit northbridge credit': 'CIT',
  'cit group': 'CIT',
  'jpmorgan chase bank': 'JPMorgan',
  'wells fargo capital finance': 'Wells Fargo',
  'bank of america': 'Bank of America',
  'sterling national bank': 'Sterling',
}
const LENDER_FULL: Record<string, string> = { 'vnb new york, llc': 'Valley National Bank' }

// "Polder Products" → "Polder Products'", "Comfort Research" → "Comfort Research's".
const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`)

export function shortLender(lender: string) {
  const known = LENDER_SHORT[lender.toLowerCase()]
  if (known) return known
  const short = lender
    .replace(/,?\s*(LLC|L\.L\.C\.|Inc\.?|N\.A\.?|LP|L\.P\.|Ltd\.?)$/i, '')
    .replace(/\s+(Business Capital|Business Credit|Business Finance|Commercial Finance|Capital Partners|Credit Partners|Asset Management|Financial Trust|Financial|Funding|Finance|Capital|Credit|Bank|Group|Partners)(\s.*)?$/i, '')
    .trim()
  return short || lender
}

// The cold email David approved (Oct 2026): greeting, their facility, the
// ABL line, a short ask, "Best," — the sender's real signature follows.
export function prospectEmail(p: Prospect, now = new Date()) {
  const company = p.company_display || p.company
  const first = p.first_name?.trim() || 'there'
  const lender = p.lender?.trim() || null
  const lenderText = lender ? (LENDER_FULL[lender.toLowerCase()] ?? lender) : null
  const year = Number(p.deal_year) || null
  const timing =
    year && now.getFullYear() - year >= 5
      ? 'Facilities from that time are typically coming due now'
      : 'Deals like that usually come up for renewal around now'

  const hook =
    p.amount && lenderText && year
      ? `I saw ${company} closed a ${p.amount} facility with ${lenderText} in ${year}. ${timing}, which is the best time to check whether the advance rates, pricing and lender still fit the business.`
      : lenderText
        ? `I saw ${company} has a facility with ${lenderText}. Facilities like that usually come up for renewal every few years, which is the best time to check whether the advance rates, pricing and lender still fit the business.`
        : `I'm reaching out because companies like ${company} often have their credit facility come up for renewal around now, which is the best time to check whether the advance rates, pricing and lender still fit the business.`

  return {
    subject: lender ? `${possessive(company)} ${shortLender(lender)} facility` : `${possessive(company)} credit facility`,
    body: [
      `Hi ${first}, hope all is well.`,
      '',
      hook,
      '',
      'JED Capital Group is a family-owned firm in New York. We arrange ABL facilities and senior secured term loans, working with a wide group of banks and non-bank lenders so you can compare real offers side by side.',
      '',
      'Worth a quick call this week or next?',
      '',
      'Best,',
    ].join('\n'),
  }
}
