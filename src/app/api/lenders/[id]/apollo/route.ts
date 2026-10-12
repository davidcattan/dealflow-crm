import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { cleanDomain, companyInfo, revealPerson, searchPeople } from '@/lib/apollo'

// Apollo actions for one lender:
//   { action: 'search', domain }   free — people with deal-relevant titles
//   { action: 'reveal', personId } 1 credit — saves them as a lender contact
//   { action: 'company', domain }  1 credit — adds company info to the notes
export async function POST(request: Request, ctx: RouteContext<'/api/lenders/[id]/apollo'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { action, domain: rawDomain, personId } = (await request.json().catch(() => ({}))) as {
    action?: string
    domain?: string
    personId?: string
  }
  const { data: lender } = await supabase.from('lenders').select('id, name, website, mandate_notes').eq('id', id).single()
  if (!lender) return NextResponse.json({ error: 'Lender not found' }, { status: 404 })
  const domain = cleanDomain(rawDomain)

  try {
    if (action === 'search') {
      if (!domain) return NextResponse.json({ error: 'Enter the lender’s website or email domain' }, { status: 400 })
      return NextResponse.json({ people: await searchPeople(domain) })
    }

    if (action === 'reveal') {
      if (!personId) return NextResponse.json({ error: 'Missing person' }, { status: 400 })
      const p = await revealPerson(personId)
      if (!p.email) return NextResponse.json({ error: `Apollo didn’t have an email for ${p.name || 'this person'}.` }, { status: 404 })
      const { data: existing } = await supabase.from('lender_contacts').select('id').eq('lender_id', id).ilike('email', p.email).maybeSingle()
      if (!existing) {
        await supabase.from('lender_contacts').insert({ lender_id: id, name: p.name || null, title: p.title, email: p.email.toLowerCase(), phone: p.phone })
      }
      revalidatePath(`/lenders/${id}`)
      return NextResponse.json({ person: p, alreadySaved: Boolean(existing) })
    }

    if (action === 'company') {
      if (!domain) return NextResponse.json({ error: 'Enter the lender’s website or email domain' }, { status: 400 })
      const c = await companyInfo(domain)
      const line = [
        c.description,
        [c.city, c.state].filter(Boolean).join(', ') ? `HQ ${[c.city, c.state].filter(Boolean).join(', ')}` : null,
        c.employees ? `~${c.employees} employees` : null,
        c.phone ? `Main line ${c.phone}` : null,
        c.linkedin,
      ]
        .filter(Boolean)
        .join(' · ')
      if (line) {
        const note = `Apollo (${new Date().toISOString().slice(0, 10)}): ${line}`
        await supabase
          .from('lenders')
          .update({
            mandate_notes: lender.mandate_notes ? `${lender.mandate_notes}\n${note}` : note,
            ...(lender.website ? {} : { website: c.website ?? `https://${domain}` }),
          })
          .eq('id', id)
      }
      revalidatePath(`/lenders/${id}`)
      return NextResponse.json({ company: c })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Apollo request failed' }, { status: 500 })
  }
}
