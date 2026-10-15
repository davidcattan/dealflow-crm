// Reads anyone's prospect list (ours, an Apollo export, Eli's own sheet):
// columns are matched by meaning, not exact name — "E-mail", "Email Address"
// and "Work Email" are all the email; "Name" is split into first and last.
import { companyDomain } from './types'

export type ImportPerson = {
  email: string
  company: string
  company_display: string | null
  first_name: string | null
  last_name: string | null
  title: string | null
  phone: string | null
  linkedin: string | null
  city: string | null
  state: string | null
  website: string | null
  domain: string | null
  lender: string | null
  amount: string | null
  deal_year: string | null
  notes: string | null
  status: string | null
}

const FIELDS = {
  email: ['email', 'emailaddress', 'workemail', 'contactemail', 'businessemail', 'mail', 'emails'],
  company: ['company', 'companyname', 'organization', 'organisation', 'org', 'account', 'accountname', 'business', 'businessname', 'firm', 'borrower', 'employer'],
  company_display: ['companyforemail'],
  first_name: ['firstname', 'first', 'fname', 'givenname'],
  last_name: ['lastname', 'last', 'lname', 'surname', 'familyname'],
  full_name: ['name', 'fullname', 'contact', 'contactname', 'person', 'contactperson'],
  title: ['title', 'jobtitle', 'position', 'role'],
  phone: ['phone', 'phonenumber', 'phoneno', 'mobile', 'mobilephone', 'cell', 'cellphone', 'directphone', 'workdirectphone', 'telephone', 'tel', 'corporatephone', 'companyphone', 'officephone', 'workphone'],
  linkedin: ['linkedin', 'linkedinurl', 'personlinkedinurl', 'linkedinprofile'],
  city: ['city', 'town'],
  state: ['state', 'st', 'province'],
  website: ['website', 'companywebsite', 'url', 'web', 'site', 'domain', 'companydomain'],
  lender: ['lender', 'currentlender', 'existinglender', 'bank', 'currentbank', 'lenders'],
  amount: ['amount', 'facilitysize', 'loanamount', 'dealsize', 'facility', 'size', 'amountmm'],
  deal_year: ['year', 'dealyear', 'yearclosed'],
  notes: ['notes', 'note', 'comments', 'comment'],
  status: ['status', 'stage'],
} as const
export type FieldKey = keyof typeof FIELDS

export const FIELD_LABELS: Record<FieldKey, string> = {
  email: 'Email',
  company: 'Company',
  company_display: 'Company (for email)',
  first_name: 'First name',
  last_name: 'Last name',
  full_name: 'Name (split into first/last)',
  title: 'Title',
  phone: 'Phone',
  linkedin: 'LinkedIn',
  city: 'City',
  state: 'State',
  website: 'Website',
  lender: 'Lender',
  amount: 'Amount',
  deal_year: 'Year',
  notes: 'Notes',
  status: 'Status',
}

// Only these may match loosely ("Email 1", "Phone (cell)") — a loose "name"
// or "contact" would catch columns like "Contact Owner".
const PREFIX_OK = new Set<FieldKey>(['email', 'phone', 'linkedin', 'website'])

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

// Which column holds what. Exact names first, then names that start with
// a known word ("Email 1", "Phone (cell)").
export function mapColumns(headers: string[]): Partial<Record<FieldKey, string>> {
  const out: Partial<Record<FieldKey, string>> = {}
  const used = new Set<string>()
  for (const pass of ['exact', 'prefix'] as const) {
    for (const [field, names] of Object.entries(FIELDS) as [FieldKey, readonly string[]][]) {
      if (out[field]) continue
      const hit = headers.find((h) => {
        if (used.has(h)) return false
        const n = norm(h)
        return pass === 'exact' ? names.includes(n) : PREFIX_OK.has(field) && names.some((x) => x.length >= 4 && n.startsWith(x))
      })
      if (hit) {
        out[field] = hit
        used.add(hit)
      }
    }
  }
  return out
}

// "acme-tools.com" → "Acme Tools", when a row has no company name.
function companyFromDomain(domain: string) {
  return domain
    .split('.')[0]
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function toPeople(rows: Record<string, string>[], map: Partial<Record<FieldKey, string>>) {
  const get = (r: Record<string, string>, f: FieldKey) => (map[f] ? String(r[map[f]!] ?? '').trim() : '')
  // Lists often have several phone columns (mobile, direct, company) — use
  // the first one that's filled in for each person.
  const phoneCols = rows.length ? Object.keys(rows[0]).filter((h) => (FIELDS.phone as readonly string[]).some((x) => norm(h).startsWith(x))) : []
  const phoneOf = (r: Record<string, string>) =>
    (phoneCols.map((h) => String(r[h] ?? '').trim()).find(Boolean) ?? '').replace(/^'+/, '') || null
  const people: ImportPerson[] = []
  let skipped = 0
  let companyFromEmail = 0
  for (const r of rows) {
    // A cell can hold "a@x.com; b@x.com" — take the first.
    const email = (get(r, 'email').match(/[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}/i)?.[0] ?? '').toLowerCase()
    if (!email) {
      skipped++
      continue
    }
    let company = get(r, 'company')
    const domain = companyDomain(email)
    if (!company && domain) {
      company = companyFromDomain(domain)
      companyFromEmail++
    }
    if (!company) {
      skipped++
      continue
    }
    let first = get(r, 'first_name')
    let last = get(r, 'last_name')
    const full = get(r, 'full_name')
    if (!first && !last && full) {
      const parts = full.replace(/\s+/g, ' ').split(' ')
      first = parts[0] ?? ''
      last = parts.slice(1).join(' ')
    }
    const val = (f: FieldKey) => get(r, f) || null
    people.push({
      email,
      company,
      company_display: val('company_display'),
      first_name: first || null,
      last_name: last || null,
      title: val('title'),
      phone: phoneOf(r),
      linkedin: val('linkedin'),
      city: val('city'),
      state: val('state'),
      website: val('website'),
      domain,
      lender: val('lender'),
      amount: val('amount'),
      deal_year: val('deal_year'),
      notes: val('notes'),
      status: val('status'),
    })
  }
  return { people, skipped, companyFromEmail }
}
