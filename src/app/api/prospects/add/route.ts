import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { revealPerson } from '@/lib/apollo'
import { companyDomain } from '@/lib/prospects/types'

export const maxDuration = 120

// Step 2 (1 Apollo credit per person): unlock each picked person's work
// email and add them to Prospects. People already there are skipped first,
// so nobody is paid for twice.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { people, list } = (await request.json().catch(() => ({}))) as {
    people?: { id: string; domain: string; company: string; name: string }[]
    list?: string
  }
  if (!Array.isArray(people) || !people.length) return NextResponse.json({ error: 'Pick at least one person.' }, { status: 400 })
  if (people.length > 60) return NextResponse.json({ error: 'Up to 60 people at a time.' }, { status: 400 })

  const { data: existing, error: readError } = await supabase.from('prospects').select('email, domain, lender, amount, deal_year')
  if (readError) return NextResponse.json({ error: readError.message.includes('prospects') ? 'Run migration 043_prospects.sql in Supabase first.' : readError.message }, { status: 500 })
  const haveEmails = new Set((existing ?? []).map((p) => String(p.email).toLowerCase()))
  // If we already know this company's facility (from an ABL Advisor list), reuse it.
  const facilityByDomain = new Map<string, { lender: string | null; amount: string | null; deal_year: string | null }>()
  for (const p of existing ?? []) if (p.domain && p.lender && !facilityByDomain.has(p.domain as string)) facilityByDomain.set(p.domain as string, p as never)

  const added: string[] = []
  const noEmail: string[] = []
  const duplicates: string[] = []
  let credits = 0
  for (const person of people) {
    try {
      const r = await revealPerson(person.id)
      credits++
      const email = r.email?.toLowerCase() ?? null
      if (!email) {
        noEmail.push(`${person.name} (${person.company})`)
        continue
      }
      if (haveEmails.has(email)) {
        duplicates.push(r.name || person.name)
        continue
      }
      const [first, ...rest] = (r.name || person.name).split(' ')
      const domain = companyDomain(email) ?? person.domain
      const facility = facilityByDomain.get(domain) ?? facilityByDomain.get(person.domain)
      const { error } = await supabase.from('prospects').insert({
        email,
        company: person.company,
        first_name: first || null,
        last_name: rest.join(' ') || null,
        title: r.title,
        phone: r.phone,
        linkedin: r.linkedin,
        website: person.domain,
        domain,
        lender: facility?.lender ?? null,
        amount: facility?.amount ?? null,
        deal_year: facility?.deal_year ?? null,
        source: list?.trim() || 'Found with Apollo',
        status: 'new',
      })
      if (error) throw new Error(error.message)
      haveEmails.add(email)
      added.push(`${r.name || person.name} (${person.company})`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed'
      if (/API key|isn’t connected|rate limit/i.test(msg)) return NextResponse.json({ error: msg, added, credits }, { status: 500 })
      noEmail.push(`${person.name} (${msg})`)
    }
  }
  revalidatePath('/prospects')
  return NextResponse.json({ ok: true, added, noEmail, duplicates, credits })
}
