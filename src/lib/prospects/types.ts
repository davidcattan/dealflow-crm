export const PROSPECT_STATUSES = ['new', 'emailed', 'replied', 'interested', 'not_interested', 'wrong_person', 'deal', 'do_not_contact'] as const
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number]

export const PROSPECT_STATUS_LABELS: Record<ProspectStatus, string> = {
  new: 'Not contacted',
  emailed: 'Emailed',
  replied: 'Replied',
  interested: 'Interested',
  not_interested: 'Not interested',
  wrong_person: 'Wrong person',
  deal: 'Deal',
  do_not_contact: 'Do not contact',
}

export const PROSPECT_STATUS_COLORS: Record<ProspectStatus, string> = {
  new: 'bg-slate-100 text-slate-600',
  emailed: 'bg-sky-100 text-sky-800',
  replied: 'bg-amber-100 text-amber-800',
  interested: 'bg-emerald-100 text-emerald-800',
  not_interested: 'bg-slate-200 text-slate-600',
  wrong_person: 'bg-orange-100 text-orange-800',
  deal: 'bg-emerald-600 text-white',
  do_not_contact: 'bg-red-100 text-red-700',
}

export type Prospect = {
  id: string
  company: string
  company_display: string | null
  first_name: string | null
  last_name: string | null
  title: string | null
  email: string
  phone: string | null
  linkedin: string | null
  city: string | null
  state: string | null
  website: string | null
  domain: string | null
  lender: string | null
  amount: string | null
  deal_year: string | null
  source: string | null
  status: ProspectStatus
  last_emailed_at: string | null
  replied_at: string | null
  reply_summary: string | null
  deal_id: string | null
  notes: string | null
}

const GENERIC = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'proton.me', 'msn.com', 'comcast.net'])

// The company's own email domain (never gmail.com and the like).
export function companyDomain(email: string | null | undefined) {
  const d = (email ?? '').toLowerCase().split('@')[1]
  return d && !GENERIC.has(d) ? d : null
}

// Follow up with someone who hasn't answered this many days after our last email.
export const FOLLOW_UP_DAYS = 5
const NOTHING_OWED: ProspectStatus[] = ['new', 'not_interested', 'wrong_person', 'deal', 'do_not_contact']

// The last time either side wrote: our last email or their last reply.
export function lastContacted(p: Pick<Prospect, 'last_emailed_at' | 'replied_at'>): string | null {
  const times = [p.last_emailed_at, p.replied_at].filter((t): t is string => Boolean(t))
  return times.length ? times.reduce((a, b) => (a > b ? a : b)) : null
}

// When to write next: right away if they wrote last (we owe a reply), else
// FOLLOW_UP_DAYS after our last email. Null when nothing's owed — not
// contacted yet, or closed out (deal, not interested, wrong person, do not contact).
export function followUp(p: Pick<Prospect, 'status' | 'last_emailed_at' | 'replied_at'>): { at: Date; kind: 'reply' | 'follow_up' } | null {
  if (NOTHING_OWED.includes(p.status)) return null
  if (p.replied_at && (!p.last_emailed_at || p.replied_at > p.last_emailed_at)) return { at: new Date(p.replied_at), kind: 'reply' }
  if (!p.last_emailed_at) return null
  return { at: new Date(new Date(p.last_emailed_at).getTime() + FOLLOW_UP_DAYS * 86_400_000), kind: 'follow_up' }
}
