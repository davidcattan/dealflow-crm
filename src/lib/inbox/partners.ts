// Referral partners: companies that send the team deal flow (many different
// borrowers). Their address is never a borrower's contact, and an email from
// them is about the company it names — not whichever deal they last sent.

// Bridgeway Alliance: Venture's loan officers (e.g. Isaac Chehebar) write from it.
export const REFERRAL_PARTNERS = [{ name: 'Venture Nationals', domains: ['venturenationals.com', 'bridgewayalliance.com'] }]

// The team itself — an intro email often names Eli or David as the loan
// officer, which must never become the borrower's contact.
const TEAM_NAMES = ['eli cattan', 'david cattan']
const TEAM_DOMAINS = ['jed-capitalgroup.com']

const domain = (email: string | null | undefined) => (email ?? '').toLowerCase().split('@')[1] ?? ''

export function referralPartnerFor(email: string | null | undefined) {
  const d = domain(email)
  return d ? (REFERRAL_PARTNERS.find((p) => p.domains.includes(d)) ?? null) : null
}

// An address that can't be a borrower's own: a partner's or the team's.
export function isNotBorrowerEmail(email: string | null | undefined) {
  return Boolean(referralPartnerFor(email)) || TEAM_DOMAINS.includes(domain(email))
}

export function isTeamName(name: string | null | undefined) {
  return TEAM_NAMES.includes((name ?? '').trim().toLowerCase())
}
