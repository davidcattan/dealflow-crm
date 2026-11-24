import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { referralPartnerFor } from './partners'

// New lenders are added to the CRM on their own, from email, so nobody has
// to notice them: (1) the team emails a deal pitch to someone at a firm the
// CRM doesn't know, or (2) someone at an unknown firm answers about a deal.
// Free — no AI beyond the classification the inbox sync already does.

// Marks a lender whose name was guessed from its email domain ("cnob.com" →
// "CNOB"). The first reply from them carries the real firm name, which then
// replaces it.
export const AUTO_NAME_MARK = '(name taken from email domain)'

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'proton.me', 'msn.com'])

export const emailDomain = (email: string | null | undefined) => (email ?? '').toLowerCase().split('@')[1] ?? ''

// E-signature, file-sharing and scheduling services send email on someone's
// behalf ("Rafy Rosario via Docusign"). They are never a lender, a borrower
// or a contact; the email belongs to the person named. (Nov 24, 2026: a
// Docusign envelope from Crown's Rafy Rosario became a lender "Docusign".)
const SERVICE_DOMAINS = [
  'docusign.net', 'docusign.com', 'echosign.com', 'adobesign.com', 'adobe.com', 'hellosign.com', 'dropboxsign.com', 'dropbox.com',
  'pandadoc.com', 'pandadoc.net', 'signnow.com', 'rightsignature.com', 'dotloop.com', 'authentisign.com', 'notarize.com', 'proof.com',
  'box.com', 'sharepoint.com', 'sharepointonline.com', 'onedrive.com', 'wetransfer.com', 'sendgrid.net', 'calendly.com', 'zoom.us',
  'zoomgov.com', 'teams.microsoft.com', 'papermark.com', 'papermark.io', 'docsend.com', 'egnyte.com', 'citrixdata.com', 'sharefile.com',
]
export function isServiceSender(email: string | null | undefined) {
  const d = emailDomain(email)
  return Boolean(d) && SERVICE_DOMAINS.some((s) => d === s || d.endsWith(`.${s}`))
}
// "Rafy Rosario via Docusign" → "Rafy Rosario"
export function personBehindService(fromName: string | null | undefined) {
  const m = (fromName ?? '').match(/^\s*(.+?)\s+via\s+\S/i)
  return m ? m[1].replace(/["']/g, '').trim() : null
}

function siteDomain(url: string | null | undefined) {
  if (!url) return ''
  return url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
}

// A readable firm name from a domain: "sunflowerbank.com" → "Sunflower Bank",
// "cnob.com" → "CNOB".
const NAME_WORDS = ['bank', 'capital', 'credit', 'funding', 'finance', 'financial', 'lending', 'partners', 'group', 'business']
export function firmNameFromDomain(domain: string) {
  const label = domain.split('.')[0].replace(/[-_]+/g, ' ')
  if (/^[a-z]{2,5}$/.test(label)) return label.toUpperCase()
  let words = label
  for (const w of NAME_WORDS) words = words.replace(new RegExp(`(?<=[a-z])${w}\\b`), ` ${w}`)
  return words
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// "Re: FW: Silver Lining Homecare: $12 million ..." → "silver lining homecare: $12 million ..."
export function baseSubject(subject: string | null | undefined) {
  return (subject ?? '')
    .replace(/^\s*((re|fw|fwd|aw)\s*:\s*|\[external\]\s*)+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const FINANCING_WORDS = /\$\s?\d|\b\d+(\.\d+)?\s*(mm|m|million|k)\b|facility|\bloan\b|financing|line of credit|credit line|\bask\b|refinanc|term sheet|revolver|\babl\b/i

// Is this sent email a deal pitch to lenders? Either the same subject already
// went to a known lender on this deal, or it's a fresh email whose subject
// names the deal and an amount or a financing product.
export function isLenderPitch(subject: string, dealName: string | undefined, pitchedSubjects: Set<string> | undefined) {
  const base = baseSubject(subject)
  if (!base) return false
  if (pitchedSubjects?.has(base)) return true
  if (/^\s*(re|fw|fwd)\s*:/i.test(subject)) return false
  const firstWord = (dealName ?? '').toLowerCase().split(/[^a-z0-9]+/).find((w) => w.length >= 3)
  return Boolean(firstWord && base.includes(firstWord)) && FINANCING_WORDS.test(subject)
}

// Domains that are never a new lender: free mail, the team, referral
// partners, borrowers (any deal's contacts), cold-outreach prospects, and
// firms marked "not a lender".
export function buildNonLenderDomains(input: {
  firmDomain?: string
  dealContactEmails: (string | null | undefined)[]
  notLenderRows: { contact_email?: string | null; website?: string | null }[]
  notLenderContactEmails: (string | null | undefined)[]
  prospectDomains: Iterable<string>
}) {
  const set = new Set<string>(FREE_MAIL)
  if (input.firmDomain) set.add(input.firmDomain)
  for (const e of input.dealContactEmails) if (emailDomain(e)) set.add(emailDomain(e))
  for (const r of input.notLenderRows) {
    if (emailDomain(r.contact_email)) set.add(emailDomain(r.contact_email))
    if (siteDomain(r.website)) set.add(siteDomain(r.website))
  }
  for (const e of input.notLenderContactEmails) if (emailDomain(e)) set.add(emailDomain(e))
  for (const d of input.prospectDomains) if (d) set.add(d.toLowerCase())
  return set
}

const core = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')

// Could this address belong to a lender we've never seen? Not if it's a
// known non-lender domain or the borrower's own company ("conexwest.com" on
// the Conexwest deal).
export function couldBeNewLender(email: string, nonLenderDomains: Set<string>, dealName?: string) {
  const domain = emailDomain(email)
  if (!domain || nonLenderDomains.has(domain) || referralPartnerFor(email) || isServiceSender(email)) return false
  const label = core(domain.split('.')[0])
  const deal = core(dealName ?? '')
  if (label.length >= 4 && deal.length >= 4 && (deal.includes(label) || label.includes(deal.slice(0, 8)))) return false
  return true
}

type LenderLike = { id: string; name: string; contact_email: string | null; mandate_notes: string | null; website?: string | null }

// Creates the lender (or finds one by the same name) and saves the people as
// its contacts. Returns the lender, or null if the firm was marked "not a
// lender".
export async function autoAddLender(
  supabase: SupabaseClient,
  known: LenderLike[],
  input: { domain: string; firm?: string | null; people: { email: string; name?: string | null }[]; note: string }
): Promise<{ lender: LenderLike; created: boolean } | null> {
  const name = (input.firm ?? '').trim() || firmNameFromDomain(input.domain)
  const nameCore = core(name)
  // Already in the CRM under this name (e.g. added by hand without an email).
  let lender = known.find((l) => core(l.name) === nameCore) ?? null
  let created = false
  if (!lender) {
    const { data: same } = await supabase.from('lenders').select('id, name, contact_email, mandate_notes, website, is_lender').ilike('name', name.replace(/[\\%_]/g, '\\$&')).limit(1)
    if (same?.[0]?.is_lender === false) return null
    lender = (same?.[0] as LenderLike | undefined) ?? null
  }
  const first = input.people[0]
  if (!lender) {
    const stamp = new Date().toISOString().slice(0, 10)
    const row = {
      name,
      website: input.domain,
      contact_name: first?.name || null,
      contact_email: first?.email ?? null,
      status: 'active',
      is_lender: true,
      match_excluded: false,
      mandate_notes: `[${stamp}] Added automatically from email: ${input.note}${input.firm ? '' : ` ${AUTO_NAME_MARK}`}`,
    }
    const columns = 'id, name, contact_email, mandate_notes, website'
    // Queued for web research by the Claude Code queue job (migration 052);
    // saved without it if that column isn't there yet.
    let { data, error } = await supabase
      .from('lenders')
      .insert({ ...row, research_requested_at: new Date().toISOString() })
      .select(columns)
      .single()
    if (error) ({ data, error } = await supabase.from('lenders').insert(row).select(columns).single())
    if (error || !data) return null
    lender = data as LenderLike
    created = true
  } else if (!lender.website) {
    await supabase.from('lenders').update({ website: input.domain }).eq('id', lender.id)
    lender.website = input.domain
  }
  for (const p of input.people) {
    await supabase.from('lender_contacts').insert({ lender_id: lender.id, email: p.email, name: p.name || null })
  }
  return { lender, created }
}
