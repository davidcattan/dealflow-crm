// Referral partners: companies that send the team deal flow (many different
// borrowers). Their address is never a borrower's contact, and an email from
// them is about the company it names — not whichever deal they last sent.

// Bridgeway Alliance: Venture's loan officers (e.g. Isaac Chehebar) write from it.
// alsoLender: the partner also lends on small deals (Simply Capital / Tom,
// $300–500K) — so a reply about a deal we sent them is a lender reply.
export const REFERRAL_PARTNERS: { name: string; domains: string[]; emails?: string[]; phones?: string[]; alsoLender?: boolean }[] = [
  // Their intake form puts their own front desk on every file.
  { name: 'Venture Nationals', domains: ['venturenationals.com', 'bridgewayalliance.com'], emails: ['frontdesk1052@gmail.com'], phones: ['4053496580'] },
  { name: 'Simply Capital', domains: ['simplycapitalsource.com'], alsoLender: true },
  { name: 'Essex Capital Group', domains: ['essexcg.com'] },
  { name: 'Direct Cash Group', domains: ['directcashgroup.com'] },
  { name: 'USBC Capital', domains: ['usbcfunds.com'] },
  { name: 'KNW Capital', domains: ['knwcap.com'] },
]

// The team itself — an intro email often names Eli or David as the loan
// officer, which must never become the borrower's contact.
const TEAM_NAMES = ['eli cattan', 'david cattan']
// Cold-outreach domains (Instantly / manual outreach), separate from the main one.
export const OUTREACH_DOMAINS = ['jedcapital-group.com', 'jedcapitalgrp.com']
const TEAM_DOMAINS = ['jed-capitalgroup.com', ...OUTREACH_DOMAINS]

// Sent from one of the outreach domains.
export function isOutreachEmail(email: string | null | undefined) {
  return OUTREACH_DOMAINS.includes(domain(email))
}

const domain = (email: string | null | undefined) => (email ?? '').toLowerCase().split('@')[1] ?? ''

// A partner that only refers deals (never a lender).
export function referralOnlyPartnerFor(email: string | null | undefined) {
  const p = referralPartnerFor(email)
  return p && !p.alsoLender ? p : null
}

export function referralPartnerFor(email: string | null | undefined) {
  const d = domain(email)
  const e = (email ?? '').trim().toLowerCase()
  return d ? (REFERRAL_PARTNERS.find((p) => p.domains.includes(d) || (p.emails ?? []).includes(e)) ?? null) : null
}

// A phone number that belongs to a partner, not a borrower.
export function isNotBorrowerPhone(phone: string | null | undefined) {
  const digits = (phone ?? '').replace(/\D/g, '').slice(-10)
  return digits.length === 10 && REFERRAL_PARTNERS.some((p) => (p.phones ?? []).includes(digits))
}

// An address that can't be a borrower's own: a partner's or the team's.
export function isNotBorrowerEmail(email: string | null | undefined) {
  return Boolean(referralPartnerFor(email)) || TEAM_DOMAINS.includes(domain(email))
}

export function isTeamName(name: string | null | undefined) {
  return TEAM_NAMES.includes((name ?? '').trim().toLowerCase())
}
