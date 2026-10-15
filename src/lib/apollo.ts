import 'server-only'

// Apollo.io: find people at a lender (free), reveal a person's work email
// (1 credit), and company info (1 credit). Needs APOLLO_API_KEY in Vercel.

const BASE = 'https://api.apollo.io/api/v1'

async function apollo(path: string, init: RequestInit = {}) {
  const key = process.env.APOLLO_API_KEY
  if (!key) throw new Error('Apollo isn’t connected yet — add APOLLO_API_KEY in Vercel.')
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'x-api-key': key, 'content-type': 'application/json', 'cache-control': 'no-cache', ...(init.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (body as { error?: string; message?: string }).error ?? (body as { message?: string }).message
    if (res.status === 401 || res.status === 403) throw new Error('Apollo rejected the API key — check APOLLO_API_KEY (and that your plan includes API access).')
    if (res.status === 429) throw new Error('Apollo rate limit hit — try again in a minute.')
    throw new Error(msg || `Apollo error (${res.status})`)
  }
  return body as Record<string, unknown>
}

export function cleanDomain(input: string | null | undefined) {
  if (!input) return null
  const s = input.trim().toLowerCase()
  const host = s.includes('@') ? s.split('@')[1] : s.replace(/^https?:\/\//, '').split('/')[0]
  return host.replace(/^www\./, '') || null
}

// Titles that matter for sending deals to a lender.
const TITLES = [
  'business development',
  'originations',
  'origination',
  'relationship manager',
  'managing director',
  'vice president',
  'director',
  'credit',
  'underwriting',
  'partner',
  'president',
  'sales',
]

export type ApolloPerson = { id: string; name: string; title: string | null; hasEmail: boolean; city: string | null }

// Free: people at the company with deal-relevant titles.
export async function searchPeople(domain: string): Promise<ApolloPerson[]> {
  const params = new URLSearchParams()
  params.append('q_organization_domains_list[]', domain)
  for (const t of TITLES) params.append('person_titles[]', t)
  params.set('per_page', '25')
  const body = await apollo(`/mixed_people/api_search?${params.toString()}`, { method: 'POST' })
  const people = (body.people as Record<string, unknown>[] | undefined) ?? []
  return people.map((p) => ({
    id: String(p.id),
    name: [p.first_name, p.last_name_obfuscated ?? p.last_name].filter(Boolean).join(' '),
    title: (p.title as string | null) ?? null,
    hasEmail: Boolean(p.has_email),
    city: (p.city as string | null) ?? null,
  }))
}

export type RevealedPerson = { name: string; title: string | null; email: string | null; linkedin: string | null; phone: string | null }

// 1 credit: the person's full name and work email.
export async function revealPerson(id: string): Promise<RevealedPerson> {
  const body = await apollo('/people/match', { method: 'POST', body: JSON.stringify({ id }) })
  const p = (body.person as Record<string, unknown> | undefined) ?? {}
  const phones = ((p.contact as { phone_numbers?: { sanitized_number?: string; raw_number?: string }[] } | undefined)?.phone_numbers ?? [])
  return {
    name: String(p.name ?? [p.first_name, p.last_name].filter(Boolean).join(' ')),
    title: (p.title as string | null) ?? null,
    email: (p.email as string | null) && !String(p.email).includes('email_not_unlocked') ? String(p.email) : null,
    linkedin: (p.linkedin_url as string | null) ?? null,
    phone: phones[0]?.sanitized_number ?? phones[0]?.raw_number ?? null,
  }
}

export type ApolloCompany = {
  description: string | null
  city: string | null
  state: string | null
  employees: number | null
  linkedin: string | null
  phone: string | null
  website: string | null
  industry: string | null
}

// 1 credit: what the company is.
export async function companyInfo(domain: string): Promise<ApolloCompany> {
  const body = await apollo(`/organizations/enrich?domain=${encodeURIComponent(domain)}`, { method: 'GET' })
  const o = (body.organization as Record<string, unknown> | undefined) ?? {}
  return {
    description: (o.short_description as string | null) ?? null,
    city: (o.city as string | null) ?? null,
    state: (o.state as string | null) ?? null,
    employees: (o.estimated_num_employees as number | null) ?? null,
    linkedin: (o.linkedin_url as string | null) ?? null,
    phone: (o.phone as string | null) ?? ((o.primary_phone as { number?: string } | undefined)?.number ?? null),
    website: (o.website_url as string | null) ?? null,
    industry: (o.industry as string | null) ?? null,
  }
}

// ---- Prospecting (companies that might need financing) ----

export type ApolloOrg = { id: string; name: string; domain: string | null; city: string | null; state: string | null; employees: number | null }

// Companies by name (for when you only have a name, not a website).
export async function findCompanies(name: string): Promise<ApolloOrg[]> {
  const body = await apollo('/mixed_companies/search', {
    method: 'POST',
    body: JSON.stringify({ q_organization_name: name, per_page: 5 }),
  })
  const orgs = ((body.organizations ?? body.accounts) as Record<string, unknown>[] | undefined) ?? []
  return orgs.map((o) => ({
    id: String(o.id),
    name: String(o.name ?? ''),
    domain: (o.primary_domain as string | null) ?? cleanDomain(o.website_url as string | null),
    city: (o.city as string | null) ?? null,
    state: (o.state as string | null) ?? null,
    employees: (o.estimated_num_employees as number | null) ?? null,
  }))
}

export type ApolloCandidate = ApolloPerson & { company: string | null }

// Free: people at a company with the given titles (default: finance and
// owners). Last names come back partly hidden until revealed.
export async function searchPeopleWithTitles(domain: string, titles: string[]): Promise<ApolloCandidate[]> {
  const params = new URLSearchParams()
  params.append('q_organization_domains_list[]', domain)
  for (const t of titles) params.append('person_titles[]', t)
  params.set('per_page', '25')
  const body = await apollo(`/mixed_people/api_search?${params.toString()}`, { method: 'POST' })
  const people = (body.people as Record<string, unknown>[] | undefined) ?? []
  return people.map((p) => ({
    id: String(p.id),
    name: [p.first_name, p.last_name_obfuscated ?? p.last_name].filter(Boolean).join(' '),
    title: (p.title as string | null) ?? null,
    hasEmail: Boolean(p.has_email),
    city: (p.city as string | null) ?? null,
    company: ((p.organization as { name?: string } | undefined)?.name as string | undefined) ?? null,
  }))
}
