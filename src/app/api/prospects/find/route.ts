import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cleanDomain, findCompanies, searchPeopleWithTitles, type ApolloOrg } from '@/lib/apollo'
import { PROSPECT_TITLES, bossRank, financeRank, titleScore } from '@/lib/prospects/titles'

export const maxDuration = 120

export type FoundPerson = { id: string; name: string; title: string | null; hasEmail: boolean; picked: boolean }
export type FoundCompany = {
  input: string
  status: 'ok' | 'choose' | 'not_found' | 'error'
  message?: string
  domain: string | null
  company: string | null
  options?: ApolloOrg[]
  people: FoundPerson[]
  alreadyHave: number
}

const looksLikeDomain = (s: string) => /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(s.trim()) && !/\s/.test(s.trim())
const norm = (s: string) => s.toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|company|co|group|holdings?)\b\.?/g, '').replace(/[^a-z0-9]/g, '')

// Step 1 (free): find each company and the finance people / owners there,
// with the best one or two pre-picked. Nothing is revealed or saved.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { inputs } = (await request.json().catch(() => ({}))) as { inputs?: string[] }
  const list = [...new Set((inputs ?? []).map((s) => s.trim()).filter(Boolean))]
  if (!list.length) return NextResponse.json({ error: 'Type at least one company or website.' }, { status: 400 })
  if (list.length > 30) return NextResponse.json({ error: 'Up to 30 companies at a time.' }, { status: 400 })

  const { data: have } = await supabase.from('prospects').select('domain')
  const haveByDomain = new Map<string, number>()
  for (const r of have ?? []) if (r.domain) haveByDomain.set(r.domain as string, (haveByDomain.get(r.domain as string) ?? 0) + 1)

  const results: FoundCompany[] = []
  for (const input of list) {
    const base: FoundCompany = { input, status: 'ok', domain: null, company: null, people: [], alreadyHave: 0 }
    try {
      let domain: string | null = null
      let company: string | null = null
      if (looksLikeDomain(input)) {
        domain = cleanDomain(input)
      } else {
        const orgs = (await findCompanies(input)).filter((o) => o.domain)
        if (!orgs.length) {
          results.push({ ...base, status: 'not_found', message: 'No company by that name in Apollo — try its website.' })
          continue
        }
        const exact = orgs.filter((o) => norm(o.name) === norm(input))
        if (exact.length === 1 || orgs.length === 1) {
          const o = exact[0] ?? orgs[0]
          domain = o.domain
          company = o.name
        } else {
          results.push({ ...base, status: 'choose', options: orgs, message: 'More than one match — pick the right one.' })
          continue
        }
      }
      if (!domain) {
        results.push({ ...base, status: 'not_found', message: "Couldn't read that website." })
        continue
      }
      const found = await searchPeopleWithTitles(domain, PROSPECT_TITLES)
      const people = found
        .filter((p) => financeRank(p.title) !== null || bossRank(p.title) !== null)
        .sort((a, b) => titleScore(a.title) - titleScore(b.title) || Number(b.hasEmail) - Number(a.hasEmail))
      // Pre-pick the top finance person and the top CEO/owner (with an email on file).
      const fin = people.find((p) => p.hasEmail && financeRank(p.title) !== null)
      const boss = people.find((p) => p.hasEmail && bossRank(p.title) !== null)
      const picks = new Set([fin?.id, boss?.id].filter(Boolean) as string[])
      results.push({
        ...base,
        domain,
        company: company ?? found[0]?.company ?? domain,
        status: people.length ? 'ok' : 'not_found',
        message: people.length ? undefined : 'Found the company, but no CFO / controller / owner listed in Apollo.',
        people: people.slice(0, 8).map((p) => ({ id: p.id, name: p.name, title: p.title, hasEmail: p.hasEmail, picked: picks.has(p.id) })),
        alreadyHave: haveByDomain.get(domain) ?? 0,
      })
    } catch (err) {
      results.push({ ...base, status: 'error', message: err instanceof Error ? err.message : 'Apollo lookup failed' })
      // A missing key or rate limit will fail every row the same way — stop early.
      if (err instanceof Error && /API key|isn’t connected|rate limit/i.test(err.message)) break
    }
  }
  return NextResponse.json({ ok: true, results })
}
